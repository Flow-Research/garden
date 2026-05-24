#!/usr/bin/env python3

import argparse
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path


WEB_DIR = Path(__file__).resolve().parents[1]
BUCKET = os.environ.get("BUILTIN_SKILLS_BUCKET", "garden-files-dev")
PREFIX = "builtin-skills"
LEGACY_BUNDLES = {
    "xlsx": "0e18c57930faa863bfeed4516fc730bd567089499437c4beb83550d4cb5a03a0",
    "pptx": "b903b70c73ef7182f00810ad498a97fac0411976673681c616e373ac390ec04d",
    "pdf": "7c96a2fd5ed6490df5282564198dba6a93ca5f576457908214cb2599e47a3da5",
    "docx": "28028d93265d45723aa7b182c8951b94662ab60148d96817d5cbb723efe4b388",
}


def main() -> None:
    """Parse CLI flags and migrate every requested legacy document skill bundle."""

    parser = argparse.ArgumentParser(
        description="Copy legacy hashed builtin skill R2 objects to flat builtin-skills/<slug>/<path> keys."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print planned copies without reading or writing R2 objects.",
    )
    parser.add_argument(
        "--slug",
        choices=sorted(LEGACY_BUNDLES),
        action="append",
        help="Limit migration to one or more builtin skill slugs.",
    )
    args = parser.parse_args()

    slugs = args.slug or sorted(LEGACY_BUNDLES)
    with tempfile.TemporaryDirectory(prefix="garden-builtin-skill-r2-migrate-") as temp_dir:
        temp_root = Path(temp_dir)
        for slug in slugs:
            migrate_slug(slug, LEGACY_BUNDLES[slug], temp_root, dry_run=args.dry_run)


def migrate_slug(slug: str, legacy_hash: str, temp_root: Path, *, dry_run: bool) -> None:
    """Copy a content-addressed legacy bundle into Garden's stable file layout."""

    manifest_key = f"{PREFIX}/{slug}/{legacy_hash}/manifest.json"
    if dry_run:
        print(f"would read {BUCKET}/{manifest_key}")
        print(f"would copy every manifest file to {BUCKET}/{PREFIX}/{slug}/<path>")
        return

    manifest_path = temp_root / slug / "manifest.json"
    get_object(manifest_key, manifest_path)
    manifest = json.loads(manifest_path.read_text())
    files = manifest.get("files")
    if not isinstance(files, list):
        raise RuntimeError(f"Legacy manifest for {slug} has no files array")

    for raw_path in files:
        if not isinstance(raw_path, str):
            continue
        path = raw_path.replace("\\", "/").strip("/")
        if not path or any(segment == ".." for segment in path.split("/")):
            continue

        source_key = f"{PREFIX}/{slug}/{legacy_hash}/{path}"
        target_key = f"{PREFIX}/{slug}/{path}"
        local_path = temp_root / slug / path
        print(f"copy {BUCKET}/{source_key} -> {BUCKET}/{target_key}")
        get_object(source_key, local_path)
        put_object(target_key, local_path)


def get_object(key: str, local_path: Path) -> None:
    """Download one R2 object through Wrangler so auth/env handling stays standard."""

    local_path.parent.mkdir(parents=True, exist_ok=True)
    run(
        [
            "pnpm",
            "exec",
            "wrangler",
            "r2",
            "object",
            "get",
            f"{BUCKET}/{key}",
            "--remote",
            "--file",
            str(local_path),
        ]
    )


def put_object(key: str, local_path: Path) -> None:
    """Upload one local file to its stable builtin skill R2 key."""

    run(
        [
            "pnpm",
            "exec",
            "wrangler",
            "r2",
            "object",
            "put",
            f"{BUCKET}/{key}",
            "--remote",
            "--file",
            str(local_path),
        ]
    )


def run(command: list[str]) -> None:
    """Run Wrangler with bounded retries for transient OAuth/R2 failures."""

    attempts = 0
    while True:
        attempts += 1
        result = subprocess.run(command, cwd=WEB_DIR)
        if result.returncode == 0:
            return
        if attempts >= 5:
            raise subprocess.CalledProcessError(result.returncode, command)
        time.sleep(min(attempts * 2, 10))


if __name__ == "__main__":
    main()
