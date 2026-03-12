import React, { useMemo } from "react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Label,
} from "recharts";

/**
 * PnLChart
 *
 * Props:
 * - legs: Array<{
 *     type: "call" | "put",
 *     strike: number,
 *     premium: number,        // price paid per contract (per share)
 *     position: "long" | "short",
 *     quantity: number        // number of contracts
 *   }>
 * - currentPrice: number      // current underlying price (S0)
 * - expiryDate: string | Date // informational label only
 *
 * Assumes 1 contract = 100 shares.
 */
const PnLChart = ({ legs = [], currentPrice, expiryDate }) => {
  const CONTRACT_SIZE = 100;

  const priceRange = useMemo(() => {
    if (!currentPrice || !Number.isFinite(currentPrice)) {
      return [];
    }
    const min = currentPrice * 0.8;
    const max = currentPrice * 1.2;
    const steps = 60;
    const step = (max - min) / steps;
    const prices = [];
    for (let i = 0; i <= steps; i += 1) {
      prices.push(min + i * step);
    }
    return prices;
  }, [currentPrice]);

  const computeLegPayoff = (leg, underlyingPrice) => {
    const { type, strike, premium, position, quantity } = leg;
    if (
      typeof strike !== "number" ||
      typeof premium !== "number" ||
      typeof quantity !== "number" ||
      !["call", "put"].includes(type) ||
      !["long", "short"].includes(position)
    ) {
      return 0;
    }

    const sign = position === "long" ? 1 : -1;
    let intrinsic = 0;

    if (type === "call") {
      intrinsic = Math.max(underlyingPrice - strike, 0);
    } else if (type === "put") {
      intrinsic = Math.max(strike - underlyingPrice, 0);
    }

    const payoffPerShare = intrinsic - premium * sign;
    return payoffPerShare * CONTRACT_SIZE * quantity * sign;
  };

  const chartData = useMemo(() => {
    if (!priceRange.length || !legs.length) return [];

    return priceRange.map((price) => {
      const totalPnl = legs.reduce(
        (acc, leg) => acc + computeLegPayoff(leg, price),
        0
      );
      return {
        price,
        pnl: totalPnl,
      };
    });
  }, [priceRange, legs]);

  const { maxProfit, maxLoss, breakEvens } = useMemo(() => {
    if (!chartData.length) {
      return { maxProfit: null, maxLoss: null, breakEvens: [] };
    }

    let maxP = chartData[0].pnl;
    let minP = chartData[0].pnl;

    chartData.forEach((point) => {
      if (point.pnl > maxP) maxP = point.pnl;
      if (point.pnl < minP) minP = point.pnl;
    });

    const bes = [];
    for (let i = 1; i < chartData.length; i += 1) {
      const prev = chartData[i - 1];
      const curr = chartData[i];
      if ((prev.pnl <= 0 && curr.pnl >= 0) || (prev.pnl >= 0 && curr.pnl <= 0)) {
        const slope = (curr.pnl - prev.pnl) / (curr.price - prev.price || 1);
        const bePrice =
          slope === 0 ? prev.price : prev.price - prev.pnl / slope;
        bes.push(bePrice);
      }
    }

    return { maxProfit: maxP, maxLoss: minP, breakEvens: bes };
  }, [chartData]);

  const formatCurrency = (v) => {
    if (v === null || v === undefined || Number.isNaN(v)) return "—";
    return `${v >= 0 ? "+" : ""}$${v.toFixed(0)}`;
  };

  return (
    <div className="mt-6 rounded-lg border border-slate-800 bg-slate-900/70 p-4 shadow-lg shadow-black/40">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            P&amp;L at Expiry
          </div>
          <div className="text-[11px] text-slate-500">
            Combined payoff for all legs at expiry
            {expiryDate ? ` (${expiryDate})` : ""}.
          </div>
        </div>
        <div className="text-right text-[11px] text-slate-400">
          <div>Max profit: {formatCurrency(maxProfit)}</div>
          <div>Max loss: {formatCurrency(maxLoss)}</div>
        </div>
      </div>

      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{ top: 10, right: 20, bottom: 10, left: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis
              dataKey="price"
              tick={{ fill: "#9ca3af", fontSize: 10 }}
              tickFormatter={(v) => `$${v.toFixed(0)}`}
            />
            <YAxis
              tick={{ fill: "#9ca3af", fontSize: 10 }}
              tickFormatter={(v) => `$${v.toFixed(0)}`}
              stroke="#4b5563"
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#020617",
                borderColor: "#1f2937",
                color: "#e5e7eb",
                fontSize: 12,
              }}
              labelStyle={{ color: "#9ca3af" }}
              formatter={(value, name) =>
                name === "pnl" ? [formatCurrency(value), "P&L"] : value
              }
              labelFormatter={(label) => `Price: $${label.toFixed(2)}`}
              cursor={{ stroke: "#4b5563", strokeDasharray: "3 3" }}
            />

            {/* Zero P&L line */}
            <ReferenceLine y={0} stroke="#4b5563" strokeDasharray="4 4">
              <Label
                value="Break-even line"
                position="right"
                offset={10}
                fill="#9ca3af"
                fontSize={10}
              />
            </ReferenceLine>

            {/* Break-even verticals */}
            {breakEvens.map((be) => (
              <ReferenceLine
                key={be}
                x={be}
                stroke="#e5e7eb"
                strokeDasharray="4 4"
                opacity={0.5}
              >
                <Label
                  value={`BE $${be.toFixed(0)}`}
                  position="top"
                  fill="#e5e7eb"
                  fontSize={10}
                />
              </ReferenceLine>
            ))}

            {/* Current price marker */}
            {currentPrice && (
              <ReferenceLine
                x={currentPrice}
                stroke="#22d3ee"
                strokeDasharray="2 2"
              >
                <Label
                  value={`Spot $${currentPrice.toFixed(0)}`}
                  position="top"
                  fill="#22d3ee"
                  fontSize={10}
                />
              </ReferenceLine>
            )}

            {/* Single line; color decided by stroke + strokeDasharray? We keep one color and rely on zero line for sign,
                as Recharts doesn't support per-point stroke color out of the box. */}
            <Line
              type="monotone"
              dataKey="pnl"
              stroke="#22c55e"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0, fill: "#fbbf24" }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default PnLChart;

