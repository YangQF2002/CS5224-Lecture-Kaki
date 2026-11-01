# LectureKaki

A CS5224 project helping NUS students discover lectures beyond their enrolled modules and find companions to attend with, using [NUSMods](https://api.nusmods.com/v2/) data.

Implemented features:

- Lecture discovery with shareable filters for time, place, subject and keywords.
- Personal timetables with lesson selection, NUSMods import, clash highlighting, browser storage and account saving.
- Lecture discussions with Cognito login, message history, owner-only deletion and live WebSocket updates.

## Quick start

Install Docker with Compose v2.24+, then run from the repository root:

```sh
docker compose up --build -d --wait
```

Open the [frontend](http://localhost:8080) or [API docs](http://localhost:8000/docs). This starts the UI and public health endpoint. Lecture browsing needs generated data; login and database features need the shared development configuration. Follow [development setup](docs/development.md) to enable them and run checks. Stop with `docker compose down`.

## Documentation

| Guide                                | Contents                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| [Development](docs/development.md)   | Onboarding, AWS login, local data, native/Docker workflows and verification. |
| [Architecture](docs/architecture.md) | Runtime boundaries, security and data contracts, and source references.      |
| [Deployment](docs/deployment.md)     | Infrastructure changes, application releases, ingestion and recovery.        |

Detailed API schemas are available in `/docs`; configuration keys live in the backend and frontend `.env.example` files. Keep implementation details beside their code and update the relevant guide when a workflow or contract changes.
