"""P2-P6 Twin, findings, scenarios, copilot and audit records."""
from alembic import op
import sqlalchemy as sa

revision = "0002_p2_p6"
down_revision = "0001_p0_p1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("twin_versions", sa.Column("id", sa.String(80), primary_key=True), sa.Column("household_id", sa.String(64), nullable=False, index=True), sa.Column("version", sa.Integer(), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False), sa.UniqueConstraint("household_id", "version"))
    op.create_table("twin_facts", sa.Column("id", sa.String(80), primary_key=True), sa.Column("household_id", sa.String(64), nullable=False, index=True), sa.Column("path", sa.String(160), nullable=False), sa.Column("typed_value", sa.JSON(), nullable=False), sa.Column("source_type", sa.String(40), nullable=False), sa.Column("source_ids", sa.JSON(), nullable=False), sa.Column("confidence", sa.Numeric(4, 3), nullable=False), sa.Column("verification_status", sa.String(30), nullable=False), sa.Column("twin_version", sa.Integer(), nullable=False))
    op.create_table("fact_proposals", sa.Column("id", sa.String(80), primary_key=True), sa.Column("household_id", sa.String(64), nullable=False, index=True), sa.Column("path", sa.String(160), nullable=False), sa.Column("typed_value", sa.JSON(), nullable=False), sa.Column("status", sa.String(30), nullable=False), sa.Column("expected_twin_version", sa.Integer(), nullable=False))
    op.create_table("needs_findings", sa.Column("id", sa.String(80), primary_key=True), sa.Column("household_id", sa.String(64), nullable=False, index=True), sa.Column("domain", sa.String(80), nullable=False), sa.Column("status", sa.String(30), nullable=False), sa.Column("rule_version", sa.String(40), nullable=False), sa.Column("evidence_ids", sa.JSON(), nullable=False), sa.Column("missing_facts", sa.JSON(), nullable=False))
    op.create_table("scenario_runs", sa.Column("id", sa.String(80), primary_key=True), sa.Column("household_id", sa.String(64), nullable=False, index=True), sa.Column("kind", sa.String(40), nullable=False), sa.Column("inputs", sa.JSON(), nullable=False), sa.Column("outputs", sa.JSON(), nullable=False), sa.Column("engine_version", sa.String(40), nullable=False), sa.Column("twin_version", sa.Integer(), nullable=False), sa.Column("idempotency_key", sa.String(120), nullable=False, unique=True))
    op.create_table("audit_events", sa.Column("id", sa.String(80), primary_key=True), sa.Column("household_id", sa.String(64), nullable=False, index=True), sa.Column("event_type", sa.String(80), nullable=False), sa.Column("normalized_input_hash", sa.String(64), nullable=True), sa.Column("output_hash", sa.String(64), nullable=True), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))


def downgrade() -> None:
    for table in ["audit_events", "scenario_runs", "needs_findings", "fact_proposals", "twin_facts", "twin_versions"]:
        op.drop_table(table)
