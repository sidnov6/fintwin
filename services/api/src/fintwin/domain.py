from __future__ import annotations

from dataclasses import asdict, dataclass
from decimal import Decimal


def money(value: str | int | Decimal) -> Decimal:
    return Decimal(value).quantize(Decimal("0.01"))


@dataclass(frozen=True, slots=True)
class Account:
    account_id: str
    household_id: str
    name: str
    kind: str
    opening_balance: Decimal
    currency: str = "EUR"


@dataclass(frozen=True, slots=True)
class Transaction:
    transaction_id: str
    source_id: str
    household_id: str
    account_id: str
    booking_date: str
    value_date: str
    amount: Decimal
    currency: str
    description: str
    merchant: str
    category: str
    excluded_from_spend: bool = False
    event_label: str | None = None

    def normalized(self) -> dict[str, object]:
        value = asdict(self)
        value["amount"] = f"{self.amount:.2f}"
        return value


@dataclass(frozen=True, slots=True)
class BalanceSnapshot:
    household_id: str
    account_id: str
    period: str
    opening_balance: Decimal
    closing_balance: Decimal

    def normalized(self) -> dict[str, str]:
        return {
            "household_id": self.household_id,
            "account_id": self.account_id,
            "period": self.period,
            "opening_balance": f"{self.opening_balance:.2f}",
            "closing_balance": f"{self.closing_balance:.2f}",
        }


@dataclass(frozen=True, slots=True)
class Link:
    link_id: str
    household_id: str
    first_transaction_id: str
    second_transaction_id: str
