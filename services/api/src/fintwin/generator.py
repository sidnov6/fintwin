from __future__ import annotations

import calendar
import hashlib
import json
import random
from collections import defaultdict
from dataclasses import asdict
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP

from .domain import Account, BalanceSnapshot, Link, Transaction, money
from .normalization import source_hash

CENT = Decimal("0.01")
HOUSEHOLD_ID = "hh_becker"


def month_range(start: date, count: int):
    year, month = start.year, start.month
    for _ in range(count):
        yield year, month
        month += 1
        if month == 13:
            month, year = 1, year + 1


def safe_date(year: int, month: int, day: int) -> date:
    return date(year, month, min(day, calendar.monthrange(year, month)[1]))


def q(value: Decimal | float | str) -> Decimal:
    return Decimal(str(value)).quantize(CENT, rounding=ROUND_HALF_UP)


class BeckerGenerator:
    """Reproducible, source-like five-year ledger for the synthetic Becker household."""

    def __init__(self, seed: int = 20260830, months: int = 60) -> None:
        self.seed = seed
        self.months = months
        self.rng = random.Random(seed)
        self.transactions: list[Transaction] = []
        self.transfer_links: list[Link] = []
        self.reversal_links: list[Link] = []
        self.sequence = 0
        self.accounts = [
            Account("acc_joint", HOUSEHOLD_ID, "Gemeinschaftskonto", "current", money("8450")),
            Account("acc_card_m", HOUSEHOLD_ID, "Michael Karte", "card", money("0")),
            Account("acc_card_a", HOUSEHOLD_ID, "Anna Karte", "card", money("0")),
            Account("acc_savings", HOUSEHOLD_ID, "Tagesgeld", "savings", money("22800")),
            Account("acc_mortgage", HOUSEHOLD_ID, "Immobiliendarlehen", "mortgage", money("-286400")),
            Account("acc_invest_m", HOUSEHOLD_ID, "Michael Depot", "investment", money("0")),
            Account("acc_invest_a", HOUSEHOLD_ID, "Anna Depot", "investment", money("0")),
        ]

    def _add(self, account: str, when: date, amount: Decimal | str, description: str, merchant: str, category: str, *, excluded: bool = False, label: str | None = None) -> Transaction:
        self.sequence += 1
        tx_id = f"txn_{self.sequence:06d}"
        tx = Transaction(tx_id, f"src_{tx_id}", HOUSEHOLD_ID, account, when.isoformat(), when.isoformat(), q(amount), "EUR", description, merchant, category, excluded, label)
        self.transactions.append(tx)
        return tx

    def _transfer(self, source: str, destination: str, when: date, amount: Decimal, label: str | None = None) -> None:
        ref = f"TR-{when:%Y%m}-{len(self.transfer_links)+1:03d}"
        outgoing = self._add(source, when, -amount, f"Own transfer {ref}", "Becker household", "internal_transfer", excluded=True, label=label)
        incoming = self._add(destination, when, amount, f"Own transfer {ref}", "Becker household", "internal_transfer", excluded=True, label=label)
        self.transfer_links.append(Link(f"transfer_{len(self.transfer_links)+1:04d}", HOUSEHOLD_ID, outgoing.transaction_id, incoming.transaction_id))

    def _reversal(self, account: str, when: date, amount: Decimal, merchant: str) -> None:
        original = self._add(account, when, -amount, f"Card purchase · {merchant}", merchant, "shopping")
        reversal = self._add(account, when + timedelta(days=2), amount, f"Refund · {merchant}", merchant, "refund", label="planted_refund_reversal")
        self.reversal_links.append(Link(f"reversal_{len(self.reversal_links)+1:04d}", HOUSEHOLD_ID, original.transaction_id, reversal.transaction_id))

    def generate(self) -> dict[str, object]:
        merchants = [
            ("REWE", "groceries", (8, 92)), ("EDEKA", "groceries", (10, 115)), ("dm", "household", (5, 58)),
            ("Shell", "transport", (25, 95)), ("Deutsche Bahn", "transport", (12, 130)), ("Mensa", "education", (4, 24)),
            ("Apotheke", "health", (7, 48)), ("Café Morgenrot", "dining", (4, 34)), ("Buchhandlung", "leisure", (6, 55)),
            ("Sporthaus", "shopping", (12, 120)), ("BioMarkt", "groceries", (8, 78)), ("Veedel Bäckerei", "dining", (3, 18)),
        ]
        start = date(2021, 9, 1)
        for month_index, (year, month) in enumerate(month_range(start, self.months)):
            promotion = month_index >= 47
            michael_salary = money("4380" if promotion else ("4050" if month_index >= 24 else "3820"))
            anna_salary = money("2860")
            label = "michael_promotion" if month_index == 47 else None
            self._add("acc_joint", safe_date(year, month, 27), michael_salary, "Salary Michael Becker", "Synthetic employer A", "income", label=label)
            self._add("acc_joint", safe_date(year, month, 28), anna_salary, "Salary Anna Becker", "Synthetic employer B", "income")
            if month == 12:
                self._add("acc_joint", safe_date(year, month, 12), money("3200"), "Annual performance bonus", "Synthetic employer A", "income", label="annual_bonus")

            recurring = [
                (2, "Mortgage payment", "Synthetic mortgage", "housing", "-1420"),
                (3, "Car loan", "Synthetic auto finance", "debt", "-286"),
                (4, "Electricity", "Rhein Energie Demo", "utilities", "-148"),
                (5, "Telecom", "Demo Telekom", "utilities", "-74"),
                (6, "Health insurance", "Synthetic insurer", "insurance", "-612"),
                (7, "Income protection premium", "Synthetic insurer", "insurance", "-89"),
                (8, "University support", "Becker child", "education", "-520"),
            ]
            for day, desc, merchant, category, amount in recurring:
                drift = Decimal("0")
                if month_index >= 48 and category in {"utilities", "insurance"}:
                    drift = Decimal("-26.80")
                event = "recurring_cost_drift" if month_index == 48 and desc == "Electricity" else None
                self._add("acc_joint", safe_date(year, month, day), money(amount) + drift, desc, merchant, category, label=event)

            self._transfer("acc_joint", "acc_savings", safe_date(year, month, 10), money("500"), "reserve_contribution")
            self._transfer("acc_joint", "acc_invest_m", safe_date(year, month, 11), money("350"), "wealth_contribution")
            self._transfer("acc_joint", "acc_invest_a", safe_date(year, month, 11), money("250"), "wealth_contribution")
            self._transfer("acc_joint", "acc_card_m", safe_date(year, month, 25), money("1150"))
            self._transfer("acc_joint", "acc_card_a", safe_date(year, month, 25), money("1050"))

            # 108 plausible card purchases/month yields a five-year fixture in the 5k–10k target range.
            days = calendar.monthrange(year, month)[1]
            for purchase_index in range(108):
                merchant, category, amount_range = merchants[self.rng.randrange(len(merchants))]
                account = "acc_card_m" if purchase_index % 2 == 0 else "acc_card_a"
                when = safe_date(year, month, 1 + self.rng.randrange(days))
                amount = q(self.rng.uniform(*amount_range))
                seasonal = Decimal("1.35") if month in {7, 12} and category in {"leisure", "shopping"} else Decimal("1")
                self._add(account, when, -(amount * seasonal), f"Card purchase · {merchant}", merchant, category)

            if month_index % 3 == 0:
                self._reversal("acc_card_m", safe_date(year, month, 14), money("68.40"), "Online Store Demo")
            if month_index == 46:
                self._add("acc_mortgage", safe_date(year, month, 30), money("0"), "Fixed-rate horizon: 14 months", "Synthetic mortgage", "contract_marker", excluded=True, label="mortgage_refix_14_months")

        self.transactions.sort(key=lambda tx: (tx.booking_date, tx.transaction_id))
        balances = self._balances()
        raw_transactions = []
        for index, tx in enumerate(self.transactions):
            payload = tx.normalized()
            digest = source_hash(payload)
            raw_transactions.append({"raw_id": f"raw_{index + 1:06d}", "household_id": HOUSEHOLD_ID, "source_hash": digest, "payload": payload})
            # Deliberate repeated source delivery: normalization must keep only one canonical row.
            if index % 1500 == 0:
                raw_transactions.append({"raw_id": f"raw_duplicate_{index + 1:06d}", "household_id": HOUSEHOLD_ID, "source_hash": digest, "payload": payload})

        normalized = {
            "schema_version": "1.0",
            "seed": self.seed,
            "household": {
                "household_id": HOUSEHOLD_ID,
                "name": "Michael & Anna Becker",
                "synthetic": True,
                "members": [
                    {"person_id": "person_michael", "name": "Michael Becker", "age": 52},
                    {"person_id": "person_anna", "name": "Anna Becker", "age": 50},
                    {"person_id": "person_child_1", "name": "Lena Becker", "role": "student"},
                    {"person_id": "person_child_2", "name": "Jonas Becker", "role": "dependent"},
                ],
            },
            "accounts": [{**asdict(account), "opening_balance": f"{account.opening_balance:.2f}"} for account in self.accounts],
            "import_batch": {"batch_id": "batch_becker_v1", "status": "reconciled"},
            "raw_transactions": raw_transactions,
            "transactions": [tx.normalized() for tx in self.transactions],
            "balance_snapshots": [snapshot.normalized() for snapshot in balances],
            "transfer_matches": [asdict(link) for link in self.transfer_links],
            "reversal_links": [asdict(link) for link in self.reversal_links],
            "hidden_ground_truth": {
                "planted_event_labels": sorted({tx.event_label for tx in self.transactions if tx.event_label}),
                "expected_transfer_count": len(self.transfer_links),
                "expected_reversal_count": len(self.reversal_links),
                "fixture_household_id": "hh_isolation_fixture",
            },
        }
        normalized["fixture_sha256"] = hashlib.sha256(json.dumps(normalized, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        return normalized

    def _balances(self) -> list[BalanceSnapshot]:
        account_by_id = {account.account_id: account for account in self.accounts}
        grouped: dict[tuple[str, str], list[Transaction]] = defaultdict(list)
        for tx in self.transactions:
            grouped[(tx.account_id, tx.booking_date[:7])].append(tx)
        running = {account.account_id: account.opening_balance for account in self.accounts}
        snapshots: list[BalanceSnapshot] = []
        for year, month in month_range(date(2021, 9, 1), self.months):
            period = f"{year:04d}-{month:02d}"
            for account_id in account_by_id:
                opening = running[account_id]
                movement = sum((tx.amount for tx in grouped[(account_id, period)]), Decimal("0.00"))
                closing = q(opening + movement)
                snapshots.append(BalanceSnapshot(HOUSEHOLD_ID, account_id, period, opening, closing))
                running[account_id] = closing
        return snapshots


def generate_fixture(seed: int = 20260830) -> dict[str, object]:
    return BeckerGenerator(seed).generate()
