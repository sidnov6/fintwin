from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import Boolean, Date, ForeignKey, JSON, Numeric, String, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Household(Base):
    __tablename__ = "households"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    synthetic: Mapped[bool] = mapped_column(Boolean, default=True)


class Account(Base):
    __tablename__ = "accounts"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    household_id: Mapped[str] = mapped_column(ForeignKey("households.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(40))
    currency: Mapped[str] = mapped_column(String(3), default="EUR")


class Transaction(Base):
    __tablename__ = "transactions"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    household_id: Mapped[str] = mapped_column(String(64), index=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"))
    booking_date: Mapped[date] = mapped_column(Date)
    value_date: Mapped[date] = mapped_column(Date)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    currency: Mapped[str] = mapped_column(String(3))
    description: Mapped[str] = mapped_column(String(240))
    category: Mapped[str] = mapped_column(String(80))
    source_id: Mapped[str] = mapped_column(String(80), unique=True)
    excluded_from_spend: Mapped[bool] = mapped_column(Boolean, default=False)


class ImportBatch(Base):
    __tablename__ = "import_batches"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    household_id: Mapped[str] = mapped_column(ForeignKey("households.id"), index=True)
    source_hash: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(30))


class BalanceSnapshot(Base):
    __tablename__ = "account_balance_snapshots"
    __table_args__ = (UniqueConstraint("household_id", "account_id", "period"),)
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    household_id: Mapped[str] = mapped_column(String(64), index=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"))
    period: Mapped[str] = mapped_column(String(7))
    opening_balance: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    closing_balance: Mapped[Decimal] = mapped_column(Numeric(18, 2))


class RawTransaction(Base):
    __tablename__ = "raw_transactions"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    household_id: Mapped[str] = mapped_column(String(64), index=True)
    import_batch_id: Mapped[str] = mapped_column(ForeignKey("import_batches.id"))
    source_payload: Mapped[dict] = mapped_column(JSON)
    source_hash: Mapped[str] = mapped_column(String(64), unique=True)


class TransferMatch(Base):
    __tablename__ = "transfer_matches"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    household_id: Mapped[str] = mapped_column(String(64), index=True)
    out_transaction_id: Mapped[str] = mapped_column(ForeignKey("transactions.id"))
    in_transaction_id: Mapped[str] = mapped_column(ForeignKey("transactions.id"))
    confidence: Mapped[Decimal] = mapped_column(Numeric(4, 3))


class ReversalLink(Base):
    __tablename__ = "reversal_links"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    household_id: Mapped[str] = mapped_column(String(64), index=True)
    original_transaction_id: Mapped[str] = mapped_column(ForeignKey("transactions.id"))
    reversal_transaction_id: Mapped[str] = mapped_column(ForeignKey("transactions.id"))
