# Forum

Students open `/forum`, enter a shared room ID, sign in with Cognito, and post
messages of up to 500 characters. Only the author can delete a message.
Messages disappear after 24 hours.

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
semester: `<sessionId>@<acadYear>@<semester>`, for example
`CS5224-LEC-1@2026-10-27-1830-LT17@2026-2027@1`. Validation checks the format
rather than looking up the lecture catalogue. See
[lecture data](lecture-data.md#session-ids).

## Storage and live updates

`DYNAMODB_TABLE` selects a DynamoDB table with String `PK` and `SK` keys. Reuse
`lecturekaki-dev-forum` in the shared development account. Messages use
`ROOM#<room_id>` / `MSG#<message_id>`; temporary tickets use `TICKET#<hash>` /
`METADATA`. Application filtering enforces expiry; TTL on `ttl` removes records
later. Persistent user profiles must not carry the post TTL.

HTTP writes save to DynamoDB before broadcasting to room sockets. The browser
uses a connection ticket and reloads history after reconnecting, without polling.
WebSockets use the same API origin (`ws://` locally, `wss://` with HTTPS).
Run **one API instance with one Uvicorn worker** because room connections are
stored in memory. Multiple instances or workers require shared broadcasting.

## Local development

Use the Cognito settings described in [authentication](authentication.md#local-configuration).
Add these values to the existing `backend/.env.local`:

```dotenv
DYNAMODB_TABLE=lecturekaki-dev-forum
FRONTEND_ORIGINS=http://localhost:5173,http://localhost:8080
```

From `backend/`, install dependencies and start the API with an approved AWS profile:

```sh
poetry install
AWS_PROFILE='<development-profile>' poetry run uvicorn app.main:app --reload --env-file .env.local
```

Configure `frontend/.env.local` from [`.env.example`](../frontend/.env.example),
using the shared Cognito client and `VITE_API_URL=http://localhost:8000`. From
`frontend/`, run `npm ci` and `npm run dev` with Node 24.22.1 or newer in the 24.x
line. Open <http://localhost:5173/>. Discovery also needs the
[local lecture data](lecture-data.md#local-development).

For the Docker frontend with the native API above, run from the repository root:

```sh
VITE_COGNITO_REDIRECT_URI=http://localhost:8080/auth/callback \
VITE_COGNITO_LOGOUT_URI=http://localhost:8080/forum \
docker compose --env-file frontend/.env.local up --build frontend
```

## Deployment

The API identity needs `dynamodb:GetItem`, `PutItem`, `Query` and `DeleteItem`
on the configured table. Reuse the shared development table; table provisioning
and the shared website/API deployment are managed separately. On EC2, use an
instance role. Local Compose does not mount host AWS credentials.

The Cognito client must allow the frontend's exact callback and logout URLs.
For Vite, use `http://localhost:5173/auth/callback` and
`http://localhost:5173/forum`; for Docker, use port 8080.

For hosted use, set `VITE_API_URL` to the HTTPS API address, include the website
origin in `FRONTEND_ORIGINS`, and register its `/auth/callback` and `/forum` URLs
in Cognito. Callback URLs must use the same origin as the frontend. Rebuild the
frontend after changing its configuration. The HTTP proxy must support WebSockets.

## Testing

From the repository root:

```sh
docker compose run --build --rm backend-test python -m pytest -p no:cacheprovider tests/test_forum.py
docker compose run --build --rm frontend-test npm test -- tests/features/forum
```

For a manual check, sign in as two different users in separate browser sessions:

1. Join the same room and confirm both show live updates connected.
2. Post and delete a message; both sessions should update without refreshing,
   and the other user must not be able to delete it.
3. Refresh or reconnect to check history recovery, then open another room to
   check isolation. Automated tests cover expiry, pagination and invalid requests.
