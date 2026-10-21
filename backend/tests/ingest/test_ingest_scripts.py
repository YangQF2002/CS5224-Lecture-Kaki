import subprocess
import sys
import zipfile
from pathlib import Path
from unittest.mock import Mock

import pytest

from scripts import ingest_local, package_ingest


def test_output_cannot_target_source_directory(monkeypatch):
    ingest = Mock()
    monkeypatch.setattr(ingest_local, "handler", ingest)
    monkeypatch.setattr(
        sys, "argv", ["ingest_local.py", "--out", str(ingest_local.BACKEND)]
    )

    with pytest.raises(SystemExit) as error:
        ingest_local.main()

    assert error.value.code == 2
    ingest.assert_not_called()


def test_export_preserves_existing_local_files(tmp_path, monkeypatch):
    output = tmp_path / "out" / "ingest"
    output.mkdir(parents=True)
    previous = output / "previous-snapshot.json"
    previous.write_text("previous data", encoding="utf-8")
    monkeypatch.setattr(ingest_local, "BACKEND", tmp_path)
    monkeypatch.setenv("WEB_BUCKET", ingest_local.BUCKET)
    monkeypatch.setattr(sys, "argv", ["ingest_local.py", "--out", str(output)])

    def ingest(event, context, *, s3):
        s3.put_object(
            Bucket=ingest_local.BUCKET, Key="lectures/current.json", Body=b"{}"
        )
        return {"files": 1}

    monkeypatch.setattr(ingest_local, "handler", ingest)
    ingest_local.main()

    assert (output / "lectures" / "current.json").read_bytes() == b"{}"
    assert previous.read_text(encoding="utf-8") == "previous data"


def test_package_excludes_local_files_and_pins_dependencies(tmp_path, monkeypatch):
    backend = tmp_path / "backend"
    backend.mkdir()
    (backend / "poetry.lock").write_text(
        '[[package]]\nname = "boto3"\nversion = "1.43.115"\ngroups = ["main"]\n',
        encoding="utf-8",
    )
    (backend / ".env.local").write_text("SYNTHETIC_TEST_TOKEN", encoding="utf-8")
    for folder in ("handlers", "ingest"):
        directory = backend / folder
        directory.mkdir()
        (directory / "__init__.py").write_text("", encoding="utf-8")
        (directory / ".env.local").write_text("SYNTHETIC_TEST_TOKEN", encoding="utf-8")
    (backend / "tests").mkdir()
    (backend / "tests" / "test_example.py").touch()
    monkeypatch.setattr(package_ingest, "BACKEND", backend)

    def install(command, *, check):
        constraints = command[command.index("--constraint") + 1]
        assert Path(constraints).read_text(encoding="utf-8") == "boto3==1.43.115"
        assert command[-1] == "boto3"
        artifact = Path(command[command.index("--target") + 1])
        artifact.mkdir()
        (artifact / "boto3.py").touch()

    monkeypatch.setattr(subprocess, "run", install)
    output = package_ingest.build_package(tmp_path / "build" / "ingest.zip")

    with zipfile.ZipFile(output) as archive:
        files = {name for name in archive.namelist() if not name.endswith("/")}
        assert files == {"handlers/__init__.py", "ingest/__init__.py", "boto3.py"}
