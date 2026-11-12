# Development

Commands use PowerShell from the repository root unless stated otherwise.

## Prerequisites

- Backend and data generation: Python 3.14.x and Poetry 2.4.1.
- Frontend: Node.js 24 LTS, minimum 24.22.1.
- AWS CLI v2.32.0+ for shared DynamoDB access.

## AWS access

Use your own IAM user:

```powershell
aws login --profile cs5224-dev --region ap-southeast-1
aws sts get-caller-identity --profile cs5224-dev --region ap-southeast-1
```

Select your IAM user in the browser. Renew expired sessions with the same `aws login` command. See [AWS browser login](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html) for required sign-in permissions.

## Shared configuration

Reuse the existing team resources. Read Cognito settings and create missing local environment files:

```powershell
aws cloudformation describe-stacks --stack-name lecture-kaki-auth-dev --query 'Stacks[0].Outputs' --output table --region ap-southeast-1 --profile cs5224-dev
if (-not (Test-Path backend/.env.local)) { Copy-Item backend/.env.example backend/.env.local }
if (-not (Test-Path frontend/.env.local)) { Copy-Item frontend/.env.example frontend/.env.local }
```

Fill in the [backend](../backend/.env.example) and [frontend](../frontend/.env.example) settings. Map `UserPoolId`, `ClientId` and `HostedDomain` to `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID` and `COGNITO_DOMAIN`; use the same client/domain in the frontend.

| Feature   | Backend setting / table schema                                                                  | Required table permissions                                                            |
| --------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Forum     | `DYNAMODB_TABLE`; String `PK` + `SK`; TTL on `ttl`. Example: `lecturekaki-dev-forum`.           | `dynamodb:GetItem`, `dynamodb:PutItem`, `dynamodb:UpdateItem`, `dynamodb:Query`, `dynamodb:DeleteItem`. |
| Timetable | `TIMETABLE_TABLE_NAME`; String partition key `user_id`; no TTL. Use the timetable stack output. | `dynamodb:GetItem`, `dynamodb:PutItem`, `dynamodb:DeleteItem`.                        |
| Profile   | `PROFILE_TABLE_NAME`; String partition key `user_id`; no TTL. Created by `infra/terraform/`.    | `dynamodb:GetItem`, `dynamodb:PutItem`, `dynamodb:UpdateItem`, `dynamodb:DeleteItem`. |

The Cognito public client needs code flow, scope `openid` and these callback/logout URLs. Retain existing clients' URLs when updating the lists.

| Client          | Callback                                     | Logout                        |
| --------------- | -------------------------------------------- | ----------------------------- |
| Vite            | `http://localhost:5173/auth/callback`        | `http://localhost:5173/forum` |
| API docs        | `http://localhost:8000/docs/oauth2-redirect` | `http://localhost:8000/docs`  |

Use `localhost` consistently. Match frontend URLs and API `FRONTEND_ORIGINS` to the chosen ports. Restart API/Vite after environment changes.

Leave `FORUM_WEBSOCKET_URL` and `FORUM_FANOUT_FUNCTION` empty locally; the API serves live connections in one process. PDF uploads also require S3 permissions described in [deployment](deployment.md#infrastructure-ownership).

## Running locally

API terminal:

```powershell
Set-Location backend
poetry env use 3.14
poetry install --with dev
$env:AWS_PROFILE = 'cs5224-dev'
poetry run python -c "import boto3; print(boto3.client('sts', region_name='ap-southeast-1').get_caller_identity()['Arn'])"
```

The ARN must identify your IAM user in the team account. Clear stale access-key environment overrides if necessary. Dev dependencies include CRT support for [browser-login profiles](https://docs.aws.amazon.com/boto3/latest/guide/credentials.html). After the identity check succeeds, start the API from `backend/`:

```powershell
poetry run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000 --env-file .env.local
```

Separate frontend terminal, starting at the repository root:

```powershell
Set-Location frontend
npm ci
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open <http://localhost:5173>. Sign in through Forum with a confirmed `@u.nus.edu` Cognito account; this is separate from IAM access.

## Lecture data

From `backend/`, generate lecture files using public NUSMods data and simulated S3, without AWS access:

```powershell
poetry run python scripts/ingest_local.py
```

Output: `backend/out/ingest/lectures/`. Use `--date YYYY-MM-DD` to select a semester or `--out` for another subdirectory of `backend/out`.

For Vite, serve the output in another terminal from `backend/`:

```powershell
poetry run python -m http.server 8001 --bind 127.0.0.1 --directory out/ingest
```

Vite proxies `/lectures` to port 8001. To use hosted data instead, set `$env:LECTURES_ORIGIN = 'https://<website-host>'` before starting Vite.

## Checks

CI runs the same checks on every pull request.

| Folder        | Checks                                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------------------------- |
| `backend/`    | `poetry check --lock`; `poetry run ruff check .`; `poetry run ruff format --check .`; `poetry run python -m pytest`. |
| `frontend/`   | `npm run lint`; `npm run format:check` (add `-- --end-of-line auto` on Windows); `npm test`; `npm run build`.        |

For live Cognito tests, put fresh `COGNITO_TEST_ACCESS_TOKEN` and `COGNITO_TEST_ID_TOKEN` from the browser Network panel's same `/oauth2/token` response in `backend/.env.local`. From `backend/`, run `poetry run python -m pytest -m cognito tests/integration`, then remove the tokens. Normal tests exclude these live checks.

Manual checks: use two app users in separate browser profiles against one API. Verify live messages, persistence after refresh, author-only deletion, room isolation and logout. Verify timetable saving after reload and account isolation. Also check email confirmation, password recovery, refresh and refresh-token revocation.

## Troubleshooting

| Symptom                               | Check                                                                                                                         |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Lecture list unavailable              | Generated data; port 8001 server for Vite or `LECTURES_ORIGIN`.                                                               |
| Redirect/CORS failure                 | Exact URLs, frontend API URL, Cognito callback/logout lists and API origins.                                                  |
| `401` after login                     | Matching Cognito client and a fresh access token.                                                                             |
| Storage returns `503`                 | Table name/region, credentials and permissions; `/health` does not check storage.                                             |
| SDK profile error                     | Dev dependencies, selected profile and stale key overrides.                                                                   |
| History works but live delivery fails | Local: one API process and the WebSocket origin. Deployed: readiness acknowledgement, connection/fan-out logs and SNS alerts. |
