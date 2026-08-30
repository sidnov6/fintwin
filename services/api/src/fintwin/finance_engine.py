from __future__ import annotations

from datetime import date
from decimal import Decimal, ROUND_HALF_UP, getcontext

getcontext().prec = 40
CENT = Decimal("0.01")
ONE = Decimal("1")
TWELVE = Decimal("12")


def q(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def add_months(value: date, months: int) -> date:
    total = value.year * 12 + value.month - 1 + months
    year, month_index = divmod(total, 12)
    month = month_index + 1
    import calendar

    return date(year, month, min(value.day, calendar.monthrange(year, month)[1]))


def mortgage_refix(
    *,
    principal: Decimal,
    annual_nominal_rate: Decimal,
    months: int,
    start_date: date,
    monthly_special_repayment: Decimal = Decimal("0"),
) -> dict[str, object]:
    if principal <= 0 or months <= 0 or annual_nominal_rate < 0 or monthly_special_repayment < 0:
        raise ValueError("Mortgage inputs must be non-negative and principal/months positive")
    monthly_rate = annual_nominal_rate / TWELVE
    raw_payment = principal / Decimal(months) if monthly_rate == 0 else principal * monthly_rate / (ONE - (ONE + monthly_rate) ** Decimal(-months))
    posted_payment = q(raw_payment)
    balance = q(principal)
    total_interest = Decimal("0.00")
    schedule: list[dict[str, str | int]] = []
    for index in range(1, months + 1):
        interest = q(balance * monthly_rate)
        regular_principal = max(posted_payment - interest, Decimal("0.00"))
        principal_paid = balance if index == months else min(balance, regular_principal + monthly_special_repayment)
        actual_payment = q(interest + principal_paid)
        balance = q(balance - principal_paid)
        total_interest += interest
        schedule.append(
            {
                "month": index,
                "date": add_months(start_date, index).isoformat(),
                "payment": f"{actual_payment:.2f}",
                "interest": f"{interest:.2f}",
                "principal": f"{principal_paid:.2f}",
                "closing_balance": f"{balance:.2f}",
            }
        )
        if balance == 0:
            break
    return {
        "monthly_payment": f"{posted_payment:.2f}",
        "total_interest": f"{q(total_interest):.2f}",
        "payoff_date": schedule[-1]["date"],
        "months_to_payoff": len(schedule),
        "final_balance": f"{balance:.2f}",
        "schedule": schedule,
        "assumptions": ["Monthly annuity payment", "Posted values rounded half-up to €0.01", "Taxes, fees and lender conditions excluded"],
        "warnings": ["Planning scenario—not a lender quote."],
        "calculation_trace": "M = P × r ÷ (1 − (1 + r)^−n); monthly interest = opening balance × r",
        "engine_version": "mortgage-1.0.0",
    }


def retirement_baseline(
    *,
    current_assets: Decimal,
    monthly_contribution: Decimal,
    years: int,
    annual_nominal_return: Decimal,
    annual_fee: Decimal,
    annual_inflation: Decimal,
    expected_net_pension_income: Decimal | None,
    target_monthly_spending: Decimal,
    withdrawal_rate: Decimal,
) -> dict[str, object]:
    if years <= 0 or withdrawal_rate <= 0 or current_assets < 0 or monthly_contribution < 0:
        raise ValueError("Retirement inputs are outside the supported range")
    annual_net_return = annual_nominal_return - annual_fee
    if annual_net_return <= Decimal("-1"):
        raise ValueError("Net annual return must be greater than -100%")
    monthly_rate = (((ONE + annual_net_return).ln() / TWELVE).exp()) - ONE
    months = years * 12
    if monthly_rate == 0:
        projected_nominal = current_assets + monthly_contribution * Decimal(months)
    else:
        growth = (ONE + monthly_rate) ** Decimal(months)
        projected_nominal = current_assets * growth + monthly_contribution * ((growth - ONE) / monthly_rate)
    projected_real = projected_nominal / ((ONE + annual_inflation) ** Decimal(years))
    warnings: list[str] = []
    pension = expected_net_pension_income
    if pension is None:
        warnings.append("Expected net pension income is missing; the readiness ratio is incomplete.")
        pension = Decimal("0")
    monthly_gap = max(target_monthly_spending - pension, Decimal("0"))
    required_capital = monthly_gap * TWELVE / withdrawal_rate
    readiness = projected_real / required_capital if required_capital > 0 else Decimal("1")
    return {
        "projected_nominal_assets": f"{q(projected_nominal):.2f}",
        "projected_real_assets": f"{q(projected_real):.2f}",
        "monthly_gap": f"{q(monthly_gap):.2f}",
        "required_capital": f"{q(required_capital):.2f}",
        "readiness_ratio": f"{readiness.quantize(Decimal('0.001'), rounding=ROUND_HALF_UP):.3f}",
        "assumptions": ["Contributions occur at month end", "Return minus fee is compounded monthly", "Values shown in today’s euros"],
        "warnings": warnings + ["Sensitivity analysis—not a forecast or product recommendation."],
        "calculation_trace": "Future value of current assets plus an ordinary annuity, deflated by annual inflation",
        "engine_version": "retirement-1.0.0",
    }


def child_goal_plan(*, target_amount: Decimal, current_savings: Decimal, years: int, annual_return: Decimal) -> dict[str, str | list[str]]:
    if target_amount <= 0 or current_savings < 0 or years <= 0 or annual_return < 0:
        raise ValueError("Goal inputs are outside the supported range")
    monthly_rate = (((ONE + annual_return).ln() / TWELVE).exp()) - ONE
    months = years * 12
    future_current = current_savings * ((ONE + monthly_rate) ** Decimal(months))
    remaining = max(target_amount - future_current, Decimal("0"))
    factor = Decimal(months) if monthly_rate == 0 else (((ONE + monthly_rate) ** Decimal(months) - ONE) / monthly_rate)
    contribution = remaining / factor
    return {
        "monthly_contribution": f"{q(contribution):.2f}",
        "future_value_of_current_savings": f"{q(future_current):.2f}",
        "target_amount": f"{q(target_amount):.2f}",
        "engine_version": "child-goal-0.1.0",
        "warnings": ["Illustrative goal calculation only; return is an assumption, not a forecast."],
    }
