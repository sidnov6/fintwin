from fastapi.testclient import TestClient

from fintwin.main import app
from fintwin.twin_service import state


client = TestClient(app)


def test_health_discloses_synthetic_mode():
    body = client.get("/health").json()
    assert body["mode"] == "synthetic-demo"
    assert body["regulated_recommendations"] is False


def test_overview_is_enveloped_and_scoped():
    response = client.get("/v1/demo/households/hh_becker/overview")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["data"]["synthetic"] is True
    assert body["data"]["period_count"] == 420
    assert body["data"]["reconciled_periods"] == 420


def test_unknown_household_is_not_found_without_detail():
    response = client.get("/v1/demo/households/hh_other/overview")
    assert response.status_code == 404
    assert response.json() == {"detail": "Household not found"}


def test_twin_correction_requires_confirmation_and_increments_version():
    state.reset()
    proposal = client.post("/v1/households/hh_becker/facts/proposals", json={"path": "goals.retirement.target_age", "typed_value": 64}, headers={"Idempotency-Key": "proposal-test", "If-Match": "17"})
    assert proposal.status_code == 200
    assert state.version == 17
    proposal_id = proposal.json()["data"]["proposal_id"]
    confirmed = client.post(f"/v1/fact-proposals/{proposal_id}/confirm", headers={"Idempotency-Key": "confirm-test", "If-Match": "17"})
    assert confirmed.status_code == 200
    assert confirmed.json()["twin_version"] == 18
    assert confirmed.json()["data"]["fact"]["verification_status"] == "confirmed"


def test_stale_twin_write_returns_conflict_without_mutation():
    state.reset()
    response = client.post("/v1/households/hh_becker/facts/proposals", json={"path": "goals.retirement.target_age", "typed_value": 65}, headers={"Idempotency-Key": "stale-test", "If-Match": "16"})
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "TWIN_VERSION_CONFLICT"
    assert state.version == 17


def test_scenarios_are_idempotent_and_evidence_backed():
    state.reset()
    payload = {"principal": "240000", "annual_nominal_rate": "0.04", "remaining_months": 240, "monthly_special_repayment": "0", "scenario_start_date": "2027-11-01"}
    first = client.post("/v1/households/hh_becker/scenarios/mortgage", json=payload, headers={"Idempotency-Key": "mortgage-test"})
    second = client.post("/v1/households/hh_becker/scenarios/mortgage", json=payload, headers={"Idempotency-Key": "mortgage-test"})
    assert first.status_code == second.status_code == 200
    assert first.json()["data"]["run_id"] == second.json()["data"]["run_id"]
    assert first.json()["data"]["result"]["monthly_payment"] == "1454.35"
    assert first.json()["source_ids"]


def test_copilot_claims_have_sources_and_blocked_intent_refuses():
    state.reset()
    allowed = client.post("/v1/households/hh_becker/copilot/turns", json={"question": "Where did our money go last month?"}, headers={"Idempotency-Key": "ask-allowed"})
    assert allowed.status_code == 200
    assert all(claim["source_ids"] for claim in allowed.json()["data"]["claims"])
    blocked = client.post("/v1/households/hh_becker/copilot/turns", json={"question": "Recommend the best product to buy"}, headers={"Idempotency-Key": "ask-blocked"})
    assert blocked.status_code == 200
    assert blocked.json()["data"]["policy_result"] == "blocked"
    assert blocked.json()["data"]["claims"] == []
