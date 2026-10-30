# Personal AWS development setup

Deploy the auth, hosting and ingestion stacks and the frontend to your own AWS account in `ap-southeast-1`. Requires AWS CLI v2, Python 3.11+ and Docker. Run commands from the repository root.

## 1. Configure the CLI profile

```sh
aws configure sso
# SSO session name: lecturekaki
# SSO start URL:    <your access portal URL>
# SSO region:       ap-southeast-1
# Account / role:   your account, AdministratorAccess
# Default region:   ap-southeast-1
# Profile name:     cs5224-dev

aws sts get-caller-identity --profile cs5224-dev
aws sso login --profile cs5224-dev   # when the session expires
```

## 2. Prepare the shell and artifact bucket

```sh
export AWS_PROFILE=cs5224-dev AWS_REGION=ap-southeast-1
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
ARTIFACT_BUCKET=lecturekaki-artifacts-$ACCOUNT
DOMAIN_PREFIX=lecturekaki-<name>-dev   # must be globally unique

# Once per account
aws s3 mb s3://$ARTIFACT_BUCKET
aws s3api put-public-access-block --bucket $ARTIFACT_BUCKET \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
mkdir -p build
```

## 3. Deploy Cognito

```sh
aws cloudformation package --template-file infra/auth.yaml \
  --s3-bucket $ARTIFACT_BUCKET --s3-prefix lecture-kaki/auth \
  --output-template-file build/auth.packaged.yaml

aws cloudformation deploy --template-file build/auth.packaged.yaml \
  --stack-name lecture-kaki-auth-dev \
  --parameter-overrides DomainPrefix=$DOMAIN_PREFIX \
  --capabilities CAPABILITY_IAM

aws cloudformation describe-stacks --stack-name lecture-kaki-auth-dev \
  --query 'Stacks[0].Outputs' --output table
```

Copy the outputs into `backend/.env.local`, then run `docker compose up -d --force-recreate backend`:

```dotenv
AWS_REGION=ap-southeast-1
COGNITO_USER_POOL_ID=<UserPoolId>
COGNITO_CLIENT_ID=<ClientId>
COGNITO_DOMAIN=<HostedDomain>
```

## 4. Deploy hosting

Creates the web bucket and CloudFront distribution. Deploy before ingestion, which uses this stack's bucket.

```sh
aws cloudformation deploy --template-file infra/hosting.yaml \
  --stack-name lecture-kaki-hosting-dev --parameter-overrides Env=dev

WEB_BUCKET=$(aws cloudformation describe-stacks --stack-name lecture-kaki-hosting-dev \
  --query "Stacks[0].Outputs[?OutputKey=='WebBucketName'].OutputValue" --output text)
WEBSITE_URL=$(aws cloudformation describe-stacks --stack-name lecture-kaki-hosting-dev \
  --query "Stacks[0].Outputs[?OutputKey=='WebsiteURL'].OutputValue" --output text)
```

## 5. Deploy ingestion

```sh
(cd backend && python3 scripts/package_ingest.py)

aws cloudformation package --template-file infra/ingest.yaml \
  --s3-bucket $ARTIFACT_BUCKET --s3-prefix lecture-kaki/ingest \
  --output-template-file build/ingest.packaged.yaml

aws cloudformation deploy --template-file build/ingest.packaged.yaml \
  --stack-name lecture-kaki-ingest-dev \
  --parameter-overrides Env=dev \
  --capabilities CAPABILITY_IAM
```

Run it once to publish lecture data:

```sh
INGEST_FUNCTION=$(aws cloudformation describe-stacks --stack-name lecture-kaki-ingest-dev \
  --query "Stacks[0].Outputs[?OutputKey=='IngestFunctionName'].OutputValue" --output text)

aws lambda invoke --function-name $INGEST_FUNCTION \
  --payload '{"date":"2026-10-19"}' --cli-binary-format raw-in-base64-out \
  build/ingest-result.json
cat build/ingest-result.json
aws s3 cp s3://$WEB_BUCKET/lectures/current.json -
```

## 6. Deploy the frontend

Build with Docker (or `npm ci && npm run build` in `frontend/` with Node 24), then upload. Hashed assets are cached for a year and `index.html` is always revalidated, so no CloudFront invalidation is needed. The `lectures/*` exclusion keeps `--delete` from removing lecture data.

```sh
docker build --target build -t lecture-kaki-frontend-build frontend
id=$(docker create lecture-kaki-frontend-build)
rm -rf frontend/dist && docker cp $id:/app/dist frontend/dist && docker rm $id

aws s3 sync frontend/dist/assets/ s3://$WEB_BUCKET/assets/ \
  --cache-control "public, max-age=31536000, immutable"
aws s3 sync frontend/dist/ s3://$WEB_BUCKET/ --delete \
  --exclude "assets/*" --exclude "lectures/*" --cache-control "no-cache"

echo $WEBSITE_URL
```

## Clean up

Delete ingestion before hosting. The web bucket and user pool are retained, so remove them separately.

```sh
aws cloudformation delete-stack --stack-name lecture-kaki-ingest-dev
aws cloudformation wait stack-delete-complete --stack-name lecture-kaki-ingest-dev
aws cloudformation delete-stack --stack-name lecture-kaki-hosting-dev
aws s3 rb s3://$WEB_BUCKET --force
aws cloudformation delete-stack --stack-name lecture-kaki-auth-dev
aws cloudformation wait stack-delete-complete --stack-name lecture-kaki-auth-dev
aws cognito-idp delete-user-pool --user-pool-id <UserPoolId>
aws s3 rb s3://$ARTIFACT_BUCKET --force
```
