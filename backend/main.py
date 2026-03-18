import os
from typing import Any, Dict, List

import anyio
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .black_scholes import black_scholes
from .backtester import backtest_strategy
from .data_fetcher import get_option_expiries, get_options_chain, get_stock_info
from .strategy_engine import analyze_strategy


# Load environment variables (e.g., API keys, config) from .env
load_dotenv()


app = FastAPI(title="Option Flow Backend API")

# Enable CORS for all origins so the frontend can call this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class StrategyLegModel(BaseModel):
    option_type: str
    strike: float
    expiry: str
    position: str
    quantity: int = 1
    premium: float


class StrategyAnalyzeRequest(BaseModel):
    ticker: str
    legs: List[StrategyLegModel]
    current_price: float


class BacktestRequest(BaseModel):
    ticker: str
    strategy_type: str = "bull_call_spread"
    lookback_days: int = 365
    delta_target: float = 0.30
    days_to_expiry: int = 30


class AIInsightRequest(BaseModel):
    ticker: str
    chain_summary: Dict[str, Any] = Field(
        ...,
        description="Dict with IV rank, put/call ratio, ATM IV, HV30, days to earnings, etc.",
    )


@app.get("/api/quote/{ticker}")
async def quote(ticker: str) -> Dict[str, Any]:
    """
    Get current price, company name, and basic stats for a ticker.
    """
    info = get_stock_info(ticker)
    if info is None:
        raise HTTPException(status_code=404, detail="Ticker not found or unavailable.")

    return {
        "symbol": info.get("symbol"),
        "name": info.get("longName") or info.get("shortName"),
        "currency": info.get("currency"),
        "exchange": info.get("exchange"),
        "quoteType": info.get("quoteType"),
        "currentPrice": info.get("currentPrice"),
        "previousClose": info.get("previousClose"),
        "open": info.get("open"),
        "dayHigh": info.get("dayHigh"),
        "dayLow": info.get("dayLow"),
        "marketCap": info.get("marketCap"),
    }


@app.post("/api/strategy/analyze")
async def strategy_analyze(payload: StrategyAnalyzeRequest) -> Dict[str, Any]:
    """
    Analyze a multi-leg options strategy at expiry.
    """
    try:
        result = analyze_strategy(
            ticker=payload.ticker,
            legs_payload=[leg.model_dump() for leg in payload.legs],
            current_price=payload.current_price,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return result


@app.post("/api/backtest")
async def backtest(payload: BacktestRequest) -> Dict[str, Any]:
    """
    Run a strategy backtest.
    Note: This may take ~5-10 seconds depending on network and ticker history.
    """
    config = payload.model_dump()

    try:
        # Run in a worker thread so the async server stays responsive.
        results = await anyio.to_thread.run_sync(backtest_strategy, config)
    except ValueError as exc:
        # Covers insufficient history / no trades / invalid tickers.
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Backtest failed.") from exc

    return {
        "note": "Backtests can take ~5-10 seconds to run. If this feels slow, it's expected.",
        "results": results,
    }


@app.post("/api/ai-insight")
async def ai_insight(payload: AIInsightRequest) -> Dict[str, Any]:
    """
    Generate a concise options market brief using Anthropic (Claude).
    """
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="Missing ANTHROPIC_API_KEY in environment (.env).",
        )

    system_prompt = (
        "You are a professional derivatives analyst at a top-tier hedge fund. "
        "Provide concise, insightful analysis. Use precise financial terminology. "
        "Be direct and actionable. Limit to 3 sentences."
    )

    cs = payload.chain_summary or {}
    user_prompt = "\n".join(
        [
            "Write an options market brief for the ticker below using the provided summary metrics.",
            "Focus on skew/smile, positioning implications, and actionable risk notes.",
            "Ticker: " + payload.ticker.strip().upper(),
            "",
            "Chain summary (may contain nulls):",
            f"- IV rank: {cs.get('iv_rank')}",
            f"- Put/Call ratio: {cs.get('put_call_ratio')}",
            f"- ATM IV: {cs.get('atm_iv')}",
            f"- HV30: {cs.get('hv30')}",
            f"- Days to earnings: {cs.get('days_to_earnings')}",
        ]
    )

    def _call_claude() -> str:
        try:
            from anthropic import Anthropic  # type: ignore
        except Exception as exc:  # pragma: no cover
            raise RuntimeError(
                "Anthropic SDK not installed. Install with: pip install anthropic"
            ) from exc

        client = Anthropic(api_key=api_key)
        resp = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=300,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )

        # Anthropic SDK returns a list of content blocks; text is in the first block.
        content = getattr(resp, "content", None)
        if not content:
            return ""
        first = content[0]
        text = getattr(first, "text", "")
        return str(text).strip()

    try:
        insight_text = await anyio.to_thread.run_sync(_call_claude)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Claude API request failed.") from exc

    return {"ticker": payload.ticker.strip().upper(), "insight": insight_text}


@app.get("/api/expiries/{ticker}")
async def expiries(ticker: str) -> Dict[str, Any]:
    """
    Get available option expiry dates for a ticker.
    """
    dates = get_option_expiries(ticker)
    if dates is None:
        raise HTTPException(status_code=404, detail="Ticker not found or has no options.")

    return {"symbol": ticker.upper(), "expiries": dates}


@app.get("/api/chain/{ticker}/{expiry}")
async def chain(ticker: str, expiry: str) -> Dict[str, Any]:
    """
    Get full options chain (calls and puts) for a ticker and expiry date.
    """
    options_chain = get_options_chain(ticker, expiry)
    if options_chain is None:
        raise HTTPException(
            status_code=404,
            detail="Ticker or expiry not found, or options data unavailable.",
        )

    return {
        "symbol": ticker.upper(),
        "expiry": expiry,
        "calls": options_chain.get("calls", []),
        "puts": options_chain.get("puts", []),
    }


@app.get("/api/greeks")
async def greeks(
    spot: float = Query(..., description="Current underlying price."),
    strike: float = Query(..., description="Option strike price."),
    expiry: float = Query(
        ...,
        description="Time to expiry in years (e.g., 0.5 for half a year).",
    ),
    iv: float = Query(..., description="Implied volatility as a decimal (e.g., 0.2)."),
    type: str = Query(..., alias="type", description="'call' or 'put'."),
) -> Dict[str, Any]:
    """
    Calculate Black-Scholes price and Greeks for a European option.
    """
    option_type = type.lower()
    # Risk-free rate can be configured via environment variable; default to 2% if unset.
    try:
        risk_free_rate = float(os.getenv("RISK_FREE_RATE", "0.02"))
    except ValueError:
        risk_free_rate = 0.02

    try:
        result = black_scholes(
            spot_price=spot,
            strike_price=strike,
            time_to_expiry_in_years=expiry,
            risk_free_rate=risk_free_rate,
            volatility=iv,
            option_type=option_type,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "inputs": {
            "spot": spot,
            "strike": strike,
            "expiry_years": expiry,
            "iv": iv,
            "option_type": option_type,
            "risk_free_rate": risk_free_rate,
        },
        "results": result,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=int(os.getenv("PORT", "8000")),
        reload=True,
    )

