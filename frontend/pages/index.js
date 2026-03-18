import { useEffect, useState } from "react";
import axios from "axios";
import OptionsChain from "../components/OptionsChain";
import IVSmile from "../components/IVSmile";
import GreeksDashboard from "../components/GreeksDashboard";
import StrategyBuilder from "../components/StrategyBuilder";
import Backtester from "../components/Backtester";
import AIInsight from "../components/AIInsight";
import { getBackendBaseUrl } from "../lib/backend";

export default function Home() {
  const [tickerInput, setTickerInput] = useState("");
  const [activeTicker, setActiveTicker] = useState("");
  const [expiries, setExpiries] = useState([]);
  const [selectedExpiry, setSelectedExpiry] = useState("");
  const [chainData, setChainData] = useState({ calls: [], puts: [] });
  const [currentPrice, setCurrentPrice] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const backendBaseUrl = getBackendBaseUrl();

  const expiryYears = (() => {
    if (!selectedExpiry) return null;
    const exp = new Date(`${selectedExpiry}T16:00:00Z`);
    const now = new Date();
    const ms = exp.getTime() - now.getTime();
    const years = ms / (365 * 24 * 60 * 60 * 1000);
    return Number.isFinite(years) && years > 0 ? years : null;
  })();

  const chainSummary = (() => {
    const calls = chainData?.calls ?? [];
    const puts = chainData?.puts ?? [];
    if (!calls.length && !puts.length) return null;

    const callOI = calls.reduce(
      (acc, r) => acc + (typeof r.openInterest === "number" ? r.openInterest : 0),
      0
    );
    const putOI = puts.reduce(
      (acc, r) => acc + (typeof r.openInterest === "number" ? r.openInterest : 0),
      0
    );

    const putCallRatio = callOI > 0 ? putOI / callOI : null;

    // ATM IV approximation: average call/put IV at nearest strike
    let atmIv = null;
    if (typeof currentPrice === "number") {
      const all = [...calls, ...puts].filter(
        (r) => typeof r.strike === "number" && typeof r.impliedVolatility === "number"
      );
      if (all.length) {
        let best = all[0];
        let bestDiff = Math.abs(best.strike - currentPrice);
        for (let i = 1; i < all.length; i += 1) {
          const d = Math.abs(all[i].strike - currentPrice);
          if (d < bestDiff) {
            bestDiff = d;
            best = all[i];
          }
        }
        const sameStrike = all.filter((r) => r.strike === best.strike);
        const avg =
          sameStrike.reduce((acc, r) => acc + r.impliedVolatility, 0) /
          (sameStrike.length || 1);
        atmIv = Number.isFinite(avg) ? avg : null;
      }
    }

    return {
      iv_rank: null,
      put_call_ratio: putCallRatio,
      atm_iv: atmIv,
      hv30: null,
      days_to_earnings: null,
    };
  })();

  const fetchExpiriesAndQuote = async (ticker) => {
    try {
      // Reset state for a fresh lookup
      setError("");
      setExpiries([]);
      setSelectedExpiry("");
      setChainData({ calls: [], puts: [] });

      const [expiriesRes, quoteRes] = await Promise.all([
        axios.get(`${backendBaseUrl}/api/expiries/${ticker}`),
        axios.get(`${backendBaseUrl}/api/quote/${ticker}`),
      ]);

      const expiryList = expiriesRes.data?.expiries ?? [];
      const firstExpiry = expiryList[0] || "";

      setExpiries(expiryList);
      setSelectedExpiry(firstExpiry);

      const price = quoteRes.data?.currentPrice ?? null;
      setCurrentPrice(price);

      // Only mark the ticker as active once we have data
      setActiveTicker(ticker);

      // Immediately load the initial chain so the user sees results
      if (firstExpiry) {
        await fetchChain(ticker, firstExpiry);
      } else {
        setChainData({ calls: [], puts: [] });
      }
    } catch (err) {
      console.error(err);
      setError("Unable to fetch expiries/quote. Please check the ticker.");
      setExpiries([]);
      setSelectedExpiry("");
      setCurrentPrice(null);
      setChainData({ calls: [], puts: [] });
    }
  };

  const fetchChain = async (ticker, expiry) => {
    if (!ticker || !expiry) return;

    try {
      setError("");
      const res = await axios.get(
        `${backendBaseUrl}/api/chain/${ticker}/${expiry}`
      );
      setChainData({
        calls: res.data?.calls ?? [],
        puts: res.data?.puts ?? [],
      });
    } catch (err) {
      console.error(err);
      setError("Unable to fetch options chain for this ticker / expiry.");
      setChainData({ calls: [], puts: [] });
    }
  };

  // When the expiry changes for the current active ticker, refetch the chain
  useEffect(() => {
    if (activeTicker && selectedExpiry) {
      fetchChain(activeTicker, selectedExpiry);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedExpiry]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const t = tickerInput.trim().toUpperCase();
    if (!t) return;
    try {
      setLoading(true);
      await fetchExpiriesAndQuote(t);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Top nav */}
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-500/20 border border-emerald-500/40">
              <span className="text-sm font-bold text-emerald-400">OF</span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold tracking-[0.2em] text-slate-100 uppercase">
                OptionFlow
              </span>
              <span className="text-xs text-slate-400">
                Real-time options visibility
              </span>
            </div>
          </div>
          <div className="hidden text-xs font-mono text-slate-500 sm:block">
            Backend:{" "}
            <span className="text-emerald-400">{backendBaseUrl}</span>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:py-8">
        {/* Search + expiry controls */}
        <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 shadow-lg shadow-black/40">
          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <div className="flex-1">
              <label
                htmlFor="ticker"
                className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400"
              >
                Ticker
              </label>
              <input
                id="ticker"
                type="text"
                placeholder="AAPL"
                value={tickerInput}
                onChange={(e) => setTickerInput(e.target.value)}
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-mono text-slate-100 outline-none ring-0 transition focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 placeholder:text-slate-500"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Type a symbol and press Enter to load expiries and chain.
              </p>
            </div>

            <div className="w-full sm:w-56">
              <label
                htmlFor="expiry"
                className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400"
              >
                Expiry
              </label>
              <select
                id="expiry"
                value={selectedExpiry}
                onChange={(e) => setSelectedExpiry(e.target.value)}
                disabled={!expiries.length}
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none ring-0 transition disabled:cursor-not-allowed disabled:opacity-50 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              >
                {!expiries.length && <option>No expiries</option>}
                {expiries.map((exp) => (
                  <option key={exp} value={exp}>
                    {exp}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-slate-500">
                Expiry dates from OptionFlow backend.
              </p>
            </div>

            <button
              type="submit"
              className="mt-1 inline-flex items-center justify-center rounded-md border border-emerald-500/60 bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-300 shadow-lg shadow-emerald-900/40 transition hover:bg-emerald-500/30 sm:mt-0"
            >
              Load Chain
            </button>
          </form>

          {/* Status area */}
          <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
            <div>
              {activeTicker ? (
                <span>
                  Active ticker:{" "}
                  <span className="font-mono text-emerald-400">
                    {activeTicker}
                  </span>
                </span>
              ) : (
                <span>Enter a ticker to begin.</span>
              )}
            </div>
            {loading && (
              <div className="flex items-center gap-2">
                <span className="inline-flex h-3 w-3 animate-spin rounded-full border-[2px] border-emerald-400 border-t-transparent" />
                <span>Fetching data…</span>
              </div>
            )}
          </div>

          {error && (
            <div className="mt-3 rounded-md border border-rose-500/60 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
              {error}
            </div>
          )}
        </section>

        {/* Options chain */}
        <section>
          <OptionsChain
            ticker={activeTicker}
            chainData={chainData}
            currentPrice={currentPrice}
          />
        </section>

        {/* Strategy builder + P&L */}
        <section>
          <StrategyBuilder
            ticker={activeTicker}
            chainData={chainData}
            currentPrice={currentPrice}
            expiry={selectedExpiry}
          />
        </section>

        {/* IV Smile */}
        <section>
          <IVSmile chainData={chainData} currentPrice={currentPrice} />
        </section>

        {/* Greeks dashboard */}
        <section>
          <GreeksDashboard
            ticker={activeTicker}
            expiryYears={expiryYears}
            currentPrice={currentPrice}
            optionType="call"
            chainData={chainData}
          />
        </section>

        {/* Backtester */}
        <section>
          <Backtester />
        </section>

        {/* AI Insight */}
        <section>
          <AIInsight ticker={activeTicker} chainSummary={chainSummary} />
        </section>
      </main>
    </div>
  );
}
