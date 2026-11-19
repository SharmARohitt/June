"use client";

import * as echarts from "echarts";
import { motion } from "framer-motion";
import { useEffect, useMemo, useRef } from "react";

import { cn, toneClasses, type Tone } from "@/lib/utils";

export function Sparkline({
  values,
  tone = "lime",
  width = 120,
  height = 34,
  className,
  fill = true,
}: {
  values: number[];
  tone?: Tone;
  width?: number;
  height?: number;
  className?: string;
  fill?: boolean;
}) {
  const { line, area } = useMemo(() => {
    const safe = values.length ? values : [0, 0];
    const max = Math.max(...safe, 1);
    const min = Math.min(...safe, 0);
    const span = max - min || 1;
    const step = safe.length > 1 ? width / (safe.length - 1) : width;
    const points = safe.map((value, index) => {
      const x = index * step;
      const y = height - 3 - ((value - min) / span) * (height - 6);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return {
      line: `M${points.join(" L")}`,
      area: `M0,${height} L${points.join(" L")} L${width},${height} Z`,
    };
  }, [values, width, height]);

  const stroke = { lime: "#D6FF76", cyan: "#67D9E8", amber: "#FFB86B", red: "#FF6B81", violet: "#B69CFF", green: "#8BE28B", slate: "#6C7887" }[tone];

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cn("overflow-visible", className)} aria-hidden>
      {fill ? <path d={area} fill={stroke} opacity={0.09} /> : null}
      <motion.path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 1.1, ease: "easeOut" }}
      />
    </svg>
  );
}

export function ProgressRing({
  value,
  size = 92,
  strokeWidth = 7,
  tone = "lime",
  label,
  sublabel,
}: {
  value: number;
  size?: number;
  strokeWidth?: number;
  tone?: Tone;
  label?: string;
  sublabel?: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, value));
  const color = { lime: "#D6FF76", cyan: "#67D9E8", amber: "#FFB86B", red: "#FF6B81", violet: "#B69CFF", green: "#8BE28B", slate: "#6C7887" }[tone];

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={strokeWidth} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference - (clamped / 100) * circumference }}
          transition={{ duration: 1.1, ease: [0.2, 0.8, 0.2, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[15px] font-semibold text-ink">{label ?? `${Math.round(clamped)}%`}</span>
        {sublabel ? <span className="text-[9.5px] uppercase tracking-[0.12em] text-ink-faint">{sublabel}</span> : null}
      </div>
    </div>
  );
}

export function EChart({
  option,
  height = 280,
  className,
}: {
  option: echarts.EChartsOption;
  height?: number | string;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const chart = echarts.init(node, undefined, { renderer: "canvas" });
    chart.setOption(option, true);
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(node);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [option]);

  return <div ref={containerRef} className={cn("w-full", className)} style={{ height }} />;
}

export const chartTheme = {
  axis: {
    axisLine: { lineStyle: { color: "rgba(255,255,255,0.08)" } },
    axisTick: { show: false },
    axisLabel: { color: "#6C7887", fontSize: 10, fontFamily: "var(--font-geist-mono)" },
    splitLine: { lineStyle: { color: "rgba(255,255,255,0.05)" } },
  },
  tooltip: {
    backgroundColor: "#171F29",
    borderColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    textStyle: { color: "#F4F5F7", fontSize: 11.5 },
    padding: [10, 12],
    extraCssText: "border-radius:12px;box-shadow:0 18px 50px -20px rgba(0,0,0,0.9);",
  },
  legend: {
    textStyle: { color: "#AAB4C0", fontSize: 11 },
    icon: "roundRect",
    itemWidth: 8,
    itemHeight: 8,
  },
};
