import json
from decimal import Decimal

from fintwin.generator import generate_fixture
from fintwin.reconciliation import external_spend, reconcile
from fintwin.normalization import normalize_raw_transactions


def test_seeded_fixture_has_target_volume_and_planted_labels():
    fixture = generate_fixture()
    assert 5_000 <= len(fixture["transactions"]) <= 10_000
    labels = fixture["hidden_ground_truth"]["planted_event_labels"]
    assert {"michael_promotion", "annual_bonus", "recurring_cost_drift", "mortgage_refix_14_months", "planted_refund_reversal"}.issubset(labels)


def test_same_seed_is_byte_equivalent():
    left = json.dumps(generate_fixture(1234), sort_keys=True, separators=(",", ":")).encode()
    right = json.dumps(generate_fixture(1234), sort_keys=True, separators=(",", ":")).encode()
    assert left == right


def test_different_seed_changes_fixture_hash():
    assert generate_fixture(1)["fixture_sha256"] != generate_fixture(2)["fixture_sha256"]


def test_raw_import_deduplicates_repeated_source_delivery():
    fixture = generate_fixture()
    assert len(fixture["raw_transactions"]) > len(fixture["transactions"])
    canonical = normalize_raw_transactions(fixture["raw_transactions"])
    assert len(canonical) == len(fixture["transactions"])
    assert all(isinstance(row["amount"], str) and row["amount"].count(".") == 1 for row in canonical)


def test_every_account_period_reconciles_to_one_cent():
    results = reconcile(generate_fixture())
    assert len(results) == 7 * 60
    assert all(abs(Decimal(result["difference"])) <= Decimal("0.01") for result in results)
    assert all(result["status"] == "reconciled" for result in results)


def test_transfers_conserve_money_and_are_excluded_from_spend():
    fixture = generate_fixture()
    tx_by_id = {tx["transaction_id"]: tx for tx in fixture["transactions"]}
    spend_before = external_spend(fixture)
    assert fixture["transfer_matches"]
    for link in fixture["transfer_matches"]:
        first = tx_by_id[link["first_transaction_id"]]
        second = tx_by_id[link["second_transaction_id"]]
        assert Decimal(first["amount"]) + Decimal(second["amount"]) == Decimal("0.00")
        assert first["excluded_from_spend"] and second["excluded_from_spend"]
    fixture_without_transfers = {**fixture, "transactions": [tx for tx in fixture["transactions"] if not tx["excluded_from_spend"]]}
    assert spend_before == external_spend(fixture_without_transfers)


def test_reversals_net_to_zero():
    fixture = generate_fixture()
    tx_by_id = {tx["transaction_id"]: tx for tx in fixture["transactions"]}
    for link in fixture["reversal_links"]:
        assert Decimal(tx_by_id[link["first_transaction_id"]]["amount"]) + Decimal(tx_by_id[link["second_transaction_id"]]["amount"]) == Decimal("0.00")
