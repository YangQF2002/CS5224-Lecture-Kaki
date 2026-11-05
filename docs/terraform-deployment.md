# Terraform deployment

Deploys the `terraform-dev` environment from [`infra/terraform/`](../infra/terraform) by hand; the [pipeline](terraform-pipeline-setup.md) automates the same steps. Run every command in bash from the repository root, in order. Design choices are in [Terraform decisions](terraform-decisions.md).

## Prerequisites

- Terraform 1.10+, AWS CLI v2.32+, Python 3.14 and Node.js 24.
- An AWS identity that can create IAM roles named `lecture-kaki-terraform-dev-*` (see [decisions](terraform-decisions.md#scope-and-environment)).

## 1. Sign in

```bash
aws login --profile lecture-kaki --region ap-southeast-1
export AWS_PROFILE=lecture-kaki
aws sts get-caller-identity
```

The account must be `320465872576`. Any profile name works; keep `AWS_PROFILE` set for the remaining steps.

## 2. State bucket (once per account)

Skip if `lecturekaki-tfstate-320465872576` already exists.

```bash
terraform -chdir=infra/terraform/bootstrap init
terraform -chdir=infra/terraform/bootstrap apply
```

## 3. Infrastructure

Build the ingestion package, then preview and apply. Review the plan's `to destroy` count before typing `yes`.

```bash
python3.14 backend/scripts/package_ingest.py
terraform -chdir=infra/terraform init
terraform -chdir=infra/terraform plan
terraform -chdir=infra/terraform apply
```

Load the outputs used below:

```bash
tf_out() { terraform -chdir=infra/terraform output -raw "$1"; }
WEBSITE_URL=$(tf_out website_url)
WEB_BUCKET=$(tf_out web_bucket)
API_URL=$(tf_out api_url)
COGNITO_DOMAIN=$(tf_out cognito_domain)
COGNITO_CLIENT_ID=$(tf_out cognito_client_id)
INGEST_FUNCTION=$(tf_out ingest_function_name)
```

## 4. Lecture data

The weekly schedule only publishes in teaching Weeks 1–3 and on the first Monday of each month, so publish once now:

```bash
aws lambda invoke --function-name "$INGEST_FUNCTION" \
  --cli-binary-format raw-in-base64-out --cli-read-timeout 310 \
  --payload "{\"date\":\"$(TZ=Asia/Singapore date +%F)\"}" build/ingest-result.json
cat build/ingest-result.json
```

The result must not contain `errorMessage`.

## 5. API

A new server builds the API image on first boot (5–10 minutes) and then obtains its certificate. Wait until it answers:

```bash
until curl -fsS "$API_URL/health"; do sleep 15; done
```

It prints `{"status":"ok"}`.

## 6. Frontend

Build with this environment's addresses, then upload assets before `index.html`. `lectures/` is excluded so the upload keeps the ingested data.

```bash
(
  cd frontend
  npm ci
  VITE_API_URL="$API_URL" \
  VITE_COGNITO_DOMAIN="$COGNITO_DOMAIN" \
  VITE_COGNITO_CLIENT_ID="$COGNITO_CLIENT_ID" \
  VITE_COGNITO_REDIRECT_URI="$WEBSITE_URL/auth/callback" \
  VITE_COGNITO_LOGOUT_URI="$WEBSITE_URL/forum" \
  npm run build
)
aws s3 sync frontend/dist/assets/ "s3://$WEB_BUCKET/assets/" --cache-control 'public, max-age=31536000, immutable'
aws s3 sync frontend/dist/ "s3://$WEB_BUCKET/" --delete --exclude 'assets/*' --exclude 'lectures/*' --cache-control 'no-cache'
echo "$WEBSITE_URL"
```

## 7. Verify

Open the website and check lecture discovery, sign-up with an `@u.nus.edu` email, timetable saving after reload, and live Forum messages between two browser profiles.

## Later changes

| Change                       | Steps                                                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Infrastructure (`.tf` files) | 1, 3                                                                                                                                                         |
| API code                     | Set `source_revision` to the new full commit SHA in `infra/terraform/api.tf`, then 1, 3, 5. The server is replaced, briefly dropping live Forum connections. |
| Ingestion code               | 1, 3 (the package is rebuilt), optionally 4                                                                                                                  |
| Frontend code                | 1, the output block in 3, 6                                                                                                                                  |
| Failure alert email          | `terraform -chdir=infra/terraform apply -var 'alert_email=<address>'`, then confirm the email from AWS                                                       |

### API server replacement

The API server is configured only by its first-boot script in [`api.tf`](../infra/terraform/api.tf). Any change to that script replaces the server, and the plan shows `aws_instance.api must be replaced`. This happens when you change:

- `source_revision` (new API code);
- the Cognito pool, client or domain, either table, or the website address, all written into the API settings;
- the script text itself, such as the Caddy version or swap size.

During replacement the API is unavailable for 5–10 minutes and live Forum connections drop; repeat step 5 to wait for it. The Elastic IP moves to the new server, so `API_URL` and the frontend build stay the same. Frontend, ingestion and other changes do not replace the server. See [decisions](terraform-decisions.md#api-server) for why.

## Tear down

```bash
terraform -chdir=infra/terraform destroy
```

This deletes the environment, including its website files, tables and user accounts. The state bucket stays; delete it separately only when no Terraform environment uses it.
