# Architecture

LectureKaki groups code by where it runs. The React frontend runs in the browser
and is served by Nginx. The FastAPI application is a modular monolith: its API
modules run in one process and are released together as one backend image.
Scheduled jobs and Cognito triggers are packaged separately for AWS Lambda.

```text
frontend/src/features/
  timetable/              Browser UI, NUSMods import, clash detection and storage
backend/
  app/                    FastAPI application and API modules
  jobs/
    __init__.py           Background jobs package
    lecture_ingest/       Scheduled job, packaged as its own Lambda
      handler.py          Lambda entry point
      academic_calendar.py
      lesson_types.py
      nusmods.py
      publish.py
      transform.py
      venues.py
  lambdas/
    pre_signup/           Cognito event trigger
  scripts/                Local execution and packaging tools
  tests/
    jobs/lecture_ingest/   Job tests and fixtures
infra/                    AWS resource definitions
```

Within the API, feature modules have the following structure:

```text
backend/app/
  main.py                 Application composition and Swagger configuration
  health.py               Process health endpoint
  modules/
    auth/
      __init__.py         Public interface: router, CurrentUser, get_current_user
      api.py              HTTP routes
      dependencies.py     Cognito token validation and signing-key cache
      schemas.py          Authentication data contracts
```

`main.py` includes each module's router. It contains application wiring, while
feature behavior belongs to the module that owns it. Other modules import the
authentication interface from `app.modules.auth`:

```python
from typing import Annotated

from fastapi import Depends

from app.modules.auth import CurrentUser, get_current_user


def protected_operation(
    user: Annotated[CurrentUser, Depends(get_current_user)],
):
    return {"user_id": user.user_id}
```

Add future features under `app/modules/<feature>/` and register their routers in
`main.py`. Keep their schemas, business rules, and persistence access together.
Introduce service and repository files when those responsibilities exist; avoid
empty layers. Modules communicate through their public Python interfaces, using
in-process calls. Each module owns its data access; other modules should use its
public operations rather than reading or modifying its storage directly.

The pre-signup Lambda is packaged independently by `infra/auth.yaml`, because
Cognito invokes it in AWS. It is included in the backend test image but excluded
from the API runtime image.

The scheduled ingestion job keeps its handler and processing code together in
`backend/jobs/lecture_ingest/`. `backend/scripts/package_ingest.py` packages this
job and its SDK dependencies; `infra/template.yaml` configures the Lambda entry
point as `jobs.lecture_ingest.handler.handler`. The job publishes lecture JSON
snapshots to S3. It is included in the backend test image and excluded from the
API runtime image. `backend/scripts/ingest_local.py` runs the same handler with
in-memory S3 for local development.

The frontend timetable lives in `frontend/src/features/timetable/`. It reads
NUSMods directly and saves selections in browser storage. It currently operates
independently of API authentication and the ingested lecture snapshots. Its
Nginx container serves the site on port 8080; the API listens on port 8000.
