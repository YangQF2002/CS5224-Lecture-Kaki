# Architecture

LectureKaki uses a modular monolith: business modules run in one FastAPI process
and are released together as one backend image. The React frontend is compiled
and served by a separate Nginx container. Cognito and its pre-signup Lambda remain
AWS-managed authentication infrastructure.

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

The frontend timetable lives in `frontend/src/features/timetable/`. It reads NUSMods directly and saves selections in browser storage. Its Nginx container serves the site on port 8080; the API listens on port 8000.
