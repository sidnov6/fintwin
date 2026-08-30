from __future__ import annotations


class HouseholdNotFound(LookupError):
    pass


class InMemoryLedgerRepository:
    """Reference repository: every public read requires an explicit household scope."""

    def __init__(self, fixtures: list[dict[str, object]]) -> None:
        self._fixtures = {fixture["household"]["household_id"]: fixture for fixture in fixtures}  # type: ignore[index]

    def get_household(self, household_id: str) -> dict[str, object]:
        fixture = self._fixtures.get(household_id)
        if fixture is None:
            raise HouseholdNotFound(household_id)
        return fixture["household"]  # type: ignore[return-value]

    def list_transactions(self, household_id: str) -> list[dict[str, object]]:
        fixture = self._fixtures.get(household_id)
        if fixture is None:
            raise HouseholdNotFound(household_id)
        return [tx for tx in fixture["transactions"] if tx["household_id"] == household_id]  # type: ignore[index]

    def get_transaction(self, household_id: str, transaction_id: str) -> dict[str, object]:
        return next((tx for tx in self.list_transactions(household_id) if tx["transaction_id"] == transaction_id), None) or (_ for _ in ()).throw(HouseholdNotFound(transaction_id))
