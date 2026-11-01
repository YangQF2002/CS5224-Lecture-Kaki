# Deployment

Commands use PowerShell from the repository root in `ap-southeast-1`. For local setup, see [development](development.md).

## Infrastructure

Use your [IAM login profile](development.md#aws-access) and the team's private artifact bucket.

| Stack                        | Template / packaged input                                                  | Parameters / outputs                                                                            |
| ---------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `lecture-kaki-auth-dev`      | [`infra/auth.yaml`](../infra/auth.yaml) → `build/auth.packaged.yaml`       | `DomainPrefix`, `CallbackURLs`, `LogoutURLs`; outputs `UserPoolId`, `ClientId`, `HostedDomain`. |
| `lecture-kaki-hosting-dev`   | [`infra/hosting.yaml`](../infra/hosting.yaml)                              | `Env=dev`; outputs `WebBucketName`, `WebsiteURL`.                                               |
| `lecture-kaki-ingest-dev`    | [`infra/ingest.yaml`](../infra/ingest.yaml) → `build/ingest.packaged.yaml` | `Env=dev`, optional `AlertEmail`; output `IngestFunctionName`.                                  |
| `lecture-kaki-timetable-dev` | [`infra/timetable.yaml`](../infra/timetable.yaml)                          | `Env=dev`; outputs `TimetableTableName`, `TimetableTableArn`.                                   |

Deploy hosting before ingestion with the same `Env`. Forum table and API hosting have no templates; reuse the [existing Forum table](development.md#shared-configuration).

## Stack changes

```powershell
$awsProfile = 'cs5224-dev'
$awsRegion = 'ap-southeast-1'
$artifactBucket = '<existing-private-artifact-bucket>'
aws sts get-caller-identity --profile $awsProfile --region $awsRegion
New-Item -ItemType Directory -Force build | Out-Null
```

Package the changed stack. For auth:

```powershell
aws cloudformation package --template-file infra/auth.yaml --s3-bucket $artifactBucket --s3-prefix lecture-kaki/auth --output-template-file build/auth.packaged.yaml --region $awsRegion --profile $awsProfile
```

For ingestion, install native backend dependencies first, then build `build/ingest.zip` and package:

```powershell
Push-Location backend
try {
    poetry run python scripts/package_ingest.py
    if ($LASTEXITCODE -ne 0) { throw 'Ingestion packaging failed.' }
} finally {
    Pop-Location
}
aws cloudformation package --template-file infra/ingest.yaml --s3-bucket $artifactBucket --s3-prefix lecture-kaki/ingest --output-template-file build/ingest.packaged.yaml --region $awsRegion --profile $awsProfile
```

Hosting/timetable need no packaging. Select the stack, template and parameters from the table; this example updates timetable storage:

```powershell
$stackName = 'lecture-kaki-timetable-dev'
$templateFile = 'infra/timetable.yaml'
$parameters = @('Env=dev')
aws cloudformation validate-template --template-body "file://$templateFile" --region $awsRegion --profile $awsProfile
aws cloudformation deploy --template-file $templateFile --stack-name $stackName --parameter-overrides $parameters --capabilities CAPABILITY_IAM --no-execute-changeset --region $awsRegion --profile $awsProfile
```

For auth, use `$parameters = @('DomainPrefix=<existing-prefix>', 'CallbackURLs=<complete-comma-separated-list>', 'LogoutURLs=<complete-comma-separated-list>')`. Preserve the existing domain and approved URL lists, including the [local clients](development.md#shared-configuration) and hosted website. Read existing parameters with `aws cloudformation describe-stacks --stack-name $stackName --region $awsRegion --profile $awsProfile`.

Review the printed change-set ARN for replacements, deletions and IAM changes before executing:

```powershell
$changeSetArn = '<printed-change-set-arn>'
aws cloudformation describe-change-set --change-set-name $changeSetArn --region $awsRegion --profile $awsProfile
# After review:
aws cloudformation execute-change-set --change-set-name $changeSetArn --region $awsRegion --profile $awsProfile
```

Wait for `CREATE_COMPLETE` or `UPDATE_COMPLETE` before dependent changes. Read outputs:

```powershell
aws cloudformation describe-stacks --stack-name $stackName --query 'Stacks[0].Outputs' --output table --region $awsRegion --profile $awsProfile
```

## API hosting

Run one API instance/worker behind an HTTPS proxy supporting WebSockets. Use an EC2 instance role with the [table permissions](development.md#shared-configuration), backend environment settings and the website origin in `FRONTEND_ORIGINS`. Bind the backend port to loopback; configure restart, logs and health monitoring. Local Compose is not a complete hosted deployment.

## Frontend release

Set all five public build arguments; Docker does not load `frontend/.env.local`. Register the website's exact callback/logout URLs in Cognito and its origin in API `FRONTEND_ORIGINS`.

```powershell
$webBucket = aws cloudformation describe-stacks --stack-name lecture-kaki-hosting-dev --query "Stacks[0].Outputs[?OutputKey=='WebBucketName'].OutputValue | [0]" --output text --region $awsRegion --profile $awsProfile
$websiteUrl = aws cloudformation describe-stacks --stack-name lecture-kaki-hosting-dev --query "Stacks[0].Outputs[?OutputKey=='WebsiteURL'].OutputValue | [0]" --output text --region $awsRegion --profile $awsProfile
$apiUrl = 'https://<deployed-api-host>'
$cognitoDomain = 'https://<domain-prefix>.auth.ap-southeast-1.amazoncognito.com'
$cognitoClientId = '<public-client-id>'
$websiteOrigin = $websiteUrl.TrimEnd('/')
docker build --target build -t lecture-kaki-frontend-build --build-arg "VITE_API_URL=$apiUrl" --build-arg "VITE_COGNITO_DOMAIN=$cognitoDomain" --build-arg "VITE_COGNITO_CLIENT_ID=$cognitoClientId" --build-arg "VITE_COGNITO_REDIRECT_URI=$websiteOrigin/auth/callback" --build-arg "VITE_COGNITO_LOGOUT_URI=$websiteOrigin/forum" frontend
if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
$containerId = docker create lecture-kaki-frontend-build
if ($LASTEXITCODE -ne 0) { throw 'Could not create the build container.' }
$frontendBuild = Join-Path 'build' ('frontend-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $frontendBuild | Out-Null
try {
    docker cp "${containerId}:/app/dist/." $frontendBuild
    if ($LASTEXITCODE -ne 0) { throw 'Could not extract the frontend build.' }
} finally {
    docker rm $containerId
}
```

Upload assets first, then HTML; preserve `lectures/*`:

```powershell
aws s3 sync "$frontendBuild/assets/" "s3://$webBucket/assets/" --cache-control 'public, max-age=31536000, immutable' --region $awsRegion --profile $awsProfile
if ($LASTEXITCODE -ne 0) { throw 'Asset upload failed.' }
aws s3 sync "$frontendBuild/" "s3://$webBucket/" --delete --exclude 'assets/*' --exclude 'lectures/*' --cache-control 'no-cache' --region $awsRegion --profile $awsProfile
```

Verify discovery, direct links, login, timetable saving and two-user live Forum delivery on the hosted website.

## Ingestion and recovery

Scheduler invokes every Monday at 03:00 Singapore time; ingestion runs in teaching Weeks 1–3 and on the first Monday of each month. A manual date selects the target semester and bypasses the schedule check. Use the profile/region variables above and `$webBucket` from the frontend section:

```powershell
$ingestFunction = aws cloudformation describe-stacks --stack-name lecture-kaki-ingest-dev --query "Stacks[0].Outputs[?OutputKey=='IngestFunctionName'].OutputValue | [0]" --output text --region $awsRegion --profile $awsProfile
New-Item -ItemType Directory -Force build | Out-Null
[System.IO.File]::WriteAllText((Join-Path (Get-Location) 'build/ingest-request.json'), '{"date":"2026-10-19"}')
aws lambda invoke --function-name $ingestFunction --payload fileb://build/ingest-request.json build/ingest-result.json --region $awsRegion --profile $awsProfile
Get-Content build/ingest-result.json
aws s3 cp "s3://$webBucket/lectures/current.json" - --region $awsRegion --profile $awsProfile
```

Check for `FunctionError` and compare the result's `path` with `current.json`. Set `AlertEmail` and confirm the SNS subscription for failure alerts.

Keep complete snapshots for rollback. Restore a prior `current.json` with its matching metadata/path and `no-cache` header. Extend [calendar/holiday entries](../backend/jobs/lecture_ingest/academic_calendar.py) for later academic years.

The web bucket, Cognito user pool and timetable table are retained on stack deletion/replacement. Delete ingestion before hosting to release imports; retained data and artifact packages require separate cleanup.
