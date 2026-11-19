"use client";

import { motion } from "framer-motion";
import {
  ArrowRight,
  BadgeCheck,
  CircleCheck,
  Clock3,
  FlaskConical,
  Gauge,
  Inbox,
  Layers,
  PlayCircle,
  Radar,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  TriangleAlert,
  Users,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { ExecutionRow } from "@/components/domain/execution-row";
import { PageHeader } from "@/components/shell/page-header";
import { EChart, chartTheme } from "@/components/ui/charts";
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  InfoTip,
  Panel,
  SectionHeading,
  Segmented,
  Skeleton,
  useBeginner,
} from "@/components/ui/primitives";
import { useDashboard, useMe } from "@/lib/hooks";
import { cn, formatDate, humanize, pct, plural, relative, shortenHash, statusTone, toneClasses } from "@/lib/utils";

const kpiIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  automations: Workflow,
  active: PlayCircle,
  approvals: BadgeCheck,
  failures: TriangleAlert,
  success_rate: TrendingUp,
  uat_health: FlaskConical,
};

export default function CommandCenterPage() {
  const router = useRouter();
  const me = useMe();
  const [days, setDays] = useState("7");
  const dashboard = useDashboard(Number(days));
  const beginner = useBeginner();
  const user = me.data?.user;
  const data = dashboard.data;
  const firstName = user?.full_name.split(" ")[0] ?? "there";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const chartOption = useMemo(() => {
    const series = data?.execution_series ?? [];
    return {
      grid: { top: 18, right: 10, bottom: 24, left: 34 },
      tooltip: {
        ...chartTheme.tooltip,
        trigger: "axis" as const,
        axisPointer: { type: "shadow" as const, shadowStyle: { color: "rgba(255,255,255,0.035)" } },
      },
      legend: { ...chartTheme.legend, right: 4, top: -2 },
      xAxis: {
        type: "category" as const,
        data: series.map((point) => {
          const date = new Date(`${point.label}T00:00:00`);
          return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
        }),
        ...chartTheme.axis,
        axisLine: { lineStyle: { color: "rgba(255,255,255,0.08)" } },
      },
      yAxis: {
        type: "value" as const,
        minInterval: 1,
        ...chartTheme.axis,
        axisLine: { show: false },
      },
      series: [
        {
          name: "Succeeded",
          type: "bar" as const,
          stack: "total",
          data: series.map((point) => point.succeeded),
          itemStyle: { color: "#D6FF76", borderRadius: [0, 0, 3, 3] },
          barWidth: 15,
        },
        {
          name: "Stopped",
          type: "bar" as const,
          stack: "total",
          data: series.map((point) => point.failed),
          itemStyle: { color: "#FF6B81" },
          barWidth: 15,
        },
        {
          name: "Blocked",
          type: "bar" as const,
          stack: "total",
          data: series.map((point) => point.blocked),
          itemStyle: { color: "#FFB86B", borderRadius: [3, 3, 0, 0] },
          barWidth: 15,
        },
      ],
    };
  }, [data?.execution_series]);

  const pending = data?.pending_approvals ?? [];
  const alerts = data?.active_alerts ?? [];
  const health = data?.environment_health ?? [];
  const pulse = data?.live_pulse ?? {};

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Command Center"
        title={`${greeting}, ${firstName}`}
        description="One honest view of what JUNE can run, what is running, what needs a decision, and what the evidence says."
        meta={
          <>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-faint">
              <Clock3 className="h-3 w-3" />
              {formatDate(data?.generated_at ?? new Date().toISOString(), "EEEE d MMMM · HH:mm")}
            </span>
            <span className="h-3 w-px bg-white/10" />
            <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-faint">
              <span className={cn("h-1.5 w-1.5 rounded-full", "bg-lime", "animate-pulse-dot")} />
              Live · refresh every 10s
            </span>
          </>
        }
        actions={
          <>
            <Button
              variant="secondary"
              icon={<BadgeCheck className="h-4 w-4" />}
              onClick={() => router.push("/approvals")}
            >
              {pending.length ? `${plural(pending.length, "decision")} waiting` : "No decisions waiting"}
            </Button>
            <Button
              variant="primary"
              icon={<Sparkles className="h-4 w-4" />}
              onClick={() => router.push("/automations")}
            >
              Run an automation
            </Button>
          </>
        }
      />

      {beginner ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-2xl border border-cyan/20 bg-cyan/[0.05] p-4"
        >
          <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-cyan/10 blur-3xl" />
          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg border border-cyan/25 bg-cyan/10 text-cyan">
                <Sparkles className="h-4 w-4" />
              </span>
              <div>
                <p className="text-[13px] font-medium text-ink">New to JUNE? Follow the safe path.</p>
                <p className="mt-0.5 max-w-2xl text-[12px] leading-relaxed text-ink-muted">
                  Discover an automation, read its plain-English guide, run it in UAT, watch the live log. When a run
                  needs production approval, JUNE walks you through the evidence and the separation-of-duties rule.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/automations" className="chip border-cyan/20 text-cyan transition hover:bg-cyan/10">
                1 · Discover
              </Link>
              <Link href="/executions" className="chip text-ink-muted transition hover:bg-white/5">
                2 · Execute safely
              </Link>
              <Link href="/approvals" className="chip text-ink-muted transition hover:bg-white/5">
                3 · Approve with evidence
              </Link>
            </div>
          </div>
        </motion.div>
      ) : null}

      <section>
        {dashboard.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-[124px]" />
            ))}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            {(data?.kpis ?? []).map((kpi, index) => {
              const Icon = kpiIcons[kpi.key] ?? Gauge;
              const alert =
                (kpi.key === "failures" && kpi.value > 0) || (kpi.key === "approvals" && kpi.value > 0);
              return (
                <motion.div
                  key={kpi.key}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.04, duration: 0.4 }}
                >
                  <Link
                    href={kpi.href}
                    className={cn(
                      "group relative flex h-full flex-col justify-between overflow-hidden rounded-2xl border border-white/[0.07] bg-obsidian-800/70 p-4 shadow-inset transition hover:-translate-y-0.5 hover:border-white/[0.14] hover:bg-obsidian-700/70",
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <span
                        className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-lg border",
                          alert
                            ? "border-signal-amber/25 bg-signal-amber/10 text-signal-amber"
                            : "border-white/[0.08] bg-white/[0.03] text-ink-muted",
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <InfoTip content={kpi.help} />
                    </div>
                    <div className="mt-5">
                      <p className="kpi-value text-[30px] font-semibold leading-none text-ink">
                        {typeof kpi.value === "number"
                          ? kpi.value.toLocaleString(undefined, { maximumFractionDigits: 1 })
                          : kpi.value}
                        {kpi.unit ? <span className="ml-1 text-[15px] font-medium text-ink-muted">{kpi.unit}</span> : null}
                      </p>
                      <p className="mt-2 text-[11.5px] font-medium text-ink-muted">{kpi.label}</p>
                    </div>
                    <span className="pointer-events-none absolute inset-x-4 bottom-0 h-px bg-gradient-to-r from-transparent via-lime/30 to-transparent opacity-0 transition group-hover:opacity-100" />
                  </Link>
                </motion.div>
              );
            })}
          </div>
        )}
      </section>

      {alerts.length ? (
        <Panel className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-2.5">
            <TriangleAlert className="h-3.5 w-3.5 text-signal-amber" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
              Needs attention · {plural(alerts.length, "item")}
            </p>
          </div>
          <div className="divide-y divide-white/[0.05]">
            {alerts.slice(0, 3).map((alert) => {
              const tone = alert.severity === "high" ? "red" : alert.severity === "medium" ? "amber" : "cyan";
              return (
                <Link
                  key={alert.id}
                  href={alert.href}
                  className="group flex items-center gap-3 px-4 py-2.5 transition hover:bg-white/[0.03]"
                >
                  <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", toneClasses[tone].dot)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-ink">{alert.title}</span>
                    <span className="block truncate text-[11px] text-ink-faint">{alert.message}</span>
                  </span>
                  <span className="shrink-0 text-[10.5px] text-ink-faint">{relative(alert.ts)}</span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink-faint transition group-hover:text-lime" />
                </Link>
              );
            })}
          </div>
        </Panel>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]">
        <div className="min-w-0 space-y-5">
          <Panel className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <SectionHeading
                title="Execution activity"
                description="Every terminal outcome, grouped by the day it started. Nothing is inferred."
              />
              <Segmented
                value={days}
                onChange={setDays}
                options={[
                  { value: "7", label: "7d" },
                  { value: "14", label: "14d" },
                  { value: "30", label: "30d" },
                ]}
              />
            </div>
            {dashboard.isLoading ? (
              <Skeleton className="mt-5 h-[260px]" />
            ) : (
              <div className="mt-4">
                <EChart option={chartOption} height={262} />
              </div>
            )}
          </Panel>

          <Panel className="overflow-hidden">
            <div className="flex items-center justify-between px-5 pb-2 pt-5">
              <SectionHeading
                title="Recent executions"
                description="The last six runs in this workspace, newest first."
              />
              <Link
                href="/executions"
                className="inline-flex items-center gap-1 text-[11.5px] font-medium text-ink-muted transition hover:text-lime"
              >
                All executions
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <div className="px-2 pb-3">
              {dashboard.isLoading ? (
                <div className="space-y-2 p-3">
                  {[0, 1, 2, 3].map((index) => (
                    <Skeleton key={index} className="h-14 w-full" />
                  ))}
                </div>
              ) : (data?.recent_executions ?? []).length ? (
                (data?.recent_executions ?? []).map((execution) => (
                  <ExecutionRow key={execution.id} execution={execution} compact />
                ))
              ) : (
                <EmptyState
                  icon={<PlayCircle className="h-5 w-5" />}
                  title="No executions yet"
                  description="Run an automation in UAT to create your first piece of evidence."
                  action={
                    <Button variant="primary" size="sm">
                      <Link href="/automations">Browse automations</Link>
                    </Button>
                  }
                />
              )}
            </div>
          </Panel>

          <Panel className="overflow-hidden">
            <div className="flex items-center justify-between px-5 pb-2 pt-5">
              <SectionHeading
                title="Stopped runs"
                description="Failures, blocks and timeouts — with the exact reason JUNE recorded."
              />
              <Link
                href="/executions?status=FAILED"
                className="text-[11.5px] font-medium text-ink-muted transition hover:text-lime"
              >
                Investigate
              </Link>
            </div>
            <div className="px-3 pb-3">
              {(data?.recent_failures ?? []).length === 0 ? (
                <div className="m-2 flex items-center gap-3 rounded-xl border border-lime/15 bg-lime/[0.045] px-4 py-4">
                  <CircleCheck className="h-5 w-5 shrink-0 text-lime" />
                  <div>
                    <p className="text-[12.5px] font-medium text-ink">No stopped runs in this window</p>
                    <p className="text-[11.5px] text-ink-muted">
                      When a run stops, the failure reason and suggested next step appear here.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {(data?.recent_failures ?? []).map((execution) => (
                    <ExecutionRow key={execution.id} execution={execution} compact />
                  ))}
                </div>
              )}
            </div>
          </Panel>
        </div>

        <div className="min-w-0 space-y-5">
          <Panel className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-signal-amber/25 bg-signal-amber/10 text-signal-amber">
                  <BadgeCheck className="h-3.5 w-3.5" />
                </span>
                <div>
                  <p className="text-[12.5px] font-semibold text-ink">Approvals waiting</p>
                  <p className="text-[10.5px] text-ink-faint">
                    {pending.length ? "A production candidate needs a decision" : "Nothing is blocked on a human"}
                  </p>
                </div>
              </div>
              <Badge tone={pending.length ? "amber" : "lime"}>{pending.length}</Badge>
            </div>
            {dashboard.isLoading ? (
              <div className="space-y-2 p-3">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : pending.length ? (
              <div className="divide-y divide-white/[0.05]">
                {pending.slice(0, 3).map((approval) => (
                  <Link
                    key={approval.id}
                    href="/approvals"
                    className="group block px-4 py-3 transition hover:bg-white/[0.03]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-[12.5px] font-medium text-ink">{approval.automation.name}</p>
                      <Badge tone="amber">{approval.environment.name}</Badge>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 text-[10.5px] text-ink-faint">
                      <Avatar name={approval.requester.full_name} size={18} />
                      <span className="truncate">{approval.requester.full_name}</span>
                      <span>·</span>
                      <span>{relative(approval.created_at)}</span>
                    </div>
                    <p className="mono mt-1.5 truncate text-[9.5px] text-ink-faint/80">
                      candidate {shortenHash(approval.candidate_hash, 12)}
                    </p>
                  </Link>
                ))}
                <Link
                  href="/approvals"
                  className="flex items-center justify-between px-4 py-2.5 text-[11.5px] font-medium text-amber-100/80 transition hover:bg-white/[0.03] hover:text-signal-amber"
                >
                  Open the approval center
                  <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            ) : (
              <EmptyState
                icon={<ShieldCheck className="h-5 w-5" />}
                title="No pending approvals"
                description="Production candidates that need a human decision will appear here with their evidence."
                className="py-8"
              />
            )}
          </Panel>

          <Panel className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-[12.5px] font-semibold text-ink">Environment health</p>
              <Radar className="h-3.5 w-3.5 text-ink-faint" />
            </div>
            <div className="mt-3 space-y-2.5">
              {health.length === 0 && dashboard.isLoading
                ? [0, 1, 2].map((index) => <Skeleton key={index} className="h-14 w-full" />)
                : health.map((environment) => {
                    const tone = statusTone(environment.status);
                    return (
                      <div key={environment.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", toneClasses[tone].dot)} />
                            <p className="truncate text-[12px] font-medium text-ink">{environment.name}</p>
                            <span className="rounded border border-white/10 px-1 py-px text-[9px] uppercase tracking-wide text-ink-faint">
                              {environment.execution_mode === "SIMULATION" ? "sim" : environment.kind}
                            </span>
                          </div>
                          <span className={cn("shrink-0 text-[10.5px] font-medium", toneClasses[tone].text)}>
                            {humanize(environment.status)}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-1 text-[10.5px] text-ink-faint">{environment.detail}</p>
                        <div className="mt-2 flex items-center gap-3 text-[10px] text-ink-faint">
                          <span>{environment.servers_total} targets</span>
                          <span>·</span>
                          <span>{environment.executions_in_range} runs</span>
                          <span>·</span>
                          <span>{pct(environment.success_rate)} success</span>
                        </div>
                      </div>
                    );
                  })}
            </div>
            <Link
              href="/infrastructure"
              className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-ink-muted transition hover:text-lime"
            >
              Inspect infrastructure
              <ArrowRight className="h-3 w-3" />
            </Link>
          </Panel>

          <Panel className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-[12.5px] font-semibold text-ink">Live pulse</p>
              <span className="inline-flex items-center gap-1.5 text-[10px] text-ink-faint">
                <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-cyan" />
                24h window
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <PulseStat label="Running" value={pulse.running ?? 0} icon={<PlayCircle className="h-3.5 w-3.5" />} tone="cyan" />
              <PulseStat label="Queued" value={pulse.queued ?? 0} icon={<Layers className="h-3.5 w-3.5" />} tone="slate" />
              <PulseStat
                label="Agents online"
                value={`${pulse.agents_online ?? 0}/${pulse.agents_total ?? 0}`}
                icon={<Users className="h-3.5 w-3.5" />}
                tone="lime"
              />
              <PulseStat
                label="Failure rate"
                value={pulse.failure_rate_24h === null || pulse.failure_rate_24h === undefined ? "—" : `${pulse.failure_rate_24h}%`}
                icon={<TriangleAlert className="h-3.5 w-3.5" />}
                tone={pulse.failure_rate_24h ? "amber" : "slate"}
              />
            </div>
            <div className="mt-3">
              <div className="mb-1.5 flex items-center justify-between text-[10.5px] text-ink-faint">
                <span>Runner utilisation</span>
                <span className="mono">{pulse.utilization ?? 0}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-cyan/70 to-lime"
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(100, pulse.utilization ?? 0)}%` }}
                  transition={{ duration: 0.8, ease: [0.2, 0.8, 0.2, 1] }}
                />
              </div>
            </div>
          </Panel>

          <Panel className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
              <p className="text-[12.5px] font-semibold text-ink">Latest chronicle entries</p>
              <Link href="/chronicle" className="text-[10.5px] font-medium text-ink-faint transition hover:text-lime">
                Full trail
              </Link>
            </div>
            <ol className="relative px-4 py-3">
              <span className="absolute bottom-4 left-[22px] top-4 w-px bg-white/[0.06]" />
              {(data?.recent_audit ?? []).slice(0, 5).map((event) => (
                <li key={event.id} className="relative flex gap-3 py-1.5">
                  <span className="relative z-10 mt-1 flex h-2 w-2 shrink-0 items-center justify-center">
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        event.outcome === "SUCCESS" ? "bg-lime/80" : "bg-signal-red",
                      )}
                    />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[11.5px] text-ink">{humanize(event.action)}</p>
                    <p className="truncate text-[10px] text-ink-faint">
                      {event.actor_label} · {relative(event.created_at)}
                    </p>
                  </div>
                </li>
              ))}
              {dashboard.isLoading ? <Skeleton className="ml-5 h-20" /> : null}
              {!dashboard.isLoading && (data?.recent_audit ?? []).length === 0 ? (
                <li className="py-2 text-[11px] text-ink-faint">No audit events yet.</li>
              ) : null}
            </ol>
          </Panel>
        </div>
      </div>

      <Panel className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-cyan">
            <Inbox className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[12.5px] font-medium text-ink">A note on honesty</p>
            <p className="mt-0.5 max-w-3xl text-[11.5px] leading-relaxed text-ink-muted">
              JUNE only reports what it measured. Production runs against unconfigured infrastructure are labelled
              as simulations, stopped runs keep their real cause, and every figure links back to the executions that
              produced it.
            </p>
          </div>
        </div>
        <Link
          href="/help"
          className="inline-flex items-center gap-1 text-[11.5px] font-medium text-cyan transition hover:text-cyan/80"
        >
          How JUNE decides what is real
          <ArrowRight className="h-3 w-3" />
        </Link>
      </Panel>
    </div>
  );
}

function PulseStat({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  tone: "cyan" | "lime" | "amber" | "slate";
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
      <div className={cn("flex items-center gap-1.5", toneClasses[tone].text)}>
        {icon}
        <span className="text-[9.5px] font-medium uppercase tracking-[0.1em]">{label}</span>
      </div>
      <p className="mt-1.5 text-[18px] font-semibold leading-none text-ink">{value}</p>
    </div>
  );
}
