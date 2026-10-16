# LectureKaki backend

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
