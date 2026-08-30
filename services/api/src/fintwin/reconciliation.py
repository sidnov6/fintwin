from __future__ import annotations

from collections import defaultdict
from decimal import Decimal


def reconcile(fixture: dict[str, object]) -> list[dict[str, str]]:
    movements: dict[tuple[str, str], Decimal] = defaultdict(lambda: Decimal("0.00"))
    for tx in fixture["transactions"]:  # type: ignore[index]
        movements[(tx["account_id"], tx["booking_date"][:7])] += Decimal(tx["amount"])
    results = []
    for snapshot in fixture["balance_snapshots"]:  # type: ignore[index]
        expected = Decimal(snapshot["opening_balance"]) + movements[(snapshot["account_id"], snapshot["period"])]
        difference = expected - Decimal(snapshot["closing_balance"])
        results.append({"account_id": snapshot["account_id"], "period": snapshot["period"], "difference": f"{difference:.2f}", "status": "reconciled" if abs(difference) <= Decimal("0.01") else "needs_review"})
    return results


def external_spend(fixture: dict[str, object]) -> Decimal:
    return -sum((Decimal(tx["amount"]) for tx in fixture["transactions"] if Decimal(tx["amount"]) < 0 and not tx["excluded_from_spend"]), Decimal("0.00"))  # type: ignore[index]
