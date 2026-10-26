# LectureKaki backend

For container startup and checks, see [Docker setup](../docs/docker.md).
See [architecture](../docs/architecture.md) for the repository layout and execution boundaries:

- `app/`: the FastAPI application, composed in `app/main.py`, with authentication in `app/modules/auth/`.
- `jobs/lecture_ingest/`: the scheduled ingestion handler and its data processing code, packaged as a separate Lambda.
- `lambdas/pre_signup/`: the Cognito signup validation trigger.
- `scripts/`: local execution and packaging tools.
- `tests/`: API, trigger, and job tests.

Python 3.14 and Poetry.

Run these commands from `backend/`:

```sh
poetry env use 3.14
poetry install
```

Copy [`.env.example`](.env.example) to `.env.local` and fill in the public Cognito values, then start the API:

```sh
poetry run uvicorn app.main:app --reload --env-file .env.local
```

Health check: `http://localhost:8000/health`. API docs: `http://localhost:8000/docs`.

Checks: `poetry run ruff check .`, `poetry run ruff format --check .`, and `poetry run python -m pytest`. Run `poetry run ruff format .` to apply formatting.

## Authentication

Authentication uses Cognito for signup and login. The pre-signup Lambda rejects addresses outside `@u.nus.edu`. Users must confirm their email for signup.

Deploy authentication once to a shared development AWS account in `ap-southeast-1`. CloudFormation creates Cognito, the signup Lambda, its execution role, and logs while a private S3 bucket holds the Lambda deployment package.

See [authentication](../docs/authentication.md) for the flow, integration details, deployment commands, and opt-in Cognito tests.

## Lecture data ingestion

Generate lecture data locally with `poetry run python scripts/ingest_local.py`. This reads public NUSMods data and uses in-memory S3; it does not access AWS.

The implementation lives in `jobs/lecture_ingest/`; its Lambda entry point is `jobs.lecture_ingest.handler.handler`.

See [lecture data](../docs/lecture-data.md) for the output contract, Lambda packaging, deployment and manual ingestion.
