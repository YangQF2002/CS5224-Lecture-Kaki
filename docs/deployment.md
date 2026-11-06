# Deployment

Use PowerShell from the repository root in `ap-southeast-1`. Local setup is in [development](development.md).

## Infrastructure ownership

Terraform in [`infra/terraform`](../infra/terraform) manages the website, API and lecture ingestion. Its shared state is `s3://lecturekaki-tfstate-320465872576/lecture-kaki/terraform-dev.tfstate`, with versioning and S3 locking. The existing CloudFormation stacks retain ownership of Cognito and application data; Terraform reads the existing tables and uses the existing Cognito client. Do not import these resources into Terraform while CloudFormation still manages them.

| Resource                              | Owner                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| Website, EC2 API, ingestion and alarm | `infra/terraform/`                                                              |
| Cognito pool/client/signup validation | `lecture-kaki-auth-dev`, [`infra/auth.yaml`](../infra/auth.yaml)                |
| Timetable table                       | `lecture-kaki-timetable-dev`, [`infra/timetable.yaml`](../infra/timetable.yaml) |
| Forum table                           | Existing retained `lecturekaki-dev-forum`                                       |
| GitHub OIDC and deployment role       | `infra/terraform/github/`, separate state                                       |

The original partial Terraform apply also created two unused tables and a signup log group. Keep them until cleanup is agreed. Existing CloudFormation hosting/API/ingestion stacks can be retired after cutover; preserve the auth and data resources. The certificate disk is protected with `prevent_destroy`; teardown requires explicit review.

## Deploy infrastructure

Use Terraform 1.17.1, AWS CLI v2, Python 3.14 and Node.js 24. The state bucket already exists; `infra/terraform/bootstrap/` is only for creating a new state bucket.

```powershell
$env:AWS_PROFILE = 'cs5224-dev'
$env:AWS_REGION = 'ap-southeast-1'
aws login --profile $env:AWS_PROFILE --region $env:AWS_REGION
aws sts get-caller-identity
Push-Location backend
try {
    poetry run python scripts/package_ingest.py
    if ($LASTEXITCODE -ne 0) { throw 'Ingestion packaging failed.' }
} finally { Pop-Location }
terraform '-chdir=infra/terraform' init '-backend-config=bucket=lecturekaki-tfstate-320465872576'
$env:TF_VAR_source_revision = git log -1 --format=%H -- backend
if ($LASTEXITCODE -ne 0 -or $env:TF_VAR_source_revision -notmatch '^[a-f0-9]{40}$') { throw 'Could not select the API revision.' }
terraform '-chdir=infra/terraform' plan '-out=tfplan'
terraform '-chdir=infra/terraform' show tfplan
# After reviewing replacements and deletions:
terraform '-chdir=infra/terraform' apply tfplan
$tf = terraform '-chdir=infra/terraform' output -json | ConvertFrom-Json
```

Deploy from a published commit; the selected API revision must exist in the public team repository. Both the commands above and the pipeline select the latest commit that changed `backend/`, so frontend and documentation changes do not replace the API. A changed API boot script replaces the instance and interrupts requests and live Forum connections while it starts. The Elastic IP preserves the API address; Caddy certificates and ACME account data persist on a separate encrypted EBS volume. Its mount is required before Docker starts. Wait for `Invoke-RestMethod "$($tf.api_url.value)/health"` to return `status: ok` before releasing the frontend.

For a new website address, update `CallbackURLs` and `LogoutURLs` in `lecture-kaki-auth-dev` to include `<website_url>/auth/callback` and `<website_url>/forum`. Preserve the existing domain and other URLs. Use a CloudFormation change set and confirm it modifies the client without replacing the user pool. Auth Lambda changes require packaging [`infra/auth.yaml`](../infra/auth.yaml) through the team's private artifact bucket before updating that stack.

AWS assigns the `cloudfront.net` hostname. For a custom domain you control, configure the distribution's `aliases` and `viewer_certificate` in `infra/terraform/hosting.tf`, using a validated ACM certificate in `us-east-1`; point the domain's DNS to CloudFront. Set `local.website_url` in `infra/terraform/auth.tf` to that HTTPS origin, update Cognito's URLs as above, then apply and rebuild the frontend. This also updates the API's allowed origin. Keep the existing site available until the custom domain is verified.

## Publish frontend and lectures

Build from the same application version as the API:

```powershell
$env:VITE_API_URL = $tf.api_url.value
$env:VITE_COGNITO_DOMAIN = $tf.cognito_domain.value
$env:VITE_COGNITO_CLIENT_ID = $tf.cognito_client_id.value
$env:VITE_COGNITO_REDIRECT_URI = "$($tf.website_url.value)/auth/callback"
$env:VITE_COGNITO_LOGOUT_URI = "$($tf.website_url.value)/forum"
Push-Location frontend
try {
    npm ci
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
} finally { Pop-Location }
$webBucket = $tf.web_bucket.value
aws s3 sync frontend/dist/assets/ "s3://$webBucket/assets/" --cache-control 'public, max-age=31536000, immutable'
if ($LASTEXITCODE -ne 0) { throw 'Asset upload failed.' }
aws s3 sync frontend/dist/ "s3://$webBucket/" --exclude 'assets/*' --exclude 'lectures/*' --cache-control 'no-cache'
```

Publish lecture data once for a new site; optionally repeat for a refresh. Use today's Singapore date in the request:

```powershell
New-Item -ItemType Directory -Force build | Out-Null
$ingestDate = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTimeOffset]::UtcNow, 'Singapore Standard Time').ToString('yyyy-MM-dd')
[System.IO.File]::WriteAllText((Join-Path (Get-Location) 'build/ingest-request.json'), (@{date=$ingestDate} | ConvertTo-Json -Compress))
aws lambda invoke --function-name $tf.ingest_function_name.value --cli-read-timeout 310 --payload fileb://build/ingest-request.json build/ingest-result.json
Get-Content build/ingest-result.json
```

Check for `FunctionError` and an `errorMessage` in the result. Scheduled ingestion runs Mondays at 03:00 Singapore time and publishes only in teaching Weeks 1–3 or on the first Monday of the month. Keep complete snapshots for rollback; restore a previous `lectures/current.json` with its matching snapshot path and `no-cache` header. Manage alarm email subscriptions separately in SNS and confirm the subscription email; keep personal addresses out of public plan artifacts.

Verify discovery, direct links, login, timetable persistence after refresh and live Forum delivery between two users. Run another Terraform plan after applying; unexpected drift needs investigation.

## GitHub deployment workflow

Complete this setup before merging [Terraform deploy](../.github/workflows/terraform-deploy.yml) into `main`, because merging triggers its first run. An AWS admin initializes and plans `infra/terraform/github/` with the same backend bucket, reviews and applies the saved plan, then reads `deploy_role_arn`. If GitHub's OIDC provider already exists, set `create_github_oidc_provider=false`. The role uses GitHub OIDC rather than stored AWS keys; it has broad account permissions and must only be available to trusted workflows.

```powershell
terraform '-chdir=infra/terraform/github' init '-backend-config=bucket=lecturekaki-tfstate-320465872576'
terraform '-chdir=infra/terraform/github' plan '-out=tfplan'
# After reviewing the plan:
terraform '-chdir=infra/terraform/github' apply tfplan
terraform '-chdir=infra/terraform/github' output -raw deploy_role_arn
```

A repository admin creates environment `dev`, adds required reviewers, restricts deployment branches to `main`, and sets repository variables `AWS_DEPLOY_ROLE_ARN` to that role ARN and `TF_STATE_BUCKET` to `lecturekaki-tfstate-320465872576`.

Pushes to `main` create a plan; environment approval permits applying that saved plan and publishing the frontend. Manual runs can refresh lectures. PR CI validates Terraform without AWS access. Saved plans are public workflow artifacts for one day: do not put secrets or personal data in Terraform inputs. Disable the workflow or revoke its AWS role access to stop deployment; deleting the environment removes its protection rules and is not a safe stop mechanism.
