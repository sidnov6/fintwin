"""P0/P1 household-scoped ledger foundation."""
from alembic import op
import sqlalchemy as sa

revision = "0001_p0_p1"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("households", sa.Column("id", sa.String(64), primary_key=True), sa.Column("name", sa.String(200), nullable=False), sa.Column("synthetic", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.create_table("accounts", sa.Column("id", sa.String(64), primary_key=True), sa.Column("household_id", sa.String(64), sa.ForeignKey("households.id"), nullable=False, index=True), sa.Column("name", sa.String(120), nullable=False), sa.Column("kind", sa.String(40), nullable=False), sa.Column("currency", sa.String(3), nullable=False))
    op.create_table("import_batches", sa.Column("id", sa.String(64), primary_key=True), sa.Column("household_id", sa.String(64), sa.ForeignKey("households.id"), nullable=False, index=True), sa.Column("source_hash", sa.String(64), nullable=False), sa.Column("status", sa.String(30), nullable=False))
    op.create_table("raw_transactions", sa.Column("id", sa.String(80), primary_key=True), sa.Column("household_id", sa.String(64), nullable=False, index=True), sa.Column("import_batch_id", sa.String(64), sa.ForeignKey("import_batches.id"), nullable=False), sa.Column("source_payload", sa.JSON(), nullable=False), sa.Column("source_hash", sa.String(64), nullable=False, unique=True))
    op.create_table("transactions", sa.Column("id", sa.String(80), primary_key=True), sa.Column("household_id", sa.String(64), nullable=False, index=True), sa.Column("account_id", sa.String(64), sa.ForeignKey("accounts.id"), nullable=False), sa.Column("booking_date", sa.Date(), nullable=False), sa.Column("value_date", sa.Date(), nullable=False), sa.Column("amount", sa.Numeric(18, 2), nullable=False), sa.Column("currency", sa.String(3), nullable=False), sa.Column("description", sa.String(240), nullable=False), sa.Column("category", sa.String(80), nullable=False), sa.Column("source_id", sa.String(80), nullable=False, unique=True), sa.Column("excluded_from_spend", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_table("account_balance_snapshots", sa.Column("id", sa.String(80), primary_key=True), sa.Column("household_id", sa.String(64), nullable=False, index=True), sa.Column("account_id", sa.String(64), sa.ForeignKey("accounts.id"), nullable=False), sa.Column("period", sa.String(7), nullable=False), sa.Column("opening_balance", sa.Numeric(18, 2), nullable=False), sa.Column("closing_balance", sa.Numeric(18, 2), nullable=False), sa.UniqueConstraint("household_id", "account_id", "period"))
    op.create_table("transfer_matches", sa.Column("id", sa.String(80), primary_key=True), sa.Column("household_id", sa.String(64), nullable=False, index=True), sa.Column("out_transaction_id", sa.String(80), sa.ForeignKey("transactions.id"), nullable=False), sa.Column("in_transaction_id", sa.String(80), sa.ForeignKey("transactions.id"), nullable=False), sa.Column("confidence", sa.Numeric(4, 3), nullable=False))
    op.create_table("reversal_links", sa.Column("id", sa.String(80), primary_key=True), sa.Column("household_id", sa.String(64), nullable=False, index=True), sa.Column("original_transaction_id", sa.String(80), sa.ForeignKey("transactions.id"), nullable=False), sa.Column("reversal_transaction_id", sa.String(80), sa.ForeignKey("transactions.id"), nullable=False))


def downgrade() -> None:
    for table in ["reversal_links", "transfer_matches", "account_balance_snapshots", "transactions", "raw_transactions", "import_batches", "accounts", "households"]:
        op.drop_table(table)
