from typing import Any, Dict, List, Optional

import yfinance as yf
from dotenv import load_dotenv


load_dotenv()


def _valid_ticker(ticker: yf.Ticker) -> bool:
    """
    Heuristic to determine whether a ticker exists.

    Newer versions of yfinance deprecate/disable ``.info`` for many symbols,
    so we avoid relying on it and instead:
    - Prefer ``fast_info.last_price`` when available
    - Fall back to a tiny price history check
    """
    # Try fast_info first – cheap and generally available
    try:
        fast_info = getattr(ticker, "fast_info", None) or {}
        last_price = getattr(fast_info, "last_price", None) or fast_info.get(
            "last_price"
        )
        if last_price is not None:
            return True
    except Exception:
        # Fall back to history-based check below
        pass

    # As a fallback, attempt to fetch a minimal history window.
    try:
        hist = ticker.history(period="5d")
        if not hist.empty:
            return True
    except Exception:
        pass

    return False


def get_stock_info(ticker_symbol: str) -> Optional[Dict[str, Any]]:
    """
    Fetch current stock price and basic info for a ticker.

    Returns a dictionary with a subset of useful fields, or None if ticker is invalid.
    """
    try:
        ticker = yf.Ticker(ticker_symbol)
        if not _valid_ticker(ticker):
            return None

        # Avoid relying on `.info` (often disabled/broken). Prefer fast_info and history.
        price: Any = None
        previous_close: Any = None
        open_px: Any = None
        day_high: Any = None
        day_low: Any = None
        currency: Any = None
        exchange: Any = None
        quote_type: Any = None

        try:
            fast_info = getattr(ticker, "fast_info", None) or {}
            getter = fast_info.get if isinstance(fast_info, dict) else lambda k: getattr(fast_info, k, None)

            price = getter("last_price")
            previous_close = getter("previous_close")
            open_px = getter("open")
            day_high = getter("day_high")
            day_low = getter("day_low")
            currency = getter("currency")
            exchange = getter("exchange")
            quote_type = getter("quote_type")
        except Exception:
            pass

        if price is None:
            try:
                hist = ticker.history(period="5d")
                if not hist.empty:
                    price = float(hist["Close"].dropna().iloc[-1])
            except Exception:
                price = None

        if price is None:
            return None

        # Name/market cap are best-effort; try `.info` but don't fail if it breaks.
        short_name = None
        long_name = None
        market_cap = None
        try:
            info = ticker.info or {}
            short_name = info.get("shortName")
            long_name = info.get("longName")
            market_cap = info.get("marketCap")
        except Exception:
            pass

        return {
            "symbol": ticker_symbol.upper(),
            "shortName": short_name,
            "longName": long_name,
            "currency": currency,
            "exchange": exchange,
            "quoteType": quote_type,
            "currentPrice": price,
            "previousClose": previous_close,
            "open": open_px,
            "dayHigh": day_high,
            "dayLow": day_low,
            "marketCap": market_cap,
        }
    except Exception:
        return None


def get_option_expiries(ticker_symbol: str) -> Optional[List[str]]:
    """
    Fetch all option expiry dates available for a ticker.

    Returns a list of ISO date strings (YYYY-MM-DD), or None if ticker is invalid.
    """
    try:
        ticker = yf.Ticker(ticker_symbol)
        if not _valid_ticker(ticker):
            return None

        expiries = list(ticker.options or [])
        return expiries
    except Exception:
        return None


_OPTION_COLUMNS = [
    "strike",
    "lastPrice",
    "bid",
    "ask",
    "volume",
    "openInterest",
    "impliedVolatility",
]


def get_options_chain(
    ticker_symbol: str, expiry: str
) -> Optional[Dict[str, List[Dict[str, Any]]]]:
    """
    Fetch full options chain (calls and puts) for a given ticker and expiry date.

    Each leg contains the following columns:
    strike, lastPrice, bid, ask, volume, openInterest, impliedVolatility.

    Returns a dict with keys "calls" and "puts" (each a list of dict rows),
    or None if ticker or expiry is invalid.
    """
    try:
        ticker = yf.Ticker(ticker_symbol)
        if not _valid_ticker(ticker):
            return None

        if not ticker.options or expiry not in ticker.options:
            return None

        chain = ticker.option_chain(expiry)
        calls_df = chain.calls
        puts_df = chain.puts

        calls = [
            {col: row.get(col) for col in _OPTION_COLUMNS}
            for _, row in calls_df[_OPTION_COLUMNS].iterrows()
        ]
        puts = [
            {col: row.get(col) for col in _OPTION_COLUMNS}
            for _, row in puts_df[_OPTION_COLUMNS].iterrows()
        ]

        return {"calls": calls, "puts": puts}
    except Exception:
        return None

