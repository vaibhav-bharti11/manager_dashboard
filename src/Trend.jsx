import React from "react";
import {reportSeries} from "./reportSeries.mjs";
export default function Trend({ period, reports }) {
  const points=reportSeries(reports,period);
  const max = Math.max(4, ...points.map((p) => p.count)),
    path = points
      .map(
        (p, i) =>
          `${i === 0 ? "M" : "L"}${(i * 700) / (points.length-1)} ${150 - (p.count / max) * 140}`,
      )
      .join(" ");
  return (
    <div className="trend-chart">
      <div className="chart-scale">
        {[
          max,
          Math.round(max * 0.75),
          Math.round(max * 0.5),
          Math.round(max * 0.25),
          0,
        ].map((x, i) => (
          <span key={i}>{x}</span>
        ))}
      </div>
      <svg
        viewBox="0 0 700 160"
        preserveAspectRatio="none"
        role="img"
        aria-label="Submitted reports by reporting period"
      >
        {[10, 45, 80, 115, 150].map((y) => (
          <line
            key={y}
            x1="0"
            x2="700"
            y1={y}
            y2={y}
            stroke="#574b421c"
            strokeDasharray="3 5"
          />
        ))}
        <path d={path} fill="none" stroke="#ad694b" strokeWidth="2.5" />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={(i * 700) / (points.length-1)}
            cy={150 - (p.count / max) * 140}
            r="3"
            fill="#ad694b"
          >
            <title>
              {p.label}: {p.count} submissions
            </title>
          </circle>
        ))}
      </svg>
      <div className="chart-labels">
        {points.map((p, i) => (
          <span key={i}>{p.label}</span>
        ))}
      </div>
    </div>
  );
}
