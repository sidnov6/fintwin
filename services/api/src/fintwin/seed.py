from __future__ import annotations

import argparse
import json
from pathlib import Path

from .generator import generate_fixture


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate the canonical synthetic Becker household fixture.")
    parser.add_argument("--seed", type=int, default=20260830)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--database-url", default=None, help="Load PostgreSQL after writing the fixture")
    args = parser.parse_args()
    fixture = generate_fixture(args.seed)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(fixture, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n")
    print(f"Wrote {len(fixture['transactions'])} transactions to {args.output}")
    print(f"Fixture SHA-256: {fixture['fixture_sha256']}")
    if args.database_url:
        from .database_seed import load_fixture
        load_fixture(args.database_url, fixture)
        print("Loaded canonical fixture into PostgreSQL")


if __name__ == "__main__":
    main()
