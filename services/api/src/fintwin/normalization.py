from __future__ import annotations

import hashlib
import json
from decimal import Decimal, InvalidOperation


class InvalidRawTransaction(ValueError):
    pass


def source_hash(payload: dict[str, object]) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def normalize_raw_transactions(records: list[dict[str, object]]) -> list[dict[str, object]]:
    """Validate, decimal-normalize, and deduplicate source rows without inventing data."""
    seen: set[str] = set()
    normalized: list[dict[str, object]] = []
    for record in records:
        payload = record.get("payload")
        if not isinstance(payload, dict):
            raise InvalidRawTransaction("source payload must be an object")
        digest = str(record.get("source_hash") or source_hash(payload))
        if digest in seen:
            continue
        try:
            amount = Decimal(str(payload["amount"])).quantize(Decimal("0.01"))
        except (KeyError, InvalidOperation) as exc:
            raise InvalidRawTransaction("amount must be a decimal string") from exc
        seen.add(digest)
        normalized.append({**payload, "amount": f"{amount:.2f}", "source_hash": digest})
    return normalized
