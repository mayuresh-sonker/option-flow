from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Tuple


CONTRACT_SIZE = 100.0


@dataclass
class StrategyLeg:
    option_type: str  # "call" or "put"
    strike: float
    expiry: str
    position: str  # "long" or "short"
    quantity: int
    premium: float  # price per share

    @classmethod
    def from_payload(cls, data: Dict[str, Any]) -> "StrategyLeg":
        return cls(
            option_type=str(data["option_type"]).lower(),
            strike=float(data["strike"]),
            expiry=str(data.get("expiry", "")),
            position=str(data["position"]).lower(),
            quantity=int(data.get("quantity", 1)),
            premium=float(data.get("premium", 0.0)),
        )

    def payoff_at_expiry(self, underlying_price: float) -> float:
        """
        Option payoff at expiry, including premium, for this leg.

        Returns total P&L in currency (per position, not per share).
        """
        qty = float(self.quantity)
        is_long = self.position == "long"

        if self.option_type == "call":
            intrinsic = max(underlying_price - self.strike, 0.0)
        elif self.option_type == "put":
            intrinsic = max(self.strike - underlying_price, 0.0)
        else:
            intrinsic = 0.0

        if is_long:
            payoff_per_share = intrinsic - self.premium
        else:
            payoff_per_share = self.premium - intrinsic

        return payoff_per_share * CONTRACT_SIZE * qty


def _build_price_grid(current_price: float, steps: int = 200) -> List[float]:
    """
    Build a simple underlying price grid from 20% below spot to 20% above.
    """
    if current_price <= 0:
        raise ValueError("current_price must be positive.")

    lower = max(current_price * 0.2, 0.01)
    upper = current_price * 1.8
    step = (upper - lower) / steps
    return [lower + i * step for i in range(steps + 1)]


def _portfolio_pnl_over_grid(
    legs: List[StrategyLeg], prices: List[float]
) -> List[Tuple[float, float]]:
    points: List[Tuple[float, float]] = []
    for s in prices:
        total = 0.0
        for leg in legs:
            total += leg.payoff_at_expiry(s)
        points.append((s, total))
    return points


def _find_break_evens(points: List[Tuple[float, float]]) -> List[float]:
    """
    Approximate break-even prices by locating sign changes between grid points
    and linearly interpolating.
    """
    break_evens: List[float] = []
    for (s0, p0), (s1, p1) in zip(points[:-1], points[1:]):
        if p0 == 0.0:
            break_evens.append(s0)
            continue
        if p0 < 0.0 < p1 or p1 < 0.0 < p0:
            # Linear interpolation for root between (s0, p0) and (s1, p1)
            if s1 != s0:
                slope = (p1 - p0) / (s1 - s0)
                if slope != 0:
                    be = s0 - p0 / slope
                    break_evens.append(be)
    # Deduplicate approximately
    uniq: List[float] = []
    for be in sorted(break_evens):
        if not uniq or abs(be - uniq[-1]) > 1e-6:
            uniq.append(be)
    return uniq


def _detect_strategy_name(legs: List[StrategyLeg]) -> str:
    """
    Heuristic pattern matching based on leg types, strikes, and positions.
    """
    calls = [l for l in legs if l.option_type == "call"]
    puts = [l for l in legs if l.option_type == "put"]

    # Sort for consistency
    calls_sorted = sorted(calls, key=lambda l: l.strike)
    puts_sorted = sorted(puts, key=lambda l: l.strike)

    # Long straddle: long call + long put, same strike & expiry
    if (
        len(legs) == 2
        and len(calls_sorted) == 1
        and len(puts_sorted) == 1
        and calls_sorted[0].position == "long"
        and puts_sorted[0].position == "long"
        and abs(calls_sorted[0].strike - puts_sorted[0].strike) < 1e-6
    ):
        return "Long Straddle"

    # Bull call spread: long lower call, short higher call, same expiry
    if (
        len(legs) == 2
        and len(calls_sorted) == 2
        and not puts_sorted
        and calls_sorted[0].position == "long"
        and calls_sorted[1].position == "short"
        and calls_sorted[0].strike < calls_sorted[1].strike
        and calls_sorted[0].expiry == calls_sorted[1].expiry
    ):
        return "Bull Call Spread"

    # Bear put spread: long higher put, short lower put, same expiry
    if (
        len(legs) == 2
        and len(puts_sorted) == 2
        and not calls_sorted
        and puts_sorted[0].position == "short"
        and puts_sorted[1].position == "long"
        and puts_sorted[1].strike > puts_sorted[0].strike
        and puts_sorted[0].expiry == puts_sorted[1].expiry
    ):
        return "Bear Put Spread"

    # Iron condor: two calls + two puts, short inner, long wings
    if len(legs) == 4 and len(calls_sorted) == 2 and len(puts_sorted) == 2:
        call_pos = {l.position for l in calls_sorted}
        put_pos = {l.position for l in puts_sorted}
        if call_pos == {"long", "short"} and put_pos == {"long", "short"}:
            return "Iron Condor"

    # Covered call: one short call (stock not explicitly modeled here)
    if len(calls_sorted) == 1 and calls_sorted[0].position == "short":
        return "Covered Call (approx.)"

    # Calendar spread: same strike, different expiries, long further expiry
    if (
        len(calls_sorted) == 2
        and calls_sorted[0].strike == calls_sorted[1].strike
        and calls_sorted[0].expiry != calls_sorted[1].expiry
    ):
        if {c.position for c in calls_sorted} == {"long", "short"}:
            return "Calendar Spread (calls)"

    return "Custom Strategy"


def analyze_strategy(
    ticker: str, legs_payload: List[Dict[str, Any]], current_price: float
) -> Dict[str, Any]:
    """
    Core analytics for a multi-leg strategy at expiry.
    """
    if not legs_payload:
        raise ValueError("legs must not be empty.")

    legs = [StrategyLeg.from_payload(l) for l in legs_payload]
    prices = _build_price_grid(current_price)
    points = _portfolio_pnl_over_grid(legs, prices)

    pnls = [p for _, p in points]
    max_profit = max(pnls)
    max_loss = min(pnls)

    break_evens = _find_break_evens(points)

    # Probability of profit: approximate as fraction of grid outcomes with P&L > 0.
    # This treats the price grid as a proxy for the distribution of outcomes.
    positive = sum(1 for _, p in points if p > 0)
    probability_of_profit = positive / float(len(points)) if points else 0.0

    # Net premium (debit/credit) at entry
    net_premium = 0.0
    for leg in legs:
        sign = -1.0 if leg.position == "long" else 1.0
        net_premium += sign * leg.premium * CONTRACT_SIZE * float(leg.quantity)

    strategy_name = _detect_strategy_name(legs)

    return {
        "ticker": ticker.upper(),
        "max_profit": max_profit,
        "max_loss": max_loss,
        "break_even_points": break_evens,
        "probability_of_profit": probability_of_profit,
        "net_debit_or_credit": net_premium,
        "strategy_name": strategy_name,
    }

