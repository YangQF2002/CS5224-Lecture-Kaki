# Lecture data

The ingestion Lambda turns NUSMods module and timetable data into static JSON for the frontend to read through CloudFront. It supports AY2026/27 Semesters 1–2, excludes university holidays and applies the 14:00 class cut-off on Chinese New Year's Eve (5 February 2027).

Only the NUSMods lesson type `Lecture` is included; other types and NUS-ISS courses are excluded. Personal timetable import must include tutorials, labs and other commitments separately when calculating free time.

## Reading the data

```text
lectures/
  current.json
  <acadYear>/sem-<n>/<snapshot>/
    index.json
    days/<YYYY-MM-DD>.json
    weeks/<label>.json
    modules.json
```

1. Fetch `lectures/current.json` and use its `path` for all related requests.
2. Fetch `<path>index.json` to find available dates and weeks.
3. Fetch `<path>days/<date>.json` for a daily view or `<path>weeks/<label>.json` for a weekly view.

Each run uploads a complete snapshot before switching `current.json`. A failure before the switch leaves the previous snapshot active. Empty catalogues, missing required module metadata, empty session lists and session counts below half the previous run in the same semester are rejected.

Snapshot files use `Cache-Control: public, max-age=86400, immutable`; `current.json` uses `no-cache`. The hosting stack's CloudFront cache policy follows these headers with a minimum TTL of zero, so the pointer is always revalidated.

## Schemas

Every file includes `generatedAt` (UTC ISO timestamp), `acadYear` (e.g. `2026-2027`) and `semester` (`1` or `2`). Dates and lesson times use Singapore time.

| File                 | Additional fields                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| `current.json`       | `path: string`, e.g. `lectures/2026-2027/sem-1/<snapshot>/`                                      |
| `index.json`         | `sessionCount: number`, `days: string[]`, `weeks: Week[]`, `lessonTypes: Record<string, string>` |
| `days/<date>.json`   | `date: string`, `week: string`, `sessions: Session[]`                                            |
| `weeks/<label>.json` | `week: string`, `startDate: string`, `endDate: string`, `sessions: Session[]`                    |
| `modules.json`       | `items: Module[]`, sorted by module code                                                         |

A `Week` contains `week`, `startDate`, `endDate` (strings) and `sessionCount` (number). Labels are `week-01`–`week-13`, `recess`, `reading` and `exam-N`; recess falls between teaching Weeks 6 and 7. Only non-empty dates and weeks appear in the index, in calendar order. `lessonTypes` currently maps `Lecture` to `LEC`.

### Session

Sessions are sorted by date, start time, module code and ID.

| Field                                  | Type           | Meaning                                                      |
| -------------------------------------- | -------------- | ------------------------------------------------------------ |
| `id`                                   | string         | Occurrence identity; see [Session IDs](#session-ids).        |
| `moduleCode`                           | string         | Primary module code.                                         |
| `crossListed`                          | string[]       | Other codes for the same class.                              |
| `moduleTitle`, `faculty`, `department` | string         | Required NUSMods metadata.                                   |
| `level`                                | number \| null | Module level, e.g. `3000`.                                   |
| `lessonType`                           | string         | `Lecture`.                                                   |
| `classNo`                              | string         | Class identifier; preserve leading zeroes.                   |
| `date`                                 | string         | `YYYY-MM-DD`.                                                |
| `startTime`, `endTime`                 | string         | `HH:MM`, 24-hour format.                                     |
| `venue`                                | string         | NUSMods venue code, e.g. `COM1-0207`.                        |
| `building`                             | string \| null | Derived building code; `null` for online or unmapped venues. |
| `online`                               | boolean        | Whether the venue starts with `E-Learn` or `E-Hybrid`.       |
| `size`                                 | number         | Class capacity; `0` when unspecified.                        |

### Session IDs

Format: `<moduleCode>-<lessonTypeCode>-<classNo>@<date>-<HHMM>-<venue>`, e.g. `BT1101-LEC-1@2026-10-20-0800-LT11`.

Adding or removing another occurrence leaves an ID unchanged. Changing its date, start time or venue creates a new ID; saved sessions and discussions must treat it as a different occurrence.

### Module

A `Module` contains `moduleCode`, `title`, `faculty`, `department` (strings), `level` (number or null), `moduleCredit` and `description` (strings or null). Only modules with published sessions are included. Join with sessions on `moduleCode`; `title` corresponds to the session's `moduleTitle`.

## Local development

From `backend/`, generate files using live NUSMods data and in-memory S3, without accessing AWS:

```sh
poetry run python scripts/ingest_local.py
```

Output goes to `backend/out/ingest/lectures/`. Use `--date YYYY-MM-DD` to select a semester or `--out` for another subdirectory of `backend/out`. Existing files are preserved.

The Docker Compose frontend serves this output at <http://localhost:8080/lectures/>. For the Vite dev server, serve it from the repository root; Vite proxies `/lectures` to port 8001:

```sh
python -m http.server 8001 --directory backend/out/ingest
```

To use deployed data instead, start Vite with `LECTURES_ORIGIN=https://<WebsiteURL>`.

## Deployment

Build the Lambda ZIP from `backend/`:

```sh
poetry run python scripts/package_ingest.py
```

This creates `build/ingest.zip` with `jobs/__init__.py`, the `jobs/lecture_ingest/` package and SDK dependencies constrained by `poetry.lock`. Other jobs and the API are excluded. The Lambda entry point is `jobs.lecture_ingest.handler.handler`. Rebuild after source or dependency changes.

The lecture files are written to the website bucket owned by the hosting stack ([`infra/hosting.yaml`](../infra/hosting.yaml)), which exports its name and ARN. Deploy hosting before ingestion with the same `Env`. The bucket is retained when the hosting stack is deleted, and the ingestion stack cannot be deployed without its exports.

From the repository root, use the shared development profile and a private artifact bucket to prepare change sets:

```powershell
$awsProfile = 'cs5224-dev'
$artifactBucket = '<private-artifact-bucket>'
aws cloudformation deploy --template-file infra/hosting.yaml --stack-name lecture-kaki-hosting-dev --parameter-overrides Env=dev --no-execute-changeset --region ap-southeast-1 --profile $awsProfile
aws cloudformation package --template-file infra/ingest.yaml --s3-bucket $artifactBucket --s3-prefix lecture-kaki/ingest --output-template-file build/ingest.packaged.yaml --region ap-southeast-1 --profile $awsProfile
aws cloudformation deploy --template-file build/ingest.packaged.yaml --stack-name lecture-kaki-ingest-dev --parameter-overrides Env=dev --capabilities CAPABILITY_IAM --no-execute-changeset --region ap-southeast-1 --profile $awsProfile
```

Review and execute the hosting change set before creating the ingestion change set. Read `WebBucketName` from the hosting stack outputs and `IngestFunctionName` from the ingestion stack outputs. Both stacks are separate from authentication. For a personal account, see [personal AWS setup](aws-dev-setup.md).

## Scheduling and recovery

The scheduler invokes the Lambda every Monday at 03:00 Singapore time. Ingestion runs during teaching Weeks 1–3 and on the first Monday of each month; other Mondays are skipped.

A manual invocation with a date bypasses the schedule check:

```powershell
aws lambda invoke --function-name '<IngestFunctionName>' --payload '{"date":"2026-10-19"}' --cli-binary-format raw-in-base64-out --region ap-southeast-1 --profile $awsProfile build/ingest-result.json
```

Check the response for `FunctionError` and confirm the published `path` matches `lectures/current.json`. Logs expire after 30 days. Set `AlertEmail` and confirm its SNS subscription to receive Lambda failure alerts.

- Retain previous snapshots for rollback; remove unused snapshots and incomplete uploads after clients no longer need them.
- To roll back, repoint `current.json` to a complete retained snapshot, with its academic year, semester and generation time. Preserve the `no-cache` header.
- Update semester and holiday entries in `backend/jobs/lecture_ingest/academic_calendar.py` before each new academic year.

## Testing and format changes

Run `poetry run python -m pytest tests/jobs/lecture_ingest` from `backend/`. Tests use local fixtures and in-memory S3 without contacting AWS or NUSMods. Fixture samples use AY2026/27 Semester 1 data with descriptions shortened to 120 characters.

Before deployment, inspect the ZIP and verify the packaged handler imports. After deployment, check a manual invocation, the schedule timezone and any failure-alert subscription.

Session/module fields are defined in `backend/jobs/lecture_ingest/transform.py`; file layout is defined in `backend/jobs/lecture_ingest/publish.py`. Coordinate breaking format changes with consumers and update this guide in the same PR.
