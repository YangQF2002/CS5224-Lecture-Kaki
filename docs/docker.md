# Docker setup

Run commands from the repository root with Docker and Compose v2.24 or newer.
Python, Poetry, and Node are supplied by the images.

## Start and stop

```sh
docker compose up --build -d --wait
docker compose logs -f
docker compose down
```

The frontend is at <http://localhost:8080>, and the API docs are at
<http://localhost:8000/docs>. Both services have health checks; `--wait` waits for
both to become healthy. Published ports bind to the local machine.

Compose reads optional runtime configuration from `backend/.env.local`. Create
it from `backend/.env.example` only if it does not exist, then fill in the public
Cognito values from your stack outputs. Environment files and credentials are
excluded from Docker build contexts. AWS credentials are not needed by the API.
After changing configuration, recreate the backend:

```sh
docker compose up -d --force-recreate backend
```

Without Cognito configuration, `/health` and the frontend work; protected calls
with a token return `503`. Requests without a token return `401`.
Authentication still uses the deployed Cognito pool. The existing callback
`http://localhost:8000/docs/oauth2-redirect` and logout URL
`http://localhost:8000/docs` remain valid with the default ports.

Set `BACKEND_PORT` or `FRONTEND_PORT` in your shell to use other host ports. If
you change the API port, register the exact new callback and logout URLs with
Cognito before testing login. See [authentication](authentication.md).

These images run production processes without bind mounts or hot reload. Rebuild after
source changes with `docker compose up --build -d --wait`. For hot reload,
use the native workflows in the [backend](../backend/README.md) and
[frontend](../frontend/README.md) READMEs.

## Test

```sh
docker compose run --build --rm backend-test
docker compose run --build --rm frontend-test
python3 scripts/smoke_test.py
```

The `test` profile keeps test services out of a normal `up`; explicitly running a
test service enables it. Backend checks run Ruff and the offline pytest suite.
Frontend checks run ESLint, Prettier, TypeScript, and the Vite build. The smoke
script requires Python 3 on the host and running runtime containers; it verifies
public health, protected-route rejection, API docs, static assets, cache headers,
and SPA fallback behavior.

CI runs three independent jobs: backend lint, formatting and offline tests; frontend lint, formatting, type checking and production build; and Docker runtime builds, infrastructure validation and smoke tests against the running stack. Application checks use their respective test containers. The backend image build also runs `poetry check --lock` to validate the dependency lockfile.

Live Cognito tests stay opt-in. After adding fresh test tokens as described in
[authentication](authentication.md), explicitly pass that file to the test image:

```sh
docker build --target test --tag lecture-kaki-backend-test ./backend
docker run --rm --env-file backend/.env.local lecture-kaki-backend-test python -m pytest -m cognito tests/integration -p no:cacheprovider
```

## Image design and updates

The Dockerfiles follow [Docker's build best practices](https://docs.docker.com/build/building/best-practices/):

- Multi-stage builds separate dependency installation, tests, and runtime.
  The API runtime contains only application dependencies and API source; the
  frontend runtime contains Nginx and Vite's compiled assets.
- Official slim Python/Node and Alpine Nginx images are pinned to multi-platform
  image digests. Dependabot proposes weekly base-image updates for review.
- Poetry installs from `poetry.lock`; npm uses `npm ci` and `package-lock.json`.
  Lockfiles are copied before source so dependency layers can be reused.
  BuildKit cache mounts retain downloads without putting them in runtime layers.
- Allowlist-based `.dockerignore` files exclude local environments, dependency
  folders, caches, and credentials. Configuration is supplied at runtime.
- Runtime containers use non-root users, read-only filesystems, a writable
  temporary directory, dropped capabilities, and no privilege escalation.
- Uvicorn and Nginx run in the foreground with exec-form commands. Logs go to
  stdout/stderr, and health checks use tools already in the runtime images.

After accepting a base-image update, rebuild and rerun the tests. To rebuild all
layers using the currently pinned images:

```sh
docker compose build --pull --no-cache
docker compose up -d --wait
```

`--pull` does not advance a pinned digest; update the Dockerfile digest to adopt
a newer base. The Compose stack is intended for local execution. A deployment
should provide TLS, environment-specific ingress, and runtime configuration.
