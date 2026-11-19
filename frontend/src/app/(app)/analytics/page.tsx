"use client";

import { motion } from "framer-motion";
import type { EChartsOption } from "echarts";
import {
  BarChart3,
  CheckCircle2,
  Clock3,
  Gauge,
  RefreshCw,
  ShieldCheck,
  TrendingDown,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { PageHeader } from "@/components/shell/page-header";
import { chartTheme, EChart } from "@/components/ui/charts";
import {
  Badge,
  Button,
  EmptyState,
  Panel,
  ProgressBar,
  Segmented,
  Skeleton,
  StatusPill,
  useBeginner,
} from "@/components/ui/primitives";
import { useAnalytics } from "@/lib/hooks";
import { cn, duration, pct } from "@/lib/utils";

const RANGES = [
  { value: "7", label: "7 days" },
  { value: "14", label: "14 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
];

export default function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const analytics = useAnalytics(days);
  const beginner = useBeginner();
  const data = analytics.data;

  const seriesOption = useMemo<EChartsOption>(() => {
    const points = data?.by_day ?? [];
    return {
      grid: { left: 4, right: 12, top: 34, bottom: 6, containLabel: true },
      tooltip: { trigger: "axis", ...chartTheme.tooltip },
      legend: { ...chartTheme.legend, top: 0, right: 0 },
      xAxis: {
        type: "category",
        data: points.map((point) => point.label),
        ...chartTheme.axis,
        splitLine: { show: false },
      },
      yAxis: { type: "value", ...chartTheme.axis, minInterval: 1 },
      series: [
        {
          name: "Succeeded",
          type: "bar",
          stack: "outcome",
          data: points.map((point) => point.succeeded),
          itemStyle: { color: "#D6FF76" },
          barMaxWidth: 22,
        },
        {
          name: "Stopped",
          type: "bar",
          stack: "outcome",
          data: points.map((point) => point.failed),
          itemStyle: { color: "#FF6B81" },
          barMaxWidth: 22,
        },
        {
          name: "Blocked",
          type: "bar",
          stack: "outcome",
          data: points.map((point) => point.blocked),
          itemStyle: { color: "#FFB86B", borderRadius: [3, 3, 0, 0] },
          barMaxWidth: 22,
        },
      ],
    };
  }, [data]);

  const environmentOption = useMemo<EChartsOption>(() => {
    const entries = (data?.by_environment ?? []).filter((entry) => entry.executions > 0);
    return {
      tooltip: { trigger: "item", ...chartTheme.tooltip },
      legend: { ...chartTheme.legend, bottom: 0, left: "center" },
      series: [
        {
          type: "pie",
          radius: ["52%", "76%"],
          center: ["50%", "43%"],
          avoidLabelOverlap: true,
          itemStyle: { borderColor: "#0B0F15", borderWidth: 3 },
          label: { show: false },
          emphasis: { scale: true, scaleSize: 4 },
          data: entries.map((entry) => ({
            name: entry.name,
            value: entry.executions,
            itemStyle: { color: entry.color },
          })),
        },
      ],
    };
  }, [data]);

  const failureOption = useMemo<EChartsOption>(() => {
    const failures = [...(data?.failures ?? [])].reverse();
    return {
      grid: { left: 4, right: 18, top: 8, bottom: 6, containLabel: true },
      tooltip: { trigger: "axis", ...chartTheme.tooltip },
      xAxis: { type: "value", ...chartTheme.axis, minInterval: 1 },
      yAxis: {
        type: "category",
        data: failures.map((failure) => failure.label),
        ...chartTheme.axis,
        splitLine: { show: false },
        axisLabel: { ...chartTheme.axis.axisLabel, width: 160, overflow: "truncate" },
      },
      series: [
        {
          type: "bar",
          data: failures.map((failure) => failure.count),
          itemStyle: { color: "#FF6B81", borderRadius: [0, 4, 4, 0] },
          barMaxWidth: 16,
          label: { show: true, position: "right", color: "#AAB4C0", fontSize: 10 },
        },
      ],
    };
  }, [data]);

  const totalApprovals = data
    ? data.approvals.pending + data.approvals.approved + data.approvals.rejected
    : 0;

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 pb-16 pt-7 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Insight"
        title="Analytics"
        description="Measured outcomes from real executions: what ran, what succeeded, what was stopped and where time is spent. JUNE never fills a chart with invented numbers."
        meta={
          <>
            <Badge tone="cyan">{data?.range_days ?? days} day window</Badge>
            <Badge tone="slate">{data?.total_executions ?? 0} executions</Badge>
            {data?.success_rate !== null && data?.success_rate !== undefined ? (
              <Badge tone={data.success_rate >= 90 ? "lime" : data.success_rate >= 70 ? "amber" : "red"} dot>
                {pct(data.success_rate)} success
              </Badge>
            ) : null}
          </>
        }
        actions={
          <>
            <Segmented
              options={RANGES}
              value={String(days)}
              onChange={(value) => setDays(Number(value))}
            />
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={() => void analytics.refetch()}
              loading={analytics.isFetching}
            >
              Refresh
            </Button>
          </>
        }
      />

      {beginner ? (
        <Panel className="mt-5 border-cyan/20 bg-cyan/[0.04] px-5 py-4">
          <p className="text-[12.5px] leading-relaxed text-ink-muted">
            <span className="font-medium text-ink">How this works: </span>
            Everything on this page is counted from execution records in the selected window. Empty charts mean no runs
            were recorded — not that the numbers are missing.
          </p>
        </Panel>
      ) : null}

      {analytics.isLoading ? (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((key) => (
              <Skeleton key={key} className="h-[96px] w-full" />
            ))}
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-[320px] w-full" />
            <Skeleton className="h-[320px] w-full" />
          </div>
        </>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile
              label="Executions"
              value={String(data?.total_executions ?? 0)}
              hint="Runs recorded in the window"
              icon={<Workflow className="h-4 w-4" />}
            />
            <KpiTile
              label="Success rate"
              value={pct(data?.success_rate)}
              hint="Succeeded ÷ terminal runs"
              icon={<CheckCircle2 className="h-4 w-4" />}
              tone={
                data?.success_rate === null || data?.success_rate === undefined
                  ? "slate"
                  : data.success_rate >= 90
                    ? "lime"
                    : data.success_rate >= 70
                      ? "amber"
                      : "red"
              }
            />
            <KpiTile
              label="Average duration"
              value={duration(data?.avg_duration_ms)}
              hint="From start to terminal state"
              icon={<Clock3 className="h-4 w-4" />}
            />
            <KpiTile
              label="Approvals waiting"
              value={String(data?.approvals.pending ?? 0)}
              hint="Production decisions outstanding"
              icon={<ShieldCheck className="h-4 w-4" />}
              tone={data?.approvals.pending ? "amber" : "lime"}
            />
          </div>

          {data?.total_executions === 0 ? (
            <Panel className="mt-4 border-signal-amber/20 bg-signal-amber/[0.04] px-5 py-3.5">
              <p className="text-[11.5px] leading-relaxed text-ink-muted">
                No executions were recorded in the last {days} days. Charts below stay empty rather than being padded
                with placeholder data. Run an automation, or widen the window.
              </p>
            </Panel>
          ) : null}

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
            <Panel className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-5 py-3.5">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-lime" />
                  <div>
                    <p className="text-[12.5px] font-medium text-ink">Outcomes over time</p>
                    <p className="text-[10px] text-ink-faint">Succeeded · stopped · blocked, per day</p>
                  </div>
                </div>
              </div>
              <div className="px-2 pb-2 pt-3">
                <EChart option={seriesOption} height={300} />
              </div>
            </Panel>

            <Panel className="overflow-hidden">
              <div className="flex items-center gap-2 border-b border-white/[0.06] px-5 py-3.5">
                <Gauge className="h-4 w-4 text-cyan" />
                <div>
                  <p className="text-[12.5px] font-medium text-ink">Runs by environment</p>
                  <p className="text-[10px] text-ink-faint">Where execution actually happens</p>
                </div>
              </div>
              {(data?.by_environment ?? []).some((entry) => entry.executions > 0) ? (
                <div className="px-2 pb-1 pt-2">
                  <EChart option={environmentOption} height={300} />
                </div>
              ) : (
                <EmptyState
                  icon={<BarChart3 className="h-5 w-5" />}
                  title="No environment activity"
                  description="Environment distribution appears once runs are recorded."
                />
              )}
            </Panel>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
            <Panel className="overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-5 py-3.5">
                <div className="flex items-center gap-2">
                  <TrendingDown className="h-4 w-4 text-signal-red" />
                  <div>
                    <p className="text-[12.5px] font-medium text-ink">Why runs stop</p>
                    <p className="text-[10px] text-ink-faint">Classified failure codes</p>
                  </div>
                </div>
                <Link href="/executions?status=FAILED" className="text-[10.5px] text-ink-faint transition hover:text-lime">
                  View runs
                </Link>
              </div>
              {(data?.failures ?? []).length ? (
                <div className="px-2 pb-2 pt-3">
                  <EChart option={failureOption} height={Math.max(180, (data?.failures.length ?? 0) * 34 + 40)} />
                </div>
              ) : (
                <EmptyState
                  icon={<CheckCircle2 className="h-5 w-5" />}
                  title="No classified failures"
                  description="No run in this window ended in a failure or block. That is a real result, not a hidden error."
                />
              )}
            </Panel>

            <Panel className="overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-5 py-3.5">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-signal-violet" />
                  <div>
                    <p className="text-[12.5px] font-medium text-ink">Approval throughput</p>
                    <p className="text-[10px] text-ink-faint">Production decisions in this window</p>
                  </div>
                </div>
                <Badge tone="slate">{totalApprovals} decisions</Badge>
              </div>
              <div className="grid grid-cols-3 gap-2 px-5 py-4">
                <ApprovalStat label="Pending" value={data?.approvals.pending ?? 0} tone="amber" />
                <ApprovalStat label="Approved" value={data?.approvals.approved ?? 0} tone="lime" />
                <ApprovalStat label="Rejected" value={data?.approvals.rejected ?? 0} tone="red" />
              </div>
              <div className="border-t border-white/[0.06] px-5 py-3.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-ink-faint">Average time to decision</p>
                  <p className="text-[13px] font-medium text-ink">
                    {data?.approvals.avg_decision_minutes === null || data?.approvals.avg_decision_minutes === undefined
                      ? "—"
                      : `${Math.round(data.approvals.avg_decision_minutes)} min`}
                  </p>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <motion.div
                    className="h-full rounded-full bg-signal-violet"
                    initial={{ width: 0 }}
                    animate={{
                      width: `${
                        data?.approvals.avg_decision_minutes
                          ? Math.min(100, (data.approvals.avg_decision_minutes / 240) * 100)
                          : 0
                      }%`,
                    }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                  />
                </div>
                <p className="mt-1.5 text-[10px] text-ink-faint">
                  Measured from request to recorded decision. 4 hours is the demo service target.
                </p>
              </div>
            </Panel>
          </div>

          <Panel className="mt-4 overflow-hidden">
            <div className="flex items-center gap-2 border-b border-white/[0.06] px-5 py-3.5">
              <Workflow className="h-4 w-4 text-lime" />
              <div>
                <p className="text-[12.5px] font-medium text-ink">Automation performance</p>
                <p className="text-[10px] text-ink-faint">Ranked by recorded executions</p>
              </div>
            </div>
            {(data?.by_automation ?? []).length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-left">
                  <thead>
                    <tr className="border-b border-white/[0.06] text-[9.5px] uppercase tracking-[0.12em] text-ink-faint">
                      <th className="px-5 py-2 font-medium">Automation</th>
                      <th className="px-3 py-2 text-right font-medium">Executions</th>
                      <th className="px-3 py-2 font-medium">Success</th>
                      <th className="px-3 py-2 text-right font-medium">Avg duration</th>
                      <th className="px-3 py-2 font-medium">Health</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {data?.by_automation.map((entry) => {
                      const bad = entry.success_rate !== null && entry.success_rate < 70;
                      return (
                        <tr key={entry.automation_id} className="row-hover">
                          <td className="px-5 py-2.5 text-[11.5px] text-ink">{entry.name}</td>
                          <td className="px-3 py-2.5 text-right text-[11.5px] text-ink-muted">{entry.executions}</td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="w-[86px]">
                                <ProgressBar
                                  value={entry.success_rate ?? 0}
                                  tone={bad ? "red" : entry.success_rate && entry.success_rate >= 90 ? "lime" : "amber"}
                                />
                              </div>
                              <span className={cn("text-[10.5px]", bad ? "text-signal-red" : "text-ink-muted")}>
                                {pct(entry.success_rate)}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right text-[11px] text-ink-muted">
                            {duration(entry.avg_duration_ms)}
                          </td>
                          <td className="px-3 py-2.5">
                            <StatusPill status={bad ? "FAILED" : "SUCCEEDED"} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                icon={<Workflow className="h-5 w-5" />}
                title="No automation activity"
                description="Per-automation performance appears after executions are recorded."
              />
            )}
          </Panel>

          <p className="mt-4 text-[10.5px] leading-relaxed text-ink-faint">
            Definitions: a run is succeeded only when every stage completed. Blocked runs were stopped by policy or a
            failed approval. Timed-out and cancelled runs count as stopped. Decision time includes waiting for a human.
          </p>
        </>
      )}
    </div>
  );
}

function KpiTile({
  label,
  value,
  hint,
  icon,
  tone = "cyan",
}: {
  label: string;
  value: string;
  hint: string;
  icon: React.ReactNode;
  tone?: "lime" | "cyan" | "amber" | "red" | "slate";
}) {
  const styles = {
    lime: "text-lime border-lime/20 bg-lime/[0.06]",
    cyan: "text-cyan border-cyan/20 bg-cyan/[0.06]",
    amber: "text-signal-amber border-signal-amber/20 bg-signal-amber/[0.06]",
    red: "text-signal-red border-signal-red/20 bg-signal-red/[0.06]",
    slate: "text-ink-muted border-white/10 bg-white/[0.03]",
  }[tone];
  return (
    <Panel className="px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-faint">{label}</p>
        <span className={cn("flex h-7 w-7 items-center justify-center rounded-lg border", styles)}>{icon}</span>
      </div>
      <p className="kpi-value mt-1.5 text-[25px] font-semibold leading-none text-ink">{value}</p>
      <p className="mt-1 text-[10px] text-ink-faint">{hint}</p>
    </Panel>
  );
}

function ApprovalStat({ label, value, tone }: { label: string; value: number; tone: "amber" | "lime" | "red" }) {
  const text = { amber: "text-signal-amber", lime: "text-lime", red: "text-signal-red" }[tone];
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
      <p className="text-[9.5px] uppercase tracking-[0.12em] text-ink-faint">{label}</p>
      <p className={cn("kpi-value mt-1 text-[19px] font-semibold", text)}>{value}</p>
    </div>
  );
}
