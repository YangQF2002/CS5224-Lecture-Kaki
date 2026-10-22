"""Generate lecture files locally using live NUSMods data and in-memory S3."""

import argparse
import json
import os
import sys
from datetime import date
from pathlib import Path

import boto3
from moto import mock_aws

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from handlers.ingest import handler

BUCKET = "lecturekaki-local-web"
REGION = "ap-southeast-1"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--date",
        default=date.today().isoformat(),
        help="any date in the semester to ingest (default: today)",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=BACKEND / "out" / "ingest",
        help="where to copy the bucket contents (default: backend/out/ingest)",
    )
    args = parser.parse_args()
    output = args.out.resolve()
    output_root = (BACKEND / "out").resolve()
    if output == output_root or not output.is_relative_to(output_root):
        parser.error("--out must be a subdirectory of backend/out")

    os.environ["WEB_BUCKET"] = BUCKET
    with mock_aws():
        s3 = boto3.client("s3", region_name=REGION)
        s3.create_bucket(
            Bucket=BUCKET,
            CreateBucketConfiguration={"LocationConstraint": REGION},
        )

        event = {"date": args.date}
        print(json.dumps(handler(event, None, s3=s3), indent=2))
        count = 0
        for page in s3.get_paginator("list_objects_v2").paginate(Bucket=BUCKET):
            for obj in page.get("Contents", []):
                path = output / obj["Key"]
                path.parent.mkdir(parents=True, exist_ok=True)
                body = s3.get_object(Bucket=BUCKET, Key=obj["Key"])["Body"].read()
                path.write_bytes(body)
                count += 1
        print(f"Copied {count} files to {output}")


if __name__ == "__main__":
    main()
