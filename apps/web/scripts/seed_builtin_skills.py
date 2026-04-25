#!/usr/bin/env python3

import json
import os
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path


SKILLS = ("pdf", "docx", "xlsx", "pptx")
BUCKET = os.environ.get("BUILTIN_SKILLS_BUCKET", "garden-files-dev")
PREFIX = "builtin-skills"


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="garden-builtin-skills-") as temp_dir:
        temp_root = Path(temp_dir)
        for slug in SKILLS:
            payload = download_bundle(slug)
            bundle_hash = payload["hash"]
            files = payload["files"]
            file_paths = [
                str(file["path"]).replace("\\", "/").strip("/") for file in files
            ]

            print(f"seeding {slug} ({bundle_hash})")
            upload_text(
                temp_root / slug / "manifest.json",
                json.dumps({"files": file_paths}, indent=2) + "\n",
                f"{BUCKET}/{PREFIX}/{slug}/{bundle_hash}/manifest.json",
            )
            for file in files:
                path = str(file["path"]).replace("\\", "/").strip("/")
                content = str(file["contents"])
                upload_text(
                    temp_root / slug / path,
                    content,
                    f"{BUCKET}/{PREFIX}/{slug}/{bundle_hash}/{path}",
                )


def download_bundle(slug: str) -> dict:
    with urllib.request.urlopen(
        f"https://skills.sh/api/download/anthropics/skills/{slug}"
    ) as response:
        return json.load(response)


def upload_text(local_path: Path, content: str, object_path: str) -> None:
    local_path.parent.mkdir(parents=True, exist_ok=True)
    local_path.write_text(content)
    run(
        [
            "pnpm",
            "exec",
            "wrangler",
            "r2",
            "object",
            "put",
            object_path,
            "--remote",
            "--file",
            str(local_path),
        ]
    )


def run(command: list[str]) -> None:
    attempts = 0
    while True:
        attempts += 1
        result = subprocess.run(
            command,
            cwd="${REPO_ROOT}/apps/web",
        )
        if result.returncode == 0:
            return
        if attempts >= 5:
            raise subprocess.CalledProcessError(result.returncode, command)
        time.sleep(min(attempts * 2, 10))


if __name__ == "__main__":
    main()
