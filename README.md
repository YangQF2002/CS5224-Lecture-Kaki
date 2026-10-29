# LectureKaki

A CS5224 Cloud Computing project to help NUS students discover lectures beyond
their enrolled modules and find companions to attend with, using
[NUSMods](https://api.nusmods.com/v2/) module and timetable data.

## Run with Docker

Install Docker with Compose v2.24 or newer. From the repository root:

```sh
docker compose up --build -d --wait
```

- Frontend: <http://localhost:8080>
- API docs: <http://localhost:8000/docs>
- API health: <http://localhost:8000/health>

To test Cognito login through the API docs, create `backend/.env.local` from [`backend/.env.example`](backend/.env.example) if it does not already exist, and fill in the deployed Cognito configuration. Recreate the API after editing it: `docker compose up -d --force-recreate backend`.
The stack also starts without this file for UI and public health checks.
To deploy your own Cognito and ingestion stacks, see [personal AWS setup](docs/aws-dev-setup.md).

```sh
docker compose run --build --rm backend-test
docker compose run --build --rm frontend-test
python3 scripts/smoke_test.py
docker compose down
```

The smoke test requires the runtime containers to be running. See
[Docker setup](docs/docker.md) for configuration and image maintenance, and
[architecture](docs/architecture.md) for module boundaries.

## Planned tech stack

- **Frontend:** React, TypeScript, Vite, React Router, CSS.
- **Backend:** Python, FastAPI.
- **AWS:** S3, CloudFront, API Gateway, Lambda, Cognito, DynamoDB.

## Current features

- Lecture discovery by week, day, time, building, subject code, faculty, level, class size, and keywords, with shareable filter links.
- Personal timetable with module and lesson-group selection, NUSMods import, browser-local saving, and clash highlighting.

## Planned features

- Interest topics for lecture discovery.
- Lecture recommendations that fit interests and free time.
- Session discussions to connect with other students and find companions.
