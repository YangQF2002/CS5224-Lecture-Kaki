"""Build the API Lambda ZIP (FastAPI app + locked Linux dependencies).

The same package backs the HTTP API function and the WebSocket API function;
they differ only by handler (see app/aws_lambda.py).
"""

import shutil
import subprocess
import sys
import tempfile
import tomllib
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
# uvicorn and websockets only serve local development; Lambda calls the app directly.
REQUIREMENTS = ["fastapi", "pyjwt[crypto]", "boto3", "pypdf", "mangum"]


def build_package(output: Path) -> Path:
    output.parent.mkdir(parents=True, exist_ok=True)
    lock = tomllib.loads((BACKEND / "poetry.lock").read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        constraints = root / "constraints.txt"
        constraints.write_text(
            "\n".join(
                f"{package['name']}=={package['version']}"
                for package in lock["package"]
                if "main" in package["groups"]
            ),
            encoding="utf-8",
        )
        artifact = root / "artifact"
        # Wheels for the Lambda runtime, whatever machine builds the package.
        subprocess.run(
            [
                sys.executable,
                "-m",
                "pip",
                "install",
                "--only-binary=:all:",
                "--no-compile",
                "--platform",
                "manylinux_2_28_x86_64",
                "--platform",
                "manylinux2014_x86_64",
                "--implementation",
                "cp",
                "--python-version",
                "3.14",
                "--target",
                str(artifact),
                "--constraint",
                str(constraints),
                *REQUIREMENTS,
            ],
            check=True,
        )
        for source in (BACKEND / "app").rglob("*.py"):
            target = artifact / source.relative_to(BACKEND)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        archive = Path(shutil.make_archive(str(root / "api"), "zip", artifact))
        shutil.copyfile(archive, output)
    return output


if __name__ == "__main__":
    print(build_package(BACKEND.parent / "build" / "api.zip"))
