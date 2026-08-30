import pytest

from fintwin.generator import generate_fixture
from fintwin.repository import HouseholdNotFound, InMemoryLedgerRepository


def test_cross_household_reads_do_not_leak_counts_or_content():
    repo = InMemoryLedgerRepository([generate_fixture()])
    with pytest.raises(HouseholdNotFound):
        repo.get_household("hh_isolation_fixture")
    with pytest.raises(HouseholdNotFound):
        repo.list_transactions("hh_isolation_fixture")
    with pytest.raises(HouseholdNotFound):
        repo.get_transaction("hh_isolation_fixture", "txn_000001")


def test_scoped_reads_only_return_requested_household():
    repo = InMemoryLedgerRepository([generate_fixture()])
    transactions = repo.list_transactions("hh_becker")
    assert transactions
    assert all(tx["household_id"] == "hh_becker" for tx in transactions)
