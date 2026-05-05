#!/usr/bin/env python3
"""Reconcile local Miniflare Think facet storage after phase-six renames.

This is intentionally scoped to local `.wrangler/state` storage. Neon/Drizzle
migrations handle Postgres shape; this handles Durable Object facet SQLite files.
"""

from __future__ import annotations

import argparse
import shutil
import sqlite3
from dataclasses import dataclass
from pathlib import Path


STATE_ROOT = Path("apps/web/.wrangler/state/v3")
DO_ROOT = STATE_ROOT / "do"
AGENT_DO_ROOT = DO_ROOT / "garden-web-AgentDO"
BACKUP_GLOB = "do.backup-*/garden-web-*Agent*"


@dataclass(frozen=True)
class MessageStore:
    path: Path
    count: int
    first_content: str
    last_content: str


def parse_facet_keys(path: Path) -> list[str]:
    data = path.read_bytes()
    keys: list[str] = []
    index = 8
    while index + 4 <= len(data):
        length = data[index + 2]
        key = data[index + 4 : index + 4 + length]
        if not key:
            break
        keys.append(key.decode("utf-8").replace("\0", "/"))
        index += 4 + length
    return keys


def assistant_message_count(path: Path) -> MessageStore | None:
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        tables = {
            row[0]
            for row in con.execute(
                "select name from sqlite_master where type = 'table'",
            )
        }
        if "assistant_messages" not in tables:
            return None
        count = con.execute("select count(*) from assistant_messages").fetchone()[0]
        if count == 0:
            return MessageStore(path=path, count=0, first_content="", last_content="")
        first = con.execute(
            "select content from assistant_messages order by created_at asc limit 1",
        ).fetchone()
        last = con.execute(
            "select content from assistant_messages order by created_at desc limit 1",
        ).fetchone()
        return MessageStore(
            path=path,
            count=count,
            first_content=(first[0] if first else ""),
            last_content=(last[0] if last else ""),
        )
    finally:
        con.close()


def index_stores_by_facet(root: Path) -> dict[str, MessageStore]:
    stores: dict[str, MessageStore] = {}
    for facets in root.glob("*.facets"):
        keys = parse_facet_keys(facets)
        for slot, key in enumerate(keys, start=1):
            store = assistant_message_count(facets.with_suffix(f".{slot}.sqlite"))
            if store and store.count > 0:
                stores[key] = store
    return stores


def source_stores() -> dict[str, MessageStore]:
    stores: dict[str, MessageStore] = {}
    for root in [*STATE_ROOT.glob(BACKUP_GLOB), *DO_ROOT.glob("garden-web-*Agent*")]:
        if not root.is_dir():
            continue
        for key, store in index_stores_by_facet(root).items():
            normalized = key.replace("ChatAgent/", "ChatSubAgent/")
            current = stores.get(normalized)
            if current is None or store.count > current.count:
                stores[normalized] = store
    return stores


def reconcile(dry_run: bool) -> int:
    if not AGENT_DO_ROOT.exists():
        print(f"missing {AGENT_DO_ROOT}")
        return 1

    sources = source_stores()
    copied = 0
    missing: list[str] = []
    present = 0

    for facets in sorted(AGENT_DO_ROOT.glob("*.facets")):
        for slot, key in enumerate(parse_facet_keys(facets), start=1):
            if not key.startswith("ChatSubAgent/"):
                continue
            target = facets.with_suffix(f".{slot}.sqlite")
            target_store = assistant_message_count(target) if target.exists() else None
            if target_store and target_store.count > 0:
                present += 1
                continue
            source = sources.get(key)
            if not source:
                missing.append(key)
                continue
            print(f"copy {source.path} -> {target}")
            copied += 1
            if not dry_run:
                shutil.copy2(source.path, target)

    print(f"present={present} copied={copied} missing={len(missing)}")
    for key in missing:
        print(f"missing {key}")

    return 0 if copied > 0 or present > 0 else 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    return reconcile(dry_run=not args.apply)


if __name__ == "__main__":
    raise SystemExit(main())
