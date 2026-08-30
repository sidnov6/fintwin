from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import create_engine, delete
from sqlalchemy.orm import Session

from .db import Account, BalanceSnapshot, Household, ImportBatch, RawTransaction, ReversalLink, Transaction, TransferMatch
from .normalization import normalize_raw_transactions


def load_fixture(database_url: str, fixture: dict[str, object]) -> None:
    engine = create_engine(database_url)
    household_id = fixture["household"]["household_id"]  # type: ignore[index]
    with Session(engine) as session, session.begin():
        for model in (ReversalLink, TransferMatch, BalanceSnapshot, Transaction, RawTransaction, ImportBatch, Account):
            session.execute(delete(model).where(model.household_id == household_id))
        session.execute(delete(Household).where(Household.id == household_id))
        session.add(Household(id=household_id, name=fixture["household"]["name"], synthetic=True))  # type: ignore[index]
        session.flush()
        for account in fixture["accounts"]:  # type: ignore[index]
            session.add(Account(id=account["account_id"], household_id=household_id, name=account["name"], kind=account["kind"], currency=account["currency"]))
        session.flush()
        session.add(ImportBatch(id=fixture["import_batch"]["batch_id"], household_id=household_id, source_hash=fixture["fixture_sha256"], status="reconciled"))  # type: ignore[index]
        session.flush()
        raw_records = normalize_raw_transactions(fixture["raw_transactions"])  # type: ignore[arg-type]
        for index, raw in enumerate(raw_records, 1):
            payload = {key: value for key, value in raw.items() if key != "source_hash"}
            session.add(RawTransaction(id=f"raw_{index:06d}", household_id=household_id, import_batch_id=fixture["import_batch"]["batch_id"], source_payload=payload, source_hash=raw["source_hash"]))  # type: ignore[index]
        for tx in fixture["transactions"]:  # type: ignore[index]
            session.add(Transaction(id=tx["transaction_id"], household_id=household_id, account_id=tx["account_id"], booking_date=date.fromisoformat(tx["booking_date"]), value_date=date.fromisoformat(tx["value_date"]), amount=Decimal(tx["amount"]), currency=tx["currency"], description=tx["description"], category=tx["category"], source_id=tx["source_id"], excluded_from_spend=tx["excluded_from_spend"]))
        session.flush()
        for index, snapshot in enumerate(fixture["balance_snapshots"], 1):  # type: ignore[index]
            session.add(BalanceSnapshot(id=f"bal_{index:05d}", household_id=household_id, account_id=snapshot["account_id"], period=snapshot["period"], opening_balance=Decimal(snapshot["opening_balance"]), closing_balance=Decimal(snapshot["closing_balance"])))
        for link in fixture["transfer_matches"]:  # type: ignore[index]
            session.add(TransferMatch(id=link["link_id"], household_id=household_id, out_transaction_id=link["first_transaction_id"], in_transaction_id=link["second_transaction_id"], confidence=Decimal("1.000")))
        for link in fixture["reversal_links"]:  # type: ignore[index]
            session.add(ReversalLink(id=link["link_id"], household_id=household_id, original_transaction_id=link["first_transaction_id"], reversal_transaction_id=link["second_transaction_id"]))
