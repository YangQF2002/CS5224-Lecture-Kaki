# LectureKaki backend

For container startup and checks, see [Docker setup](../docs/docker.md).
See [architecture](../docs/architecture.md) for the repository layout and execution boundaries:

- `app/`: the FastAPI application, composed in `app/main.py`, with feature modules in `app/modules/`.
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

## Forum

The shared API serves authenticated Forum history, posting, owner-only deletion
and native WebSocket updates. See [Forum setup](../docs/forum.md) for the table,
frontend login, local run commands and single-worker deployment limit.
## Personal timetables

`/timetable` stores one timetable per authenticated user. PUT validates selections against NUSMods and replaces the saved timetable; concurrent updates use last-write-wins.

Deploy from the repository root with the [development AWS profile](../docs/aws-dev-setup.md#1-configure-the-cli-profile):

```sh
aws cloudformation deploy --template-file infra/timetable.yaml --stack-name lecture-kaki-timetable-dev --parameter-overrides Env=dev --region ap-southeast-1 --profile cs5224-dev
```

Set `TIMETABLE_TABLE_NAME` in `.env.local` to the stack's `TimetableTableName` output and `AWS_REGION` to its region. Set `FRONTEND_ORIGINS` to the allowed browser origins, comma-separated.

The API's AWS identity needs `dynamodb:GetItem`, `dynamodb:PutItem` and `dynamodb:DeleteItem` on the stack's `TimetableTableArn`; the stack does not grant these permissions. Select `AWS_PROFILE` for native development, use an instance role on EC2, or pass temporary credentials for [local Docker](../docs/docker.md#timetable-storage).

## Lecture data ingestion

Generate lecture data locally with `poetry run python scripts/ingest_local.py`. This reads public NUSMods data and uses in-memory S3; it does not access AWS.

The implementation lives in `jobs/lecture_ingest/`; its Lambda entry point is `jobs.lecture_ingest.handler.handler`.

See [lecture data](../docs/lecture-data.md) for the output contract, Lambda packaging, deployment and manual ingestion.
