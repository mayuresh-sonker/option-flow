from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Dict, List, Literal, Optional

import numpy as np
import pandas as pd
import yfinance as yf

from .black_scholes import black_scholes


StrategyType = Literal[
    "bull_call_spread",
]


TRADING_DAYS_PER_YEAR = 252


@dataclass
class StrategyConfig:
    ticker: str
    strategy_type: StrategyType = "bull_call_spread"
    lookback_days: int = 365
    delta_target: float = 0.30
    days_to_expiry: int = 30

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "StrategyConfig":
        return cls(
            ticker=str(data["ticker"]),
            strategy_type=str(data.get("strategy_type", "bull_call_spread")),
            lookback_days=int(data.get("lookback_days", 365)),
            delta_target=float(data.get("delta_target", 0.30)),
            days_to_expiry=int(data.get("days_to_expiry", 30)),
        )


def _estimate_realized_vol(
    prices: pd.Series, window: int = 30
) -> Optional[float]:
    """
    Estimate annualized realized volatility from historical close prices.
    """
    if len(prices) < window + 1:
        return None
    log_returns = np.log(prices / prices.shift(1)).dropna()
    recent = log_returns.iloc[-window:]
    if recent.std(ddof=0) == 0:
        return None
    daily_vol = recent.std(ddof=0)
    return float(daily_vol * math.sqrt(TRADING_DAYS_PER_YEAR))


def _solve_strike_for_delta(
    spot: float,
    target_delta: float,
    time_to_expiry: float,
    vol: float,
    option_type: str,
    risk_free_rate: float = 0.0,
    max_iter: int = 40,
    tol: float = 1e-3,
) -> Optional[float]:
    """
    Numeric solve for strike such that Black-Scholes Delta ~= target_delta.
    Simple bisection on strike.
    """
    if spot <= 0 or vol <= 0 or time_to_expiry <= 0:
        return None

    low_k = spot * 0.5
    high_k = spot * 1.5

    def delta_for_k(k: float) -> float:
        res = black_scholes(
            spot_price=spot,
            strike_price=k,
            time_to_expiry_in_years=time_to_expiry,
            risk_free_rate=risk_free_rate,
            volatility=vol,
            option_type=option_type,
        )
        return float(res["delta"])

    low_delta = delta_for_k(low_k)
    high_delta = delta_for_k(high_k)

    # Ensure target is bracketed; otherwise fall back to ATM strike.
    if not (min(low_delta, high_delta) <= target_delta <= max(low_delta, high_delta)):
        return spot

    for _ in range(max_iter):
        mid_k = 0.5 * (low_k + high_k)
        mid_delta = delta_for_k(mid_k)
        if abs(mid_delta - target_delta) < tol:
            return mid_k
        if (mid_delta - target_delta) * (low_delta - target_delta) < 0:
            high_k, high_delta = mid_k, mid_delta
        else:
            low_k, low_delta = mid_k, mid_delta
    return 0.5 * (low_k + high_k)


def _price_bull_call_spread(
    spot: float,
    vol: float,
    time_to_expiry: float,
    delta_target: float,
    risk_free_rate: float = 0.0,
) -> Dict[str, Any]:
    """
    Build a simple bull call spread:
    - Long call with target delta
    - Short call 10% OTM (or with ~half the delta)
    """
    long_strike = _solve_strike_for_delta(
        spot=spot,
        target_delta=delta_target,
        time_to_expiry=time_to_expiry,
        vol=vol,
        option_type="call",
        risk_free_rate=risk_free_rate,
    )
    if long_strike is None:
        return {}

    short_strike = float(long_strike * 1.10)

    long_leg = black_scholes(
        spot_price=spot,
        strike_price=long_strike,
        time_to_expiry_in_years=time_to_expiry,
        risk_free_rate=risk_free_rate,
        volatility=vol,
        option_type="call",
    )
    short_leg = black_scholes(
        spot_price=spot,
        strike_price=short_strike,
        time_to_expiry_in_years=time_to_expiry,
        risk_free_rate=risk_free_rate,
        volatility=vol,
        option_type="call",
    )

    return {
        "legs": [
            {
                "option_type": "call",
                "strike": long_strike,
                "position": "long",
                "quantity": 1,
                "premium": long_leg["price"],
            },
            {
                "option_type": "call",
                "strike": short_strike,
                "position": "short",
                "quantity": 1,
                "premium": short_leg["price"],
            },
        ]
    }


def _trade_payoff_at_expiry(legs: List[Dict[str, Any]], expiry_spot: float) -> float:
    """
    Compute total P&L for a set of legs at expiry, given final underlying price.
    """
    CONTRACT_SIZE = 100.0
    total = 0.0
    for leg in legs:
        typ = leg["option_type"]
        strike = float(leg["strike"])
        premium = float(leg["premium"])
        qty = float(leg.get("quantity", 1))
        pos = str(leg["position"]).lower()
        is_long = pos == "long"

        if typ == "call":
            intrinsic = max(expiry_spot - strike, 0.0)
        elif typ == "put":
            intrinsic = max(strike - expiry_spot, 0.0)
        else:
            intrinsic = 0.0

        if is_long:
            payoff_per_share = intrinsic - premium
        else:
            payoff_per_share = premium - intrinsic

        total += payoff_per_share * CONTRACT_SIZE * qty
    return total


def _compute_drawdown(equity: List[float]) -> float:
    if not equity:
        return 0.0
    peak = equity[0]
    max_dd = 0.0
    for value in equity:
        peak = max(peak, value)
        dd = (value - peak) / peak
        if dd < max_dd:
            max_dd = dd
    return float(max_dd)


def backtest_strategy(config_dict: Dict[str, Any]) -> Dict[str, Any]:
    """
    Run a simple historical backtest for a multi-leg options strategy.

    Currently supports:
    - bull_call_spread
    """
    cfg = StrategyConfig.from_dict(config_dict)

    ticker = yf.Ticker(cfg.ticker)

    # Fetch up to 2 years of data but constrain to requested lookback.
    end = datetime.utcnow()
    start = end - timedelta(days=max(cfg.lookback_days, 365 * 2))
    hist = ticker.history(start=start, end=end)
    if hist.empty:
        raise ValueError("No historical data available for ticker.")

    hist = hist.dropna(subset=["Close"])

    # Determine entry dates: every 30 calendar days within lookback window.
    lookback_start = end - timedelta(days=cfg.lookback_days)
    hist = hist[hist.index >= lookback_start]
    if hist.empty:
        raise ValueError("Not enough data in lookback window.")

    first_date = hist.index[0]
    entry_dates: List[pd.Timestamp] = []
    d = first_date
    while d <= hist.index[-1]:
        if d in hist.index:
            entry_dates.append(d)
        d = d + timedelta(days=30)

    trades: List[Dict[str, Any]] = []
    equity_curve: List[float] = []
    equity = 1.0

    for entry_date in entry_dates:
        # Price and volatility estimation window uses data up to entry_date (excluded).
        window_mask = hist.index <= entry_date
        window_prices = hist.loc[window_mask, "Close"]
        vol = _estimate_realized_vol(window_prices)
        if vol is None:
            continue

        spot = float(hist.loc[entry_date, "Close"])
        T_years = cfg.days_to_expiry / TRADING_DAYS_PER_YEAR

        if cfg.strategy_type == "bull_call_spread":
            strat = _price_bull_call_spread(
                spot=spot,
                vol=vol,
                time_to_expiry=T_years,
                delta_target=cfg.delta_target,
            )
        else:
            continue

        legs = strat.get("legs", [])
        if not legs:
            continue

        # Cost at entry: net premium (debit positive, credit negative)
        CONTRACT_SIZE = 100.0
        net_premium = 0.0
        for leg in legs:
            pos = str(leg["position"]).lower()
            sign = -1.0 if pos == "long" else 1.0
            net_premium += (
                sign * float(leg["premium"]) * CONTRACT_SIZE * float(leg.get("quantity", 1))
            )

        # Determine expiry date and find closest trading date in history.
        expiry_date = entry_date + timedelta(days=cfg.days_to_expiry)
        expiry_row = hist.index.get_indexer([expiry_date], method="nearest")
        if expiry_row.size == 0 or expiry_row[0] < 0:
            continue
        expiry_idx = expiry_row[0]
        expiry_ts = hist.index[expiry_idx]
        expiry_spot = float(hist.iloc[expiry_idx]["Close"])

        payoff = _trade_payoff_at_expiry(legs, expiry_spot)
        pnl = payoff  # includes initial premium

        capital_at_risk = abs(net_premium) if abs(net_premium) > 0 else CONTRACT_SIZE
        ret_pct = pnl / capital_at_risk

        equity *= 1.0 + ret_pct
        equity_curve.append(equity)

        trades.append(
            {
                "entry_date": entry_date.isoformat(),
                "expiry_date": expiry_ts.isoformat(),
                "entry_spot": spot,
                "expiry_spot": expiry_spot,
                "net_premium": net_premium,
                "pnl": pnl,
                "return_pct": ret_pct,
                "legs": legs,
            }
        )

    if not trades:
        raise ValueError("No trades generated for the given configuration.")

    returns = np.array([t["return_pct"] for t in trades], dtype=float)
    wins = (returns > 0).sum()
    win_rate = float(wins) / float(len(returns))
    avg_return_pct = float(returns.mean() * 100.0)

    total_return = float(equity - 1.0)
    max_drawdown = _compute_drawdown(equity_curve)

    # Approximate Sharpe: per-trade returns, scaled to annualized using trade frequency.
    if returns.std(ddof=0) > 0:
        trades_per_year = TRADING_DAYS_PER_YEAR / float(cfg.days_to_expiry)
        sharpe = float(
            (returns.mean() / returns.std(ddof=0)) * math.sqrt(trades_per_year)
        )
    else:
        sharpe = 0.0

    return {
        "config": {
            "ticker": cfg.ticker.upper(),
            "strategy_type": cfg.strategy_type,
            "lookback_days": cfg.lookback_days,
            "delta_target": cfg.delta_target,
            "days_to_expiry": cfg.days_to_expiry,
        },
        "trades": trades,
        "win_rate": win_rate,
        "avg_return_pct": avg_return_pct,
        "max_drawdown": max_drawdown,
        "sharpe_ratio": sharpe,
        "total_return": total_return,
        "equity_curve": equity_curve,
    }

