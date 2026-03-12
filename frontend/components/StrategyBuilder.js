import React, { useEffect, useMemo, useState } from "react";
import PnLChart from "./PnLChart";

/**
 * StrategyBuilder
 *
 * Props:
 * - ticker: string
 * - chainData: {
 *     calls: Array<{ strike, lastPrice, bid, ask, impliedVolatility }>,
 *     puts:  Array<{ strike, lastPrice, bid, ask, impliedVolatility }>
 *   }
 * - currentPrice: number
 * - expiry: string  (current selected expiry date)
 */
const StrategyBuilder = ({ ticker, chainData, currentPrice, expiry }) => {
  const { calls = [], puts = [] } = chainData || {};

  const [activeStrategy, setActiveStrategy] = useState("bull_call_spread");
  const [legs, setLegs] = useState([]);

  const strikeList = useMemo(() => {
    const strikes = new Set();
    calls.forEach((c) => strikes.add(c.strike));
    puts.forEach((p) => strikes.add(p.strike));
    return Array.from(strikes)
      .filter((s) => typeof s === "number" && !Number.isNaN(s))
      .sort((a, b) => a - b);
  }, [calls, puts]);

  const findNearestStrike = (target, direction = "any") => {
    if (!strikeList.length || typeof target !== "number") return null;
    if (direction === "below") {
      const below = strikeList.filter((s) => s <= target);
      return below.length ? below[below.length - 1] : strikeList[0];
    }
    if (direction === "above") {
      const above = strikeList.filter((s) => s >= target);
      return above.length ? above[0] : strikeList[strikeList.length - 1];
    }
    // any
    let best = strikeList[0];
    let diff = Math.abs(best - target);
    for (let i = 1; i < strikeList.length; i += 1) {
      const d = Math.abs(strikeList[i] - target);
      if (d < diff) {
        diff = d;
        best = strikeList[i];
      }
    }
    return best;
  };

  const getPremiumFor = (type, strike) => {
    const src = type === "call" ? calls : puts;
    const row = src.find((o) => o.strike === strike);
    if (!row) return 0;
    const bid = typeof row.bid === "number" ? row.bid : null;
    const ask = typeof row.ask === "number" ? row.ask : null;
    const last = typeof row.lastPrice === "number" ? row.lastPrice : null;
    if (bid != null && ask != null) return (bid + ask) / 2;
    if (last != null) return last;
    if (bid != null) return bid;
    if (ask != null) return ask;
    return 0;
  };

  const createLeg = (overrides = {}) => ({
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    position: "long", // long or short
    type: "call", // call or put
    strike: null,
    premium: 0,
    quantity: 1,
    expiry,
    ...overrides,
  });

  const buildPreset = (key) => {
    if (!currentPrice || !strikeList.length) return [];

    const spot = currentPrice;
    const atm = findNearestStrike(spot, "any");
    const otmUp = findNearestStrike(spot * 1.05, "above");
    const otmDown = findNearestStrike(spot * 0.95, "below");

    switch (key) {
      case "bull_call_spread":
        return [
          createLeg({
            position: "long",
            type: "call",
            strike: atm,
            premium: getPremiumFor("call", atm),
          }),
          createLeg({
            position: "short",
            type: "call",
            strike: otmUp,
            premium: getPremiumFor("call", otmUp),
          }),
        ];
      case "bear_put_spread":
        return [
          createLeg({
            position: "long",
            type: "put",
            strike: atm,
            premium: getPremiumFor("put", atm),
          }),
          createLeg({
            position: "short",
            type: "put",
            strike: otmDown,
            premium: getPremiumFor("put", otmDown),
          }),
        ];
      case "iron_condor":
        return [
          // Short call spread
          createLeg({
            position: "short",
            type: "call",
            strike: otmUp,
            premium: getPremiumFor("call", otmUp),
          }),
          createLeg({
            position: "long",
            type: "call",
            strike: findNearestStrike(spot * 1.1, "above"),
            premium: getPremiumFor("call", findNearestStrike(spot * 1.1, "above")),
          }),
          // Short put spread
          createLeg({
            position: "short",
            type: "put",
            strike: otmDown,
            premium: getPremiumFor("put", otmDown),
          }),
          createLeg({
            position: "long",
            type: "put",
            strike: findNearestStrike(spot * 0.9, "below"),
            premium: getPremiumFor("put", findNearestStrike(spot * 0.9, "below")),
          }),
        ];
      case "long_straddle":
        return [
          createLeg({
            position: "long",
            type: "call",
            strike: atm,
            premium: getPremiumFor("call", atm),
          }),
          createLeg({
            position: "long",
            type: "put",
            strike: atm,
            premium: getPremiumFor("put", atm),
          }),
        ];
      case "covered_call":
        return [
          // Stock proxy: long 100 shares (represented as a deep ITM call with zero premium effect)
          createLeg({
            position: "long",
            type: "call",
            strike: 0,
            premium: 0,
            quantity: 0, // quantity 0 so it doesn't affect payoff; real stock not modeled here
          }),
          createLeg({
            position: "short",
            type: "call",
            strike: otmUp,
            premium: getPremiumFor("call", otmUp),
          }),
        ];
      case "calendar_spread":
        return [
          createLeg({
            position: "long",
            type: "call",
            strike: atm,
            premium: getPremiumFor("call", atm),
          }),
          createLeg({
            position: "short",
            type: "call",
            strike: atm,
            premium: getPremiumFor("call", atm),
          }),
        ];
      default:
        return [];
    }
  };

  useEffect(() => {
    // Rebuild legs when strategy, price, expiry, or strikes change.
    const presetLegs = buildPreset(activeStrategy);
    setLegs(presetLegs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStrategy, currentPrice, expiry, strikeList.length]);

  const updateLeg = (id, changes) => {
    setLegs((prev) =>
      prev.map((leg) => {
        if (leg.id !== id) return leg;
        const next = { ...leg, ...changes };
        if (
          (changes.type || changes.strike) &&
          typeof next.strike === "number" &&
          next.strike > 0
        ) {
          next.premium = getPremiumFor(next.type, next.strike);
        }
        return next;
      })
    );
  };

  const togglePosition = (id) => {
    setLegs((prev) =>
      prev.map((leg) =>
        leg.id === id
          ? { ...leg, position: leg.position === "long" ? "short" : "long" }
          : leg
      )
    );
  };

  const netPremium = useMemo(() => {
    const CONTRACT_SIZE = 100;
    return legs.reduce((acc, leg) => {
      if (
        typeof leg.premium !== "number" ||
        typeof leg.quantity !== "number" ||
        !["long", "short"].includes(leg.position)
      ) {
        return acc;
      }
      const sign = leg.position === "long" ? -1 : 1; // long pays premium, short receives
      return acc + sign * leg.premium * leg.quantity * CONTRACT_SIZE;
    }, 0);
  }, [legs]);

  const netLabel =
    netPremium > 0
      ? `Net Credit: $${netPremium.toFixed(0)}`
      : netPremium < 0
      ? `Net Debit: $${Math.abs(netPremium).toFixed(0)}`
      : "Even Premium";

  const pnlLegs = legs.map((leg) => ({
    type: leg.type,
    strike: leg.strike,
    premium: leg.premium,
    position: leg.position === "long" ? "long" : "short",
    quantity: leg.quantity || 1,
  }));

  const strategies = [
    {
      id: "bull_call_spread",
      name: "Bull Call Spread",
      tone: "bullish",
      description: "Buy call, sell higher call.",
    },
    {
      id: "bear_put_spread",
      name: "Bear Put Spread",
      tone: "bearish",
      description: "Buy put, sell lower put.",
    },
    {
      id: "iron_condor",
      name: "Iron Condor",
      tone: "neutral",
      description: "Short OTM call + put spreads.",
    },
    {
      id: "long_straddle",
      name: "Long Straddle",
      tone: "volatile",
      description: "Long ATM call & put.",
    },
    {
      id: "covered_call",
      name: "Covered Call",
      tone: "income",
      description: "Long stock + short call.",
    },
    {
      id: "calendar_spread",
      name: "Calendar Spread",
      tone: "time decay",
      description: "Short near, long far expiry.",
    },
  ];

  const toneBadgeClass = (tone) => {
    switch (tone) {
      case "bullish":
        return "text-emerald-300 bg-emerald-500/10 border-emerald-500/40";
      case "bearish":
        return "text-rose-300 bg-rose-500/10 border-rose-500/40";
      case "neutral":
        return "text-slate-300 bg-slate-500/10 border-slate-500/40";
      case "volatile":
        return "text-cyan-300 bg-cyan-500/10 border-cyan-500/40";
      case "income":
        return "text-amber-300 bg-amber-500/10 border-amber-500/40";
      case "time decay":
        return "text-indigo-300 bg-indigo-500/10 border-indigo-500/40";
      default:
        return "text-slate-300 bg-slate-700/40 border-slate-500/40";
    }
  };

  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)]">
      {/* Strategy presets */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
              Strategy Builder
            </h3>
            <p className="text-[11px] text-slate-500">
              Choose a preset to auto-populate option legs.
            </p>
          </div>
          {ticker && (
            <span className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs font-mono text-emerald-300">
              {ticker.toUpperCase()}
            </span>
          )}
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {strategies.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActiveStrategy(s.id)}
              className={[
                "flex flex-col items-start rounded-lg border px-3 py-2 text-left transition shadow-sm shadow-black/40",
                activeStrategy === s.id
                  ? "border-emerald-500/70 bg-slate-900"
                  : "border-slate-800 bg-slate-900/60 hover:border-slate-600",
              ].join(" ")}
            >
              <div className="flex w-full items-center justify-between">
                <span className="text-xs font-semibold text-slate-100">
                  {s.name}
                </span>
                <span
                  className={[
                    "rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                    toneBadgeClass(s.tone),
                  ].join(" ")}
                >
                  {s.tone}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-slate-400">{s.description}</p>
            </button>
          ))}
        </div>

        <div className="rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-[11px] text-slate-400">
          <div>Net premium: {netLabel}</div>
          <div className="mt-1">
            Expiry:{" "}
            <span className="font-mono text-slate-200">
              {expiry || "Select expiry in main panel"}
            </span>
          </div>
        </div>
      </div>

      {/* Legs table + P&L */}
      <div className="space-y-4">
        <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3 shadow-lg shadow-black/40">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Active Legs
            </div>
            <div className="text-[11px] text-slate-500">
              Adjust legs to fine-tune your payoff.
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-[11px] font-mono text-slate-100">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/80 text-[10px] uppercase tracking-wide text-slate-400">
                  <th className="px-2 py-1 text-left">Side</th>
                  <th className="px-2 py-1 text-left">Type</th>
                  <th className="px-2 py-1 text-left">Strike</th>
                  <th className="px-2 py-1 text-left">Expiry</th>
                  <th className="px-2 py-1 text-right">Premium</th>
                  <th className="px-2 py-1 text-right">Qty</th>
                </tr>
              </thead>
              <tbody>
                {legs.map((leg) => (
                  <tr
                    key={leg.id}
                    className="border-t border-slate-900/60 hover:bg-slate-900/70"
                  >
                    <td className="px-2 py-1">
                      <button
                        type="button"
                        onClick={() => togglePosition(leg.id)}
                        className={[
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                          leg.position === "long"
                            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                            : "bg-rose-500/20 text-rose-300 border border-rose-500/40",
                        ].join(" ")}
                      >
                        {leg.position === "long" ? "Buy" : "Sell"}
                      </button>
                    </td>
                    <td className="px-2 py-1">
                      <select
                        value={leg.type}
                        onChange={(e) =>
                          updateLeg(leg.id, { type: e.target.value })
                        }
                        className="rounded-md border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[11px] outline-none focus:border-emerald-500"
                      >
                        <option value="call">Call</option>
                        <option value="put">Put</option>
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <select
                        value={leg.strike ?? ""}
                        onChange={(e) =>
                          updateLeg(leg.id, {
                            strike: Number(e.target.value),
                          })
                        }
                        className="rounded-md border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[11px] outline-none focus:border-emerald-500"
                      >
                        <option value="">—</option>
                        {strikeList.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1 text-slate-300">
                      {leg.expiry || expiry || "—"}
                    </td>
                    <td className="px-2 py-1 text-right text-slate-200">
                      {typeof leg.premium === "number"
                        ? leg.premium.toFixed(2)
                        : "—"}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={leg.quantity}
                        onChange={(e) =>
                          updateLeg(leg.id, {
                            quantity: Number(e.target.value) || 1,
                          })
                        }
                        className="w-14 rounded-md border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-right text-[11px] outline-none focus:border-emerald-500"
                      />
                    </td>
                  </tr>
                ))}
                {!legs.length && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-4 text-center text-slate-500"
                    >
                      No legs defined. Select a strategy on the left.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <PnLChart
          legs={pnlLegs}
          currentPrice={currentPrice}
          expiryDate={expiry}
        />
      </div>
    </div>
  );
};

export default StrategyBuilder;

