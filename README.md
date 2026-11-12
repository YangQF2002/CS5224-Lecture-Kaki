# LectureKaki

A CS5224 project helping NUS students discover lectures beyond their enrolled modules and find companions to attend with, using [NUSMods](https://api.nusmods.com/v2/) data.

Implemented features:

- Lecture discovery with shareable filters for time, place, subject, topic and keywords.
- Personal timetables with lesson selection, NUSMods import, clash highlighting, browser storage and account saving.
- Lecture discussions with Cognito login, PDF attachments, message history, owner-only deletion and live WebSocket updates.

## Deployment

The app runs entirely on AWS (`ap-southeast-1`): CloudFront and S3 serve the React build and lecture data, FastAPI runs on Lambda behind API Gateway, and Cognito, DynamoDB, EventBridge Scheduler, Bedrock, CloudWatch and SNS provide sign-in, storage, weekly jobs, topic tagging and alerts. Terraform in `infra/terraform/` defines the infrastructure, and the [deployment workflow](.github/workflows/terraform-deploy.yml) applies it and publishes the frontend after each approved push to `main`. See [deployment](docs/deployment.md).

## Local development

With Python 3.14, Poetry 2.4.1 and Node.js 24, start the API from `backend/` with `poetry install --with dev` and `poetry run uvicorn app.main:app --reload`, and the frontend from `frontend/` with `npm ci` and `npm run dev`. Login and database features need the shared development configuration; follow [development setup](docs/development.md).

## Documentation

| Guide                                | Contents                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| [Development](docs/development.md)   | Onboarding, AWS login, local data, running locally and verification.         |
| [Architecture](docs/architecture.md) | Runtime boundaries, security and data contracts, and source references.      |
| [Deployment](docs/deployment.md)     | Infrastructure changes, application releases, ingestion and recovery.        |

Detailed API schemas are available in `/docs`; configuration keys live in the backend and frontend `.env.example` files. Keep implementation details beside their code and update the relevant guide when a workflow or contract changes.
