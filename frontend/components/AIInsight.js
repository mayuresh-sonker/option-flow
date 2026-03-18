import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { getBackendBaseUrl } from "../lib/backend";

const POSITIVE_WORDS = new Set([
  "bullish",
  "constructive",
  "supportive",
  "tailwind",
  "upside",
  "bid",
  "buy",
  "outperform",
  "strong",
  "strength",
  "improving",
  "favorable",
  "cheap",
  "attractive",
  "accumulate",
  "overbought", // often used with caution, but still a key term
]);

const NEGATIVE_WORDS = new Set([
  "bearish",
  "fragile",
  "headwind",
  "downside",
  "risk",
  "risks",
  "sell",
  "selloff",
  "weak",
  "weakness",
  "unfavorable",
  "expensive",
  "stretched",
  "drawdown",
  "volatility",
  "hedge",
  "protection",
]);

const ClaudeMark = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="aiGlow" x1="0" y1="0" x2="32" y2="32">
        <stop stopColor="#22d3ee" stopOpacity="0.9" />
        <stop offset="0.5" stopColor="#facc15" stopOpacity="0.9" />
        <stop offset="1" stopColor="#a855f7" stopOpacity="0.9" />
      </linearGradient>
    </defs>
    <circle cx="16" cy="16" r="14" stroke="url(#aiGlow)" strokeWidth="2" />
    <path
      d="M20.9 12.2c-1-1.1-2.5-1.7-4.2-1.7-3 0-5.4 2.3-5.4 5.5 0 3.2 2.4 5.5 5.5 5.5 1.8 0 3.2-.6 4.2-1.7"
      stroke="url(#aiGlow)"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

function normalizeWord(token) {
  return token.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, "");
}

function isNumberish(token) {
  return /^[-+]?(\d+(\.\d+)?)(%|bps)?$/i.test(token);
}

function highlightText(text) {
  if (!text) return null;

  // Split into tokens preserving whitespace and punctuation.
  const tokens = text.split(/(\s+|[(),.;:!?])/g).filter((t) => t !== "");

  return tokens.map((tok, idx) => {
    if (/^\s+$/.test(tok)) return <span key={idx}>{tok}</span>;
    if (/[(),.;:!?]/.test(tok) && tok.length === 1) return <span key={idx}>{tok}</span>;

    if (isNumberish(tok)) {
      return (
        <span
          key={idx}
          className="text-amber-300 font-semibold drop-shadow-[0_0_10px_rgba(251,191,36,0.25)]"
        >
          {tok}
        </span>
      );
    }

    const w = normalizeWord(tok);
    if (w && POSITIVE_WORDS.has(w)) {
      return (
        <span
          key={idx}
          className="text-emerald-300 font-semibold drop-shadow-[0_0_10px_rgba(34,197,94,0.22)]"
        >
          {tok}
        </span>
      );
    }
    if (w && NEGATIVE_WORDS.has(w)) {
      return (
        <span
          key={idx}
          className="text-rose-300 font-semibold drop-shadow-[0_0_10px_rgba(244,63,94,0.18)]"
        >
          {tok}
        </span>
      );
    }

    return <span key={idx}>{tok}</span>;
  });
}

/**
 * AIInsight
 *
 * Props:
 * - ticker: string
 * - chainSummary: {
 *     iv_rank?: number,
 *     put_call_ratio?: number,
 *     atm_iv?: number,
 *     hv30?: number,
 *     days_to_earnings?: number | null
 *   }
 */
const AIInsight = ({ ticker, chainSummary }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [insight, setInsight] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);

  const backendBaseUrl = getBackendBaseUrl();

  const canFetch = useMemo(() => !!ticker && !!chainSummary, [ticker, chainSummary]);

  const fetchInsight = useCallback(async () => {
    if (!ticker) return;
    try {
      setError("");
      setLoading(true);
      const res = await axios.post(`${backendBaseUrl}/api/ai-insight`, {
        ticker,
        chain_summary: chainSummary || {},
      });
      setInsight(res.data?.insight || "");
      setLastUpdatedAt(new Date());
    } catch (err) {
      const detail =
        err?.response?.data?.detail || err?.message || "Unable to fetch AI analysis.";
      setError(String(detail));
      setInsight("");
    } finally {
      setLoading(false);
    }
  }, [ticker, chainSummary]);

  useEffect(() => {
    if (canFetch) fetchInsight();
  }, [canFetch, fetchInsight]);

  const rendered = useMemo(() => highlightText(insight), [insight]);

  return (
    <div className="mt-6 rounded-lg border border-slate-800 bg-slate-900/70 shadow-[0_0_40px_rgba(15,23,42,0.8)] overflow-hidden">
      {/* Glowing top border */}
      <div className="h-[3px] w-full bg-gradient-to-r from-cyan-400/70 via-amber-300/70 to-fuchsia-400/70 shadow-[0_0_20px_rgba(250,204,21,0.18)]" />

      <div className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="absolute -inset-2 rounded-full bg-amber-400/10 blur-md" />
              <ClaudeMark className="relative h-8 w-8" />
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-200">
                AI Analysis
              </div>
              <div className="text-[11px] text-slate-500">
                Claude brief for{" "}
                <span className="font-mono text-emerald-300">
                  {(ticker || "").toUpperCase()}
                </span>
                {lastUpdatedAt ? (
                  <span className="text-slate-600">
                    {" "}
                    · updated {lastUpdatedAt.toLocaleTimeString()}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={fetchInsight}
            disabled={loading || !ticker}
            className="inline-flex items-center gap-2 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-slate-500 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(34,197,94,0.35)]" />
            Refresh
          </button>
        </div>

        {error && (
          <div className="mt-3 rounded-md border border-rose-500/60 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
            {error}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="mt-4 space-y-2 animate-pulse">
            <div className="h-3 w-11/12 rounded bg-slate-800" />
            <div className="h-3 w-10/12 rounded bg-slate-800" />
            <div className="h-3 w-9/12 rounded bg-slate-800" />
          </div>
        )}

        {!loading && !error && (
          <div className="mt-4 rounded-md border border-slate-800 bg-slate-950/60 p-3">
            <div className="text-sm leading-6 text-slate-100">{rendered}</div>
            {!insight && (
              <div className="text-xs text-slate-500">
                No analysis yet. Click Refresh.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default AIInsight;

