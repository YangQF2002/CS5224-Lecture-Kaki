"""Build the ingestion Lambda ZIP from allowlisted source and locked dependencies."""

import shutil
import subprocess
import sys
import tempfile
import tomllib
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent


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
        subprocess.run(
            [
                sys.executable,
                "-m",
                "pip",
                "install",
                "--only-binary=:all:",
                "--no-compile",
                "--target",
                str(artifact),
                "--constraint",
                str(constraints),
                "boto3",
            ],
            check=True,
        )
        sources = [BACKEND / "jobs" / "__init__.py"]
        sources.extend((BACKEND / "jobs" / "lecture_ingest").rglob("*.py"))
        for source in sources:
            target = artifact / source.relative_to(BACKEND)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        archive = Path(shutil.make_archive(str(root / "ingest"), "zip", artifact))
        shutil.copyfile(archive, output)
    return output


if __name__ == "__main__":
    print(build_package(BACKEND.parent / "build" / "ingest.zip"))
