#!/usr/bin/env python3
"""Provision access through an operator's local database connection."""

import argparse
import hashlib
import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.app.core.config import get_settings
from backend.app.repositories.history_store import BenchmarkHistoryRepository


def main():
    parser = argparse.ArgumentParser(description="Generate an API key; display it only once")
    parser.add_argument("--bootstrap", action="store_true", help="Create the first admin only if no admin exists")
    parser.add_argument("--name", help="Name or description for the key")
    parser.add_argument("--scope", choices=["admin", "visitor"], help="Access scope")
    args = parser.parse_args()
    if args.bootstrap and args.scope not in (None, "admin"):
        parser.error("--bootstrap creates an administrator key")
    if not args.bootstrap and (not args.name or not args.scope):
        parser.error("--name and --scope are required unless --bootstrap is used")
    name = (args.name or "Initial administrator").strip()
    if not name:
        parser.error("--name must not be empty")
    scope = args.scope or "admin"
    raw_key = f"{scope}_{secrets.token_urlsafe(32)}"
    key_hash = hashlib.sha256(raw_key.encode("utf-8")).hexdigest()
    settings = get_settings()
    store = BenchmarkHistoryRepository(settings.database_url, settings.tasks_path, settings.git_revision)
    store.create_schema()
    if args.bootstrap:
        if not store.bootstrap_admin_key(key_hash, name):
            print("An administrator already exists. No key was created or changed.")
            return
    else:
        store.create_api_key(key_hash=key_hash, name=name, scope=scope)
    print(f"Created API key: {name} ({scope})")
    print(f"Raw Key: {raw_key}")
    print("Save this key securely. Only its hash is stored; it cannot be shown again.")


if __name__ == "__main__":
    main()
