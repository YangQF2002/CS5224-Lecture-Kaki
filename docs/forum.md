# Forum

Students open `/forum`, enter a room ID, sign in with Cognito, and post messages
of up to 500 characters. Only the author can delete a message. Messages disappear
after 24 hours.

## Local development

The frontend and API run on your laptop. Real sign-in and message storage use the
team's existing Cognito pool and DynamoDB table, so the full feature needs internet
access and your own approved AWS credentials. Automated tests can run without
access to the team's AWS account.

### 1. Prerequisites and team access

Install Git, Python 3.14.x, Poetry 2.4.1, Node.js 24 LTS (24.22.1 or newer in the
24.x line), and AWS CLI v2. Docker with Compose v2.24+ is optional for container
tests or the Docker frontend.

Ask the AWS owner for these once:

- The shared account and CLI sign-in method, with a development profile for you.
  The API needs `dynamodb:GetItem`, `dynamodb:PutItem`, `dynamodb:Query`, and
  `dynamodb:DeleteItem` on `lecturekaki-dev-forum` in `ap-southeast-1`.
- The Cognito user-pool ID, public app-client ID, and hosted domain from the
  existing [auth stack outputs](authentication.md#apply-and-verify).
- Confirmation that the public client allows authorization code flow with PKCE,
  scope `openid`, callback `http://localhost:5173/auth/callback`, and logout URL
  `http://localhost:5173/forum`. Docker frontend users also need the corresponding
  URLs on port 8080. The callback and logout lists must retain other clients' URLs.
- The existing table must have String `PK`/`SK` keys and TTL enabled on `ttl`.
  Reuse it; laptop setup does not require deploying or deleting any stacks.

AWS CLI credentials let the **backend** access DynamoDB. A separate Cognito
account signs you into the **app**. Register your own `@u.nus.edu` account through
Cognito and confirm its email, or use your existing confirmed account. Two-user
manual testing needs two app accounts; do not share passwords or AWS credentials.

### 2. Get the code and prepare AWS access

For a fresh checkout:

```sh
git clone https://github.com/YangQF2002/CS5224-Lecture-Kaki.git
cd CS5224-Lecture-Kaki
git switch feature/forum
```

Use `main` after Forum has been merged. For an existing checkout, save your local
work before switching branches or pulling updates.

Configure your own AWS profile using the owner's sign-in method. The examples
below name it `lecturekaki-dev`; substitute your profile name throughout. If the
team uses IAM Identity Center, use the owner's start URL, account and role:

```sh
aws configure sso --profile lecturekaki-dev
aws sso login --profile lecturekaki-dev
```

For another credential method, follow the owner's profile instructions instead.
Check the selected identity:

```sh
aws sts get-caller-identity --profile lecturekaki-dev
```

Confirm its account with the owner. This checks sign-in, not DynamoDB permissions.

### 3. Configure the backend

From the repository root, copy `backend/.env.example` to `backend/.env.local`
**only if the local file does not already exist**. Replace the placeholders with
the team's public values:

```dotenv
AWS_REGION=ap-southeast-1
COGNITO_USER_POOL_ID=<shared-user-pool-id>
COGNITO_CLIENT_ID=<shared-public-client-id>
COGNITO_DOMAIN=https://<shared-domain>.auth.ap-southeast-1.amazoncognito.com
DYNAMODB_TABLE=lecturekaki-dev-forum
FRONTEND_ORIGINS=http://localhost:5173,http://localhost:8080
```

Keep AWS credentials in your CLI profile. Environment files and tokens must stay
out of Git. The frontend and backend must use the same Cognito app client.

In terminal 1, start from the repository root:

```sh
cd backend
poetry env use 3.14
poetry install --with dev
```

Select your AWS profile in this terminal. On macOS/Linux:

```sh
export AWS_PROFILE=lecturekaki-dev
```

On Windows PowerShell:

```powershell
$env:AWS_PROFILE = 'lecturekaki-dev'
```

Then start the API from `backend/` on either platform:

```sh
poetry run uvicorn app.main:app --reload --host localhost --port 8000 --env-file .env.local
```

Keep this terminal running. Open <http://localhost:8000/health>; expect
`{"status":"ok"}`. API docs are at <http://localhost:8000/docs>. Health can succeed
without database access; the message test below checks the complete feature.

### 4. Configure and start the frontend

Copy `frontend/.env.example` to `frontend/.env.local` only if it does not already
exist. Fill in the same public client ID and hosted domain used by the backend:

```dotenv
VITE_API_URL=http://localhost:8000
VITE_COGNITO_DOMAIN=https://<shared-domain>.auth.ap-southeast-1.amazoncognito.com
VITE_COGNITO_CLIENT_ID=<shared-public-client-id>
VITE_COGNITO_REDIRECT_URI=http://localhost:5173/auth/callback
VITE_COGNITO_LOGOUT_URI=http://localhost:5173/forum
```

In terminal 2, start from the repository root:

```sh
cd frontend
npm ci
npm run dev -- --host localhost --port 5173 --strictPort
```

Open <http://localhost:5173/forum>. Use `localhost` consistently; `127.0.0.1` is a
different origin for CORS and Cognito. If a port is busy, stop the process you no
longer need. Changing ports also requires matching origins and registered login
URLs. Restart Vite after changing its environment file; restart the API after
changing backend configuration.

Forum works without lecture JSON. To browse Discover too, follow
[local lecture data setup](lecture-data.md#local-development): generate the files
with the existing ingestion script and serve them on port 8001 for Vite. Timetable
uses the public NUSMods API. Neither feature needs source changes to test Forum.

## Test the full feature

Use this demo room ID at `/forum`, or share another valid ID:

```text
FORUMTEST-LEC-DEV1@2026-10-30-1000-LOCAL@2026-2027@1
```

The demo passes format validation; no matching catalogue entry is required.
Replace `DEV1` with your own alphanumeric label to avoid mixing unrelated tests.
This still writes to the shared development table.

1. Open the room, select **Sign in**, and complete Cognito login. Expect to return
   to that room with **Live updates connected** and either history or an empty room.
2. In a separate browser profile or private window on the **same laptop**, open
   the same frontend and room, then sign in as the second user.
3. Post a disposable message. Both browsers should see it without refreshing.
   Refresh the page and confirm the message is still present.
4. Only its author should see **Delete**. Delete your own test message; it should
   disappear in both browsers and stay deleted after refresh. Automated tests
   also verify that the API rejects another user's deletion with `403`.
5. Open a different room in one browser and confirm messages remain isolated.
   Blank or over-500-character messages should be blocked. Sign out and confirm
   that accessing a room requires sign-in again.

Use **one API process for both browsers**. Two developers each running an API
against the same table share history, but their live events are not broadcast
between processes. For live tests across laptops, both frontends must use one
reachable shared API with matching allowed origins. Never run multiple workers
for this prototype. Automated tests cover expiry without waiting 24 hours.

Stop the development servers with Ctrl+C. Test messages left behind expire after
24 hours; remove your own disposable messages when finished.

## Testing

These tests use simulated AWS and mocked browser services. They require no real
Cognito accounts, AWS credentials, lecture data, or running development servers.
First-time dependency installation or image builds still need internet access.

With Docker, run from the repository root:

```sh
docker compose run --build --rm backend-test python -m pytest -p no:cacheprovider tests/test_forum.py
docker compose run --build --rm frontend-test npm test -- tests/features/forum
```

Without Docker, after the dependency installs above:

```sh
# From backend/
poetry run python -m pytest tests/test_forum.py
```

```sh
# From frontend/
npm test -- tests/features/forum
```

For all backend/frontend checks and container smoke tests, see
[Docker testing](docker.md#test). Live Cognito integration tests remain opt-in;
see [authentication testing](authentication.md#testing-against-cognito).

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Python version or `poetry` command fails | Install Python 3.14 and Poetry, then select the interpreter with `poetry env use 3.14` or its full path. |
| Vite reports an unsupported Node version | Use Node 24.22.1+ in the 24.x line, then rerun `npm ci`. |
| AWS profile missing or session expired | Use your own configured profile in the backend terminal; renew its login if needed and restart the API. |
| Cognito redirect mismatch or sign-in configured for another website | Match scheme, host, port and path in the frontend settings and Cognito callback/logout lists; restart Vite. |
| Sign-in succeeds but Forum returns `503` | Check the backend terminal, table name, region, credentials and the four DynamoDB permissions. A successful health check does not prove table access. |
| Sign-in repeatedly returns `401` | Confirm both environment files use the same pool's public client and sign in again. |
| CORS error or live connection fails | Check API availability, `VITE_API_URL`, exact `FRONTEND_ORIGINS`, and that there is one API process. |
| Room returns `422` | Use the full room ID format below, without a URL prefix or added spaces. |
| Discover says lecture data is unavailable | Follow the optional lecture data setup above; Forum room entry works independently. |

## API

Forum HTTP routes require a Cognito access token.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/rooms/{room_id}/messages` | Read history; supports `limit` and `cursor`. |
| POST | `/rooms/{room_id}/messages` | Create a message. |
| DELETE | `/rooms/{room_id}/messages/{message_id}` | Delete an owned message. |
| POST | `/rooms/{room_id}/connection-ticket` | Request a short-lived, single-use socket ticket. |
| WebSocket | `/rooms/{room_id}/live?ticket=...` | Receive message creation and deletion events. |

Room IDs combine the unchanged lecture session ID with the academic year and
semester: `<sessionId>@<acadYear>@<semester>`. See
[lecture session IDs](lecture-data.md#session-ids). Validation checks only format.

## Storage and live updates

Messages use `ROOM#<room_id>` / `MSG#<message_id>`; temporary single-use tickets
use `TICKET#<hash>` / `METADATA`. Application filtering hides messages after 24
hours; DynamoDB TTL on `ttl` cleans up records later. Persistent user profiles
must not carry the post TTL. HTTP writes persist before broadcasting to room
sockets. The browser refreshes credentials and history on reconnect without
frequent polling.

## Docker frontend

For the Docker frontend, keep the native API from terminal 1 running. From the
repository root on macOS/Linux:

```sh
VITE_COGNITO_REDIRECT_URI=http://localhost:8080/auth/callback \
VITE_COGNITO_LOGOUT_URI=http://localhost:8080/forum \
docker compose --env-file frontend/.env.local up --build frontend
```

On Windows PowerShell:

```powershell
$env:VITE_COGNITO_REDIRECT_URI = 'http://localhost:8080/auth/callback'
$env:VITE_COGNITO_LOGOUT_URI = 'http://localhost:8080/forum'
docker compose --env-file frontend/.env.local up --build frontend
```

Open <http://localhost:8080/forum>. Keep the registered Cognito URLs and backend
origins consistent with port 8080. Clear these shell overrides before returning
to Vite, or use a fresh terminal. Local Compose does not mount host AWS
credentials into its backend container; the native API is the supported laptop
path for using an AWS profile.

## Deployment

Hosted deployment is managed separately. Use one API instance/worker, an EC2
instance role with the four table permissions, and an HTTPS proxy supporting
WebSockets. Build the frontend with the hosted `VITE_API_URL` and Cognito values,
include the website origin in `FRONTEND_ORIGINS`, and register its exact
`/auth/callback` and `/forum` URLs. Rebuild after configuration changes. See
[architecture](architecture.md) and [Docker configuration](docker.md).

References: [AWS profile configuration](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-files.html),
[AWS SSO login](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html),
[Poetry environments](https://python-poetry.org/docs/managing-environments/),
[Vite CLI](https://vite.dev/guide/cli), and
[Vite environment variables](https://vite.dev/guide/env-and-mode).
