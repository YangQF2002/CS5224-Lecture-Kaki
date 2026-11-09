# Deployment

Use PowerShell from the repository root in `ap-southeast-1`. Local setup is in [development](development.md).

## Infrastructure ownership

Terraform in [`infra/terraform`](../infra/terraform) manages the website, API and lecture ingestion. Its shared state is `s3://lecturekaki-tfstate-320465872576/lecture-kaki/terraform-dev.tfstate`, with versioning and S3 locking. The existing CloudFormation stacks retain ownership of Cognito and the Forum and timetable tables; Terraform reads those tables and uses the existing Cognito client. Do not import a resource into Terraform while CloudFormation still manages it; the Forum PDF bucket was moved by first deleting its stack with `Retain` ([record](#forum-pdf-bucket-handover-to-terraform)).

| Resource                                  | Owner                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| Website, Lambda API, ingestion and alarms | `infra/terraform/`                                                                         |
| Cognito pool/client/signup validation     | `lecture-kaki-auth-dev`, [`infra/auth.yaml`](../infra/auth.yaml)                           |
| Timetable table                           | `lecture-kaki-timetable-dev`, [`infra/timetable.yaml`](../infra/timetable.yaml)            |
| Forum table                               | Existing retained `lecturekaki-dev-forum`                                                  |
| Forum PDF bucket `lecturekaki-forum`      | `infra/terraform/forum.tf` (imported; [handover](#forum-pdf-bucket-handover-to-terraform)) |
| Profile table (usernames, topics)         | `infra/terraform/`, `lecture-kaki-profiles-terraform-dev`                                  |
| GitHub OIDC and deployment role           | `infra/terraform/github/`, separate state                                                  |

Terraform's `forum.tf` manages the PDF bucket: versioning, encryption (SSE-C blocked), owner-enforced ownership, public-access block, the TLS-only and conditional-upload bucket policy, CORS and lifecycle. `prevent_destroy` stops any plan from deleting it, and its existing tags are left as they are. It grants the API role access to `uploads/*`; `api.tf` passes the name as `FORUM_ATTACHMENTS_BUCKET`. Upload CORS allows the two local development origins and `local.website_url`, so a new website address is picked up on the next apply. Downloads navigate directly to signed S3 links and do not require GET CORS.

PDF download links last at most 60 seconds and are capped by the message's expiry (the end of its lecture's week). Terraform's [`forum_cleanup.tf`](../infra/terraform/forum_cleanup.tf) runs a Lambda every Monday at 00:05 Singapore time that deletes every version of closed rooms' PDFs; its role can only list and delete under `uploads/`, and failures alert through the shared SNS topic. The bucket's lifecycle no longer expires current PDFs by age (the old CloudFormation rule deleted them after 2 days, before their rooms closed); it only removes old versions, delete markers and incomplete uploads. Deletion stops new links immediately and attempts to delete the pinned object version; an already-issued link can still work until it expires if physical deletion fails. A download started before expiry may finish afterward.

Terraform also declares two unused tables and a signup log group from an earlier partial deployment; keep them until cleanup is agreed. The former Caddy certificate volume is outside Terraform management and can be deleted after verifying the Lambda deployment. Preserve the active auth and data resources listed above.

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
    poetry run python scripts/package_api.py
    if ($LASTEXITCODE -ne 0) { throw 'API packaging failed.' }
} finally { Pop-Location }
terraform '-chdir=infra/terraform' init '-backend-config=bucket=lecturekaki-tfstate-320465872576'
terraform '-chdir=infra/terraform' plan '-out=tfplan'
terraform '-chdir=infra/terraform' show tfplan
# After reviewing replacements and deletions:
terraform '-chdir=infra/terraform' apply tfplan
$tf = terraform '-chdir=infra/terraform' output -json | ConvertFrom-Json
```

The API is packaged from the checked-out `backend/app` into `build/api.zip` (Linux wheels, whatever machine builds it); one package backs the HTTP, WebSocket connection and asynchronous fan-out functions. Terraform updates the functions when the package hash changes. API Gateway holds open sockets; `api_url` and `forum_websocket_url` are stable `execute-api` addresses. Check `Invoke-RestMethod "$($tf.api_url.value)/health"` returns `status: ok` before releasing the frontend. Release both from the same revision because the client and backend share the readiness handshake; reload existing browser tabs when first introducing it.

For a new website address, update `CallbackURLs` and `LogoutURLs` in `lecture-kaki-auth-dev` to include `<website_url>/auth/callback` and `<website_url>/forum`. Preserve the existing domain and other URLs. Use a CloudFormation change set and confirm it modifies the client without replacing the user pool. Auth Lambda changes require packaging [`infra/auth.yaml`](../infra/auth.yaml) through the team's private artifact bucket before updating that stack.

### Forum PDF bucket handover to Terraform

**Record.** On 9 Nov 2026 the Forum PDF bucket `lecturekaki-forum` moved from the CloudFormation stack `lecture-kaki-forum-pdfs-dev` to Terraform ([`forum.tf`](../infra/terraform/forum.tf)). The bucket, its policy and its PDFs were never deleted or recreated. Done in the AWS console by `eline-dev`:

| Time (SGT)  | Step                                                                                                                                                                                                                                             | Result                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| 14:50–14:51 | Change set `retain-before-terraform` from the retired `infra/forum.yaml`, keeping every parameter: added `DeletionPolicy: Retain` to the bucket policy (the bucket already had it) and removed the lifecycle rule's 2-day expiry of current PDFs | `PdfBucket` and `PdfBucketPolicy` `UPDATE_COMPLETE`, no replacement         |
| 14:52       | Deleted the stack                                                                                                                                                                                                                                | `PdfBucket` and `PdfBucketPolicy` `DELETE_SKIPPED`; stack `DELETE_COMPLETE` |

Checked afterwards: the bucket policy still has `RequireTls` and `RequireConditionalUploads`, and lifecycle rule `ExpireUploadsAndVersions` only expires old versions and incomplete uploads.

**Why it was done this way.** The pipeline never deployed that stack, so bucket changes (such as the lifecycle rule that weekly rooms need) had to be made by hand. `DeletionPolicy: Retain` makes CloudFormation leave a resource in place when its stack is deleted, so deleting the stack only removed CloudFormation's record. Terraform's `import` blocks then adopt the existing bucket rather than creating one. The stack was deleted before merging so that the two tools never manage the bucket at the same time; a later stack update would otherwise undo Terraform's settings.

**Still to do.**

1. **Merge.** The pipeline's plan should show `8 to import, 0 to add, 1 to change, 0 to destroy`. The one change is upload CORS dropping `https://d7jt5x0l6e3o7.cloudfront.net`, the address of the old CloudFormation website (`lecture-kaki-hosting-dev`, deleted on 6 Nov 2026 when hosting moved to Terraform), which had stayed in the stack's `FrontendOrigins`. Terraform now sets CORS from `local.website_url`. Any `destroy`, `replace` or `add` for a `forum_pdfs` resource means do not approve.
2. **After the apply**, remove the `import` blocks from `forum.tf`; they do nothing once applied.

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

Check for `FunctionError` and an `errorMessage` in the result. Scheduled ingestion runs Mondays at 03:00 Singapore time and publishes only in teaching Weeks 1–3 or on the first Monday of the month. Keep complete snapshots for rollback; restore a previous `lectures/current.json` with its matching snapshot path and `no-cache` header. For ingestion alarms, see [Alerts](#alerts).

Verify discovery, direct links, login, timetable persistence after refresh and live Forum delivery between two users. A Forum connection should show connected only after readiness acknowledgement and history refresh; a saved message should succeed independently of delivery retries. Check the fan-out Lambda's logs and SNS failure alerts if history works but live events do not. Run another Terraform plan after applying; unexpected drift needs investigation.

## Alerts

![Part 5, monitoring and alerts: the HTTP API's 5xx count and each Lambda's errors and log-based metrics (crash logs, small new semester, enqueue failures) feed CloudWatch alarms, which publish to SNS, which emails confirmed subscribers. Fan-out events that still fail after 2 retries go to SNS directly.](diagrams/architecture-5-monitoring-and-alerts.svg)

CloudWatch watches the functions and sends alarms to one SNS topic, `lecturekaki-terraform-dev-alerts` ([`ingest.tf`](../infra/terraform/ingest.tf)), which emails its subscribers. CloudWatch is managed by AWS and always on; at this scale the alarms, custom metrics and logs fit in the free tier.

How an alarm is raised:

1. **Metric.** Lambda reports `AWS/Lambda › Errors` for every run that fails (uncaught exception, timeout, out of memory, failed start-up). API Gateway reports `AWS/ApiGateway › 5xx` for every 5xx response. For problems that are not failures, a **log metric filter** counts a specific log line into a custom metric under `LectureKaki/terraform-dev`.
2. **Alarm.** Each alarm adds up its metric in fixed 5-minute windows (10:00–10:05, 10:05–10:10, …). When a window reaches the threshold, the alarm moves to ALARM and publishes to the topic. It emails once per change to ALARM, not for every error, and returns to OK silently. No data counts as OK.
3. **Email.** SNS sends the alarm to every confirmed subscriber.

| Alarm (`lecturekaki-terraform-dev-…`) | Counts                                               | Fires at   | What to do                                                                                                  |
| ------------------------------------- | ---------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------- |
| `api-crashes`                         | Log line "An error occurred running the application" | 1 in 5 min | A bug, unexpected data or missing setting returned HTTP 500. Find the traceback in the API function's logs. |
| `api-5xx`                             | HTTP API 5xx responses (500, 503, timeouts)          | 5 or more  | Many users are getting errors; check the API logs and DynamoDB/S3 health.                                   |
| `api-errors`                          | API Lambda errors                                    | 5 or more  | The function itself failed: timeouts (29 s), out of memory or a broken deploy.                              |
| `forum-live-errors`                   | WebSocket Lambda errors                              | 5 or more  | Connections or readiness are failing; check its logs.                                                       |
| `forum-fanout-errors`                 | Fan-out Lambda errors                                | 5 or more  | Live delivery is failing. Events that fail after 2 retries are also sent to the topic directly.             |
| `api-fanout-enqueue-errors`           | Log line "Forum broadcast could not be queued"       | 1 or more  | Messages were saved but not delivered live; users see them on refresh.                                      |
| `ingest-errors`                       | Ingestion Lambda errors                              | 1 or more  | Lecture data was not updated; the current snapshot stays live. Check the logs, then re-run ingestion.       |
| `ingest-small-new-semester`           | Log line `SMALL_NEW_SEMESTER`                        | 1 or more  | A new semester was published with under half the previous one's sessions. Check NUSMods, then re-run.       |
| `forum-pdf-cleanup-errors`            | PDF cleanup Lambda errors                            | 1 or more  | Closed rooms' PDFs were not deleted; the next Monday's run catches up.                                      |

Why there are two API alarms: Mangum, which runs FastAPI on Lambda, turns an unhandled exception into an HTTP 500 and logs the line above. The Lambda run still succeeds, so `api-errors` never sees these crashes. `api-crashes` catches every one of them, even a single one. Handled failures, such as 503 when Forum storage is unavailable, do not log that line, and brief ones are normal, so `api-5xx` alerts only on a sustained run. Log-based alarms depend on the exact log text: keep it unchanged, or update the filter in Terraform with it.

**Receiving alerts.** Subscribers are not in Terraform, so personal addresses stay out of the code and plans. In the console (Asia Pacific (Singapore)): SNS → Topics → `lecturekaki-terraform-dev-alerts` → Subscriptions → **Create subscription** → Protocol **Email**, your address → **Create subscription**, then click **Confirm subscription** in the email AWS sends. Until confirmed it stays "Pending confirmation" and receives nothing. Unsubscribe with the link in any alert, or delete the subscription there.

## GitHub deployment workflow

For initial [deployment workflow](../.github/workflows/terraform-deploy.yml) setup, an AWS admin initializes and plans `infra/terraform/github/` with the same backend bucket, reviews and applies the saved plan, then reads `deploy_role_arn`. If GitHub's OIDC provider already exists, set `create_github_oidc_provider=false`. The role uses GitHub OIDC rather than stored AWS keys and must only be available to trusted workflows.

```powershell
terraform '-chdir=infra/terraform/github' init '-backend-config=bucket=lecturekaki-tfstate-320465872576'
terraform '-chdir=infra/terraform/github' plan '-out=tfplan'
# After reviewing the plan:
terraform '-chdir=infra/terraform/github' apply tfplan
terraform '-chdir=infra/terraform/github' output -raw deploy_role_arn
```

A repository admin creates environment `dev`, adds required reviewers, restricts deployment branches to `main`, and sets repository variables `AWS_DEPLOY_ROLE_ARN` to that role ARN and `TF_STATE_BUCKET` to `lecturekaki-tfstate-320465872576`.

Pushes to `main` create a plan; environment approval permits applying that saved plan and publishing the frontend. Manual runs can refresh lectures. PR CI validates Terraform without AWS access. Saved plans are public workflow artifacts for one day: do not put secrets or personal data in Terraform inputs. Disable the workflow or revoke its AWS role access to stop deployment; deleting the environment removes its protection rules and is not a safe stop mechanism.
