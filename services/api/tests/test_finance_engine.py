from datetime import date
from decimal import Decimal

from hypothesis import given, strategies as st

from fintwin.finance_engine import child_goal_plan, mortgage_refix, retirement_baseline


def mortgage(rate: str, special: str = "0"):
    return mortgage_refix(principal=Decimal("240000"), annual_nominal_rate=Decimal(rate), months=240, start_date=date(2027, 11, 1), monthly_special_repayment=Decimal(special))


def test_mortgage_golden_examples():
    four = mortgage("0.04")
    zero = mortgage("0")
    assert four["monthly_payment"] == "1454.35"
    assert four["final_balance"] == "0.00"
    assert zero["monthly_payment"] == "1000.00"
    assert zero["total_interest"] == "0.00"


@given(st.decimals(min_value="0", max_value="0.08", places=3), st.decimals(min_value="0.081", max_value="0.16", places=3))
def test_higher_mortgage_rate_never_reduces_payment(low, high):
    assert Decimal(mortgage(str(high))["monthly_payment"]) >= Decimal(mortgage(str(low))["monthly_payment"])


def test_special_repayment_never_delays_payoff_or_increases_interest():
    base, special = mortgage("0.05"), mortgage("0.05", "250")
    assert special["months_to_payoff"] <= base["months_to_payoff"]
    assert Decimal(special["total_interest"]) <= Decimal(base["total_interest"])


def retirement(contribution="650", fee="0.01", years=11):
    return retirement_baseline(current_assets=Decimal("184000"), monthly_contribution=Decimal(contribution), years=years, annual_nominal_return=Decimal("0.045"), annual_fee=Decimal(fee), annual_inflation=Decimal("0.02"), expected_net_pension_income=Decimal("2450"), target_monthly_spending=Decimal("3400"), withdrawal_rate=Decimal("0.035"))


def test_retirement_monotonicity_and_reproducibility():
    baseline = retirement()
    assert Decimal(retirement(contribution="800")["projected_real_assets"]) >= Decimal(baseline["projected_real_assets"])
    assert Decimal(retirement(fee="0.02")["projected_real_assets"]) <= Decimal(baseline["projected_real_assets"])
    assert Decimal(retirement(years=12)["projected_real_assets"]) >= Decimal(baseline["projected_real_assets"])
    assert retirement() == baseline


def test_missing_pension_warns_and_child_goal_is_deterministic():
    result = retirement_baseline(current_assets=Decimal("100000"), monthly_contribution=Decimal("500"), years=10, annual_nominal_return=Decimal("0.04"), annual_fee=Decimal("0.01"), annual_inflation=Decimal("0.02"), expected_net_pension_income=None, target_monthly_spending=Decimal("3000"), withdrawal_rate=Decimal("0.04"))
    assert any("missing" in warning for warning in result["warnings"])
    goal = child_goal_plan(target_amount=Decimal("30000"), current_savings=Decimal("5000"), years=8, annual_return=Decimal("0.03"))
    assert Decimal(goal["monthly_contribution"]) > 0
