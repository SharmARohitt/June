"use client";

import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Ban,
  CheckCircle2,
  CircleSlash,
  Clock3,
  Download,
  FileArchive,
  Hash,
  Layers,
  Loader2,
  Lock,
  RefreshCw,
  ScrollText,
  ShieldAlert,
  Sparkles,
  Terminal,
  Timer,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EnvBadge, SimulationNotice } from "@/components/domain/env-badge";
import {
  Badge,
  Button,
  CopyButton,
  EmptyState,
  Field,
  Modal,
  Panel,
  ProgressBar,
  Skeleton,
  StatusPill,
  Textarea,
} from "@/components/ui/primitives";
import { download, streamUrl } from "@/lib/api";
import {
  useCancelExecution,
  useExecution,
  useExecutionArtifacts,
  useExecutionInsight,
  useExecutionLogs,
  useMe,
} from "@/lib/hooks";
import { toast } from "@/lib/stores";
import {
  cn,
  duration,
  formatDate,
  bytes,
  relative,
  shortenHash,
  stageIcon,
  statusLabel,
  statusTone,
  toneClasses,
} from "@/lib/utils";
import type { ExecutionDetail, ExecutionLog, ExecutionStage } from "@/lib/types";

const ACTIVE = new Set(["QUEUED", "RUNNING", "WAITING_FOR_APPROVAL"]);
const TERMINAL = new Set(["SUCCEEDED", "FAILED", "BLOCKED", "TIMED_OUT", "CANCELLED"]);
const MAX_LOG_LINES = 1200;

const logTone: Record<string, string> = {
  INFO: "text-ink-muted",
  SUCCESS: "text-lime",
  WARN: "text-signal-amber",
  ERROR: "text-signal-red",
  DEBUG: "text-ink-faint",
};

export default function ExecutionDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const me = useMe();
  const executionQuery = useExecution(id);
  const logsQuery = useExecutionLogs(id);
  const artifacts = useExecutionArtifacts(id);
  const insight = useExecutionInsight(id);
  const cancel = useCancelExecution();

  const [live, setLive] = useState<ExecutionDetail | null>(null);
  const [logs, setLogs] = useState<ExecutionLog[]>([]);
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const seenLogs = useRef<Set<number>>(new Set());
  const pendingLogs = useRef<ExecutionLog[]>([]);
  const flushHandle = useRef<number | null>(null);

  const execution = live ?? executionQuery.data ?? null;
  const status = execution?.status ?? "";
  const isActive = ACTIVE.has(status);
  const canCancel = Boolean(me.data?.user?.permissions?.includes("executions:cancel"));

  const flushLogs = useCallback(() => {
    flushHandle.current = null;
    if (!pendingLogs.current.length) return;
    const batch = pendingLogs.current;
    pendingLogs.current = [];
    setLogs((current) => {
      const next = current.concat(batch).sort((left, right) => left.id - right.id);
      return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next;
    });
  }, []);

  const queueLog = useCallback(
    (log: ExecutionLog) => {
      if (seenLogs.current.has(log.id)) return;
      seenLogs.current.add(log.id);
      pendingLogs.current.push(log);
      if (flushHandle.current === null) {
        flushHandle.current = window.requestAnimationFrame(flushLogs);
      }
    },
    [flushLogs],
  );

  useEffect(() => {
    if (executionQuery.data) setLive(executionQuery.data);
  }, [executionQuery.data]);

  useEffect(() => {
    logsQuery.data?.forEach(queueLog);
  }, [logsQuery.data, queueLog]);

  useEffect(
    () => () => {
      if (flushHandle.current !== null) window.cancelAnimationFrame(flushHandle.current);
    },
    [],
  );

  useEffect(() => {
    if (!id) return;
    let source: EventSource | null = null;
    let stopped = false;
    let retries = 0;
    let reconnectTimer: number | undefined;

    const applySnapshot = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as ExecutionDetail;
        setLive(data);
        if (TERMINAL.has(data.status)) {
          stopped = true;
          source?.close();
        }
      } catch {
        /* ignore malformed frame */
      }
    };
    const onLog = (event: MessageEvent) => {
      try {
        queueLog(JSON.parse(event.data) as ExecutionLog);
      } catch {
        /* ignore malformed frame */
      }
    };

    const connect = () => {
      if (stopped) return;
      source = new EventSource(streamUrl(id, 0));
      source.addEventListener("open", () => {
        retries = 0;
      });
      source.addEventListener("snapshot", applySnapshot);
      source.addEventListener("execution", applySnapshot);
      source.addEventListener("stage", applySnapshot);
      source.addEventListener("approval", applySnapshot);
      source.addEventListener("log", onLog);
      source.onerror = () => {
        source?.close();
        if (stopped || retries >= 6) return;
        retries += 1;
        reconnectTimer = window.setTimeout(connect, Math.min(1000 * 2 ** retries, 15_000));
      };
    };
    connect();

    return () => {
      stopped = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      source?.close();
    };
  }, [id, queueLog]);

  const stages = execution?.stages ?? [];
  const selectedStage =
    stages.find((stage) => stage.id === selectedStageId) ??
    stages.find((stage) => stage.status === "RUNNING" || stage.status === "WAITING_FOR_APPROVAL") ??
    [...stages].reverse().find((stage) => stage.status === "FAILED") ??
    stages[0] ??
    null;

  if (executionQuery.isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-[140px]" />
        <Skeleton className="h-[150px]" />
        <div className="grid gap-5 xl:grid-cols-[1.7fr_1fr]">
          <Skeleton className="h-[420px]" />
          <Skeleton className="h-[420px]" />
        </div>
      </div>
    );
  }

  if (!execution) {
    return (
      <Panel className="p-8">
        <EmptyState
          icon={<CircleSlash className="h-5 w-5" />}
          title="Execution not found"
          description="This execution may have been removed, or your role cannot read it."
          action={
            <Button variant="secondary">
              <Link href="/executions">Back to executions</Link>
            </Button>
          }
        />
      </Panel>
    );
  }

  const failure = ["FAILED", "BLOCKED", "TIMED_OUT"].includes(status);
  const waiting = status === "WAITING_FOR_APPROVAL";

  return (
    <div className="space-y-5">
      <Link
        href="/executions"
        className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-ink-faint transition hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Execution ledger
      </Link>

      <Panel className="relative overflow-hidden p-0">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 grid-surface opacity-25" />
          <div
            className={cn(
              "absolute -right-20 -top-24 h-64 w-64 rounded-full blur-[100px]",
              waiting ? "bg-signal-amber/10" : failure ? "bg-signal-red/10" : "bg-lime/[0.07]",
            )}
          />
        </div>
        <div className="relative p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="mono rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-[10.5px] tracking-wide text-ink-muted">
                  {execution.display_id}
                </span>
                <StatusPill status={execution.status} />
                <EnvBadge environment={execution.environment} />
                {execution.execution_mode === "SIMULATION" ? (
                  <span className="rounded-full border border-signal-amber/25 bg-signal-amber/[0.08] px-2 py-0.5 text-[9.5px] font-medium uppercase tracking-[0.1em] text-signal-amber">
                    simulation
                  </span>
                ) : null}
              </div>
              <h1 className="mt-2.5 text-[24px] font-semibold tracking-[-0.03em] text-ink">
                <Link href={`/automations/${execution.automation.slug}`} className="transition hover:text-lime">
                  {execution.automation.name}
                </Link>
              </h1>
              <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-ink-muted">
                <span className="text-ink-faint">Reason given: </span>
                {execution.reason || "No reason recorded."}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-ink-faint">
                <span className="inline-flex items-center gap-1.5">
                  <UserRound className="h-3 w-3" />
                  {execution.requested_by_user.full_name}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Clock3 className="h-3 w-3" />
                  {relative(execution.created_at)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Timer className="h-3 w-3" />
                  {duration(execution.duration_ms)}
                </span>
                <span className="mono inline-flex items-center gap-1">
                  <Hash className="h-3 w-3" />
                  {shortenHash(execution.candidate_hash, 14)}
                  <CopyButton value={execution.candidate_hash} />
                </span>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {waiting ? (
                <Link
                  href="/approvals"
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-signal-amber/30 bg-signal-amber/10 px-4 text-[13px] font-medium text-signal-amber transition hover:bg-signal-amber/15"
                >
                  <BadgeCheck className="h-4 w-4" />
                  Review approval
                </Link>
              ) : null}
              {isActive && canCancel ? (
                <Button variant="danger" icon={<Ban className="h-4 w-4" />} onClick={() => setCancelOpen(true)}>
                  Cancel run
                </Button>
              ) : null}
              <Button variant="secondary" onClick={() => void executionQuery.refetch()} icon={<RefreshCw className="h-4 w-4" />}>
                Refresh
              </Button>
            </div>
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between text-[10.5px] text-ink-faint">
              <span className="inline-flex items-center gap-1.5">
                {isActive ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin text-cyan" />
                    {status === "RUNNING" ? execution.current_stage ?? "Working" : statusLabel(status)}
                  </>
                ) : (
                  <>
                    <CheckCircle2 className={cn("h-3 w-3", failure ? "text-signal-red" : "text-lime")} />
                    {statusLabel(status)}
                    {execution.finished_at ? ` · ${formatDate(execution.finished_at, "d MMM, HH:mm")}` : ""}
                  </>
                )}
              </span>
              <span className="mono">{execution.progress}%</span>
            </div>
            <div className="mt-1.5">
              <ProgressBar value={execution.progress} tone={failure ? "red" : waiting ? "amber" : isActive ? "cyan" : "lime"} />
            </div>
          </div>
        </div>
      </Panel>

      {waiting ? (
        <Panel className="border-signal-amber/25 bg-signal-amber/[0.05] p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg border border-signal-amber/30 bg-signal-amber/10 text-signal-amber">
                <Lock className="h-4 w-4" />
              </span>
              <div>
                <p className="text-[13px] font-medium text-ink">Paused at the approval gate</p>
                <p className="mt-0.5 max-w-2xl text-[11.5px] leading-relaxed text-ink-muted">
                  The candidate is frozen at <span className="mono text-ink-muted">{shortenHash(execution.candidate_hash, 18)}</span>.
                  An approver who is not the requester must decide. If the automation version, workflow or inputs
                  change, this approval is invalidated and the run cannot proceed.
                </p>
              </div>
            </div>
            <Link
              href="/approvals"
              className="inline-flex items-center gap-1.5 rounded-lg border border-signal-amber/30 bg-signal-amber/10 px-3 py-1.5 text-[11.5px] font-medium text-signal-amber transition hover:bg-signal-amber/15"
            >
              Open approval center
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </Panel>
      ) : null}

      {execution.execution_mode === "SIMULATION" && TERMINAL.has(status) ? (
        <div className="flex items-center gap-2">
          <SimulationNotice />
          <span className="text-[10.5px] text-ink-faint">
            Deployment stages recorded simulated outcomes only. JUNE never claims a real deployment it did not perform.
          </span>
        </div>
      ) : null}

      {status === "SUCCEEDED" && execution.result_summary?.headline ? (
        <Panel className="border-lime/20 bg-lime/[0.035] p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-lime" />
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-ink">{String(execution.result_summary.headline)}</p>
              {Array.isArray(execution.result_summary.details) ? (
                <ul className="mt-1.5 space-y-0.5 text-[11.5px] text-ink-muted">
                  {execution.result_summary.details.map((detail) => (
                    <li key={detail}>· {detail}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        </Panel>
      ) : null}

      {failure || status === "CANCELLED" ? (
        <Panel className="border-signal-red/20 bg-signal-red/[0.04] p-4">
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-signal-red" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[13px] font-medium text-ink">
                  {status === "CANCELLED" ? "This run was cancelled" : "This run stopped before completing"}
                </p>
                {execution.error_code ? (
                  <span className="mono rounded border border-signal-red/25 bg-signal-red/10 px-1.5 py-0.5 text-[9.5px] text-signal-red">
                    {execution.error_code}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
                {execution.error_message || execution.result_summary?.blocked_reason || "No error message was recorded."}
              </p>
              {insight.data?.insight ? (
                <div className="mt-3 rounded-xl border border-white/[0.07] bg-obsidian-900/60 p-3.5">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5 text-cyan" />
                    <p className="text-[11.5px] font-medium text-ink">{insight.data.insight.title}</p>
                    <span className="ml-auto rounded-full border border-cyan/20 bg-cyan/[0.07] px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.1em] text-cyan">
                      deterministic
                    </span>
                  </div>
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-muted">
                    {insight.data.insight.explanation}
                  </p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                        Likely causes
                      </p>
                      <ul className="mt-1 space-y-0.5 text-[11px] text-ink-muted">
                        {insight.data.insight.likely_causes.map((cause) => (
                          <li key={cause}>· {cause}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                        Suggested next steps
                      </p>
                      <ol className="mt-1 space-y-0.5 text-[11px] text-ink-muted">
                        {insight.data.insight.suggested_steps.map((step, index) => (
                          <li key={step}>
                            {index + 1}. {step}
                          </li>
                        ))}
                      </ol>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </Panel>
      ) : null}

      <Panel className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
          <div className="flex items-center gap-2">
            <Layers className="h-3.5 w-3.5 text-ink-faint" />
            <p className="text-[12px] font-semibold text-ink">Pipeline</p>
            <span className="text-[10.5px] text-ink-faint">
              {stages.filter((stage) => stage.status === "SUCCEEDED").length}/{stages.length} stages complete
            </span>
          </div>
          <span className="mono text-[10px] text-ink-faint">workflow {shortenHash(execution.workflow_version_id, 8)}</span>
        </div>
        <div className="overflow-x-auto p-4">
          <div className="flex min-w-max items-stretch gap-0">
            {stages.map((stage, index) => {
              const StageIcon = stageIcon(stage.key);
              const tone = stage.status === "SUCCEEDED" ? "lime" : stage.status === "RUNNING" ? "cyan" : stage.status === "WAITING_FOR_APPROVAL" ? "amber" : ["FAILED", "CANCELLED"].includes(stage.status) ? "red" : "slate";
              const selected = selectedStage?.id === stage.id;
              return (
                <div key={stage.id} className="flex items-stretch">
                  <button
                    onClick={() => setSelectedStageId(stage.id)}
                    className={cn(
                      "relative w-[164px] rounded-xl border p-3 text-left transition",
                      selected
                        ? "border-white/[0.18] bg-white/[0.06]"
                        : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={cn(
                          "flex h-7 w-7 items-center justify-center rounded-lg border",
                          toneClasses[tone].bg,
                          toneClasses[tone].border,
                          toneClasses[tone].text,
                        )}
                      >
                        {stage.status === "RUNNING" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <StageIcon className="h-3.5 w-3.5" />
                        )}
                      </span>
                      {stage.attempt > 1 ? (
                        <span className="text-[9px] text-ink-faint">try {stage.attempt}</span>
                      ) : null}
                    </div>
                    <p className="mt-2 truncate text-[11.5px] font-medium text-ink">{stage.name}</p>
                    <p className={cn("mt-0.5 text-[9.5px]", toneClasses[tone].text)}>
                      {statusLabel(stage.status)}
                      {stage.duration_ms ? ` · ${duration(stage.duration_ms)}` : ""}
                    </p>
                  </button>
                  {index < stages.length - 1 ? (
                    <span className="flex w-6 items-center justify-center">
                      <span
                        className={cn(
                          "h-px w-full",
                          stage.status === "SUCCEEDED" ? "bg-lime/40" : "bg-white/[0.08]",
                        )}
                      />
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        {selectedStage ? <StageDetail stage={selectedStage} /> : null}
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,1fr)]">
        <div className="min-w-0 space-y-5">
          <LogConsole logs={logs} active={isActive} execution={execution} />
        </div>

        <div className="min-w-0 space-y-5">
          <Panel className="p-5">
            <p className="text-[13px] font-semibold text-ink">Execution facts</p>
            <dl className="mt-3 space-y-2.5 text-[12px]">
              <Fact label="Environment" value={execution.environment.name} />
              <Fact label="Target group" value={execution.server_group?.name ?? "Environment default"} />
              <Fact label="Execution mode" value={execution.execution_mode} mono />
              <Fact label="Adapter" value={execution.adapter} mono />
              <Fact label="Automation version" value={execution.automation_version} mono />
              <Fact label="Timeout" value={`${execution.timeout_seconds}s`} />
              <Fact label="Created" value={formatDate(execution.created_at)} />
              <Fact label="Started" value={formatDate(execution.started_at)} />
              <Fact label="Finished" value={formatDate(execution.finished_at)} />
              <Fact label="Duration" value={duration(execution.duration_ms)} mono />
            </dl>
            <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <p className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                Candidate hash
              </p>
              <div className="mt-1.5 flex items-start gap-2">
                <p className="mono break-all text-[10px] leading-relaxed text-ink-muted">{execution.candidate_hash}</p>
                <CopyButton value={execution.candidate_hash} />
              </div>
              <p className="mt-1.5 text-[10px] leading-relaxed text-ink-faint">
                Binds automation version, workflow checksum, environment, target group and inputs.
              </p>
            </div>
          </Panel>

          <Panel className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-semibold text-ink">Approval</p>
              {execution.approval ? (
                <Badge tone={statusTone(execution.approval.status)}>{statusLabel(execution.approval.status)}</Badge>
              ) : execution.environment.kind === "PRODUCTION" ? (
                <span className="text-[10.5px] text-ink-faint">not reached</span>
              ) : (
                <span className="text-[10.5px] text-ink-faint">not required</span>
              )}
            </div>
            {execution.approval ? (
              <div className="mt-3 space-y-2 text-[11.5px]">
                <p className="text-ink-muted">
                  Requested {relative(execution.approval.created_at)}
                  {execution.approval.decided_at ? ` · decided ${relative(execution.approval.decided_at)}` : ""}
                </p>
                {execution.approval.comment ? (
                  <p className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-ink-muted">
                    “{execution.approval.comment}”
                  </p>
                ) : null}
                <Link href="/approvals" className="inline-flex items-center gap-1 text-[11px] font-medium text-cyan hover:text-cyan/80">
                  Open approval center
                  <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            ) : execution.environment.kind === "PRODUCTION" ? (
              <p className="mt-2 text-[11.5px] leading-relaxed text-ink-muted">
                {execution.status === "QUEUED" || execution.status === "RUNNING"
                  ? "The approval gate has not been reached yet. JUNE collects security and test evidence first, then pauses for a different authorised approver."
                  : "No approval was requested because this run stopped before its approval gate. Resolve the blocking issue and submit a new request."}
              </p>
            ) : (
              <p className="mt-2 text-[11.5px] leading-relaxed text-ink-muted">
                This environment does not require an approval gate. Policy allows direct execution here.
              </p>
            )}
          </Panel>

          <Panel className="p-5">
            <p className="text-[13px] font-semibold text-ink">Inputs</p>
            {Object.keys(execution.params ?? {}).length ? (
              <div className="mt-3 divide-y divide-white/[0.05]">
                {Object.entries(execution.params).map(([key, value]) => (
                  <div key={key} className="flex items-baseline justify-between gap-3 py-1.5">
                    <span className="mono text-[10.5px] text-ink-faint">{key}</span>
                    <span className="mono max-w-[60%] truncate text-right text-[11px] text-ink">
                      {typeof value === "object" ? JSON.stringify(value) : String(value)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-[11.5px] text-ink-faint">This automation takes no inputs.</p>
            )}
          </Panel>

          <Panel className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
              <p className="text-[13px] font-semibold text-ink">Artifacts</p>
              <span className="text-[10px] text-ink-faint">{artifacts.data?.length ?? 0}</span>
            </div>
            <div className="p-2">
              {(artifacts.data ?? []).length ? (
                (artifacts.data ?? []).map((artifact) => (
                  <div key={artifact.id} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition hover:bg-white/[0.03]">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.03] text-ink-muted">
                      <FileArchive className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11.5px] font-medium text-ink">{artifact.name}</p>
                      <p className="mono text-[9.5px] text-ink-faint">
                        {artifact.kind} · {bytes(artifact.size_bytes)} · {shortenHash(artifact.checksum, 8)}
                      </p>
                    </div>
                    <button
                      onClick={() =>
                        void download(`/executions/${execution.id}/artifacts/${artifact.id}/download`, artifact.name).catch(() =>
                          toast("Download failed", "error", "The artifact file may no longer be available."),
                        )
                      }
                      className="rounded-md p-1.5 text-ink-faint transition hover:bg-white/5 hover:text-ink"
                      title="Download artifact"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              ) : (
                <p className="px-2 py-5 text-center text-[11px] text-ink-faint">
                  No artifacts were produced by this run.
                </p>
              )}
            </div>
          </Panel>
        </div>
      </div>

      <CancelDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        pending={cancel.isPending}
        reason={cancelReason}
        setReason={setCancelReason}
        onConfirm={async () => {
          try {
            const updated = await cancel.mutateAsync({ id: execution.id, reason: cancelReason });
            setLive(updated);
            toast("Cancellation requested", "warning", "JUNE will stop the run at the next safe point.");
            setCancelOpen(false);
          } catch {
            toast("Could not cancel", "error", "The execution may already have finished.");
          }
        }}
      />
    </div>
  );
}

function StageDetail({ stage }: { stage: ExecutionStage }) {
  const [showOutput, setShowOutput] = useState(false);
  const hasOutput = stage.output && Object.keys(stage.output).length > 0;
  return (
    <div className="border-t border-white/[0.06] bg-obsidian-900/40 px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[11.5px] font-medium text-ink">
            {stage.name} <span className="mono text-[9.5px] text-ink-faint">{stage.key}</span>
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-ink-muted">{stage.description || "No description."}</p>
        </div>
        <div className="flex items-center gap-2">
          {stage.started_at ? (
            <span className="text-[10px] text-ink-faint">
              {formatDate(stage.started_at, "HH:mm:ss")}
              {stage.finished_at ? ` → ${formatDate(stage.finished_at, "HH:mm:ss")}` : ""}
            </span>
          ) : null}
          <StatusPill status={stage.status} />
          {hasOutput ? (
            <button
              onClick={() => setShowOutput((value) => !value)}
              className="rounded-lg border border-white/10 px-2 py-1 text-[10px] font-medium text-ink-muted transition hover:bg-white/5 hover:text-ink"
            >
              {showOutput ? "Hide output" : "View output"}
            </button>
          ) : null}
        </div>
      </div>
      {stage.error_message ? (
        <p className="mt-2 rounded-lg border border-signal-red/20 bg-signal-red/[0.05] px-3 py-2 text-[11px] text-signal-red">
          {stage.error_message}
        </p>
      ) : null}
      {showOutput && hasOutput ? (
        <pre className="mono mt-2.5 max-h-64 overflow-auto rounded-lg border border-white/[0.06] bg-obsidian-950/80 p-3 text-[10.5px] leading-relaxed text-ink-muted">
          {JSON.stringify(stage.output, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

function LogConsole({
  logs,
  active,
  execution,
}: {
  logs: ExecutionLog[];
  active: boolean;
  execution: ExecutionDetail;
}) {
  const [level, setLevel] = useState("ALL");
  const [follow, setFollow] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () => (level === "ALL" ? logs : logs.filter((log) => log.level === level)),
    [logs, level],
  );

  useEffect(() => {
    if (!follow) return;
    const container = scrollRef.current;
    if (!container) return;
    const frame = window.requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [filtered.length, follow]);

  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5 text-ink-faint" />
          <p className="text-[12px] font-semibold text-ink">Live log</p>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9.5px] font-medium",
              active ? "border-cyan/25 bg-cyan/10 text-cyan" : "border-white/10 bg-white/[0.03] text-ink-faint",
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", active ? "animate-pulse-dot bg-cyan" : "bg-ink-faint")} />
            {active ? "streaming" : "complete"}
          </span>
          <span className="mono text-[9.5px] text-ink-faint">{logs.length} lines</span>
        </div>
        <div className="flex items-center gap-1">
          <select
            value={level}
            onChange={(event) => setLevel(event.target.value)}
            className="rounded-lg border border-white/10 bg-obsidian-900 px-2 py-1 text-[10.5px] text-ink-muted outline-none"
          >
            <option value="ALL">All levels</option>
            <option value="INFO">Info</option>
            <option value="SUCCESS">Success</option>
            <option value="WARN">Warn</option>
            <option value="ERROR">Error</option>
            <option value="DEBUG">Debug</option>
          </select>
          <button
            onClick={() => setFollow((value) => !value)}
            className={cn(
              "rounded-lg border px-2 py-1 text-[10.5px] font-medium transition",
              follow
                ? "border-lime/25 bg-lime/10 text-lime"
                : "border-white/10 text-ink-muted hover:bg-white/5 hover:text-ink",
            )}
          >
            Follow
          </button>
          <CopyButton value={logs.map((log) => `${log.created_at} [${log.level}] ${log.message}`).join("\n")} label="Copy" />
        </div>
      </div>

      <div
        ref={scrollRef}
        className="max-h-[540px] min-h-[320px] overflow-y-auto bg-obsidian-950/70 px-3 py-3"
      >
        {filtered.length === 0 ? (
          <div className="flex h-[300px] flex-col items-center justify-center gap-2 text-center">
            {active ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin text-cyan" />
                <p className="text-[11.5px] text-ink-muted">Waiting for the first log line…</p>
              </>
            ) : (
              <>
                <ScrollText className="h-5 w-5 text-ink-faint" />
                <p className="text-[11.5px] text-ink-muted">No log lines match this filter.</p>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-0.5">
            {filtered.map((log) => (
              <div key={log.id} className="log-line group flex gap-2.5 rounded px-1.5 py-[1px] hover:bg-white/[0.025]">
                <span className="shrink-0 text-ink-faint/70">{formatDate(log.created_at, "HH:mm:ss.SSS")}</span>
                <span
                  className={cn(
                    "w-14 shrink-0 text-[9.5px] font-semibold uppercase tracking-[0.08em]",
                    logTone[log.level] ?? "text-ink-muted",
                  )}
                >
                  {log.level}
                </span>
                <span className="w-24 shrink-0 truncate text-ink-faint/80">{log.stage_key ?? log.source}</span>
                <span className={cn("min-w-0 flex-1 whitespace-pre-wrap break-words", logTone[log.level] ?? "text-ink-muted")}>
                  {log.message}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] bg-obsidian-900/60 px-4 py-2 text-[10px] text-ink-faint">
        <span>Streamed from the execution engine over Server-Sent Events.</span>
        <span className="mono">
          {execution.display_id} · {execution.stages.length} stages
        </span>
      </div>
    </Panel>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-ink-faint">{label}</dt>
      <dd className={cn("truncate text-right text-ink", mono && "mono text-[10.5px]")}>{value}</dd>
    </div>
  );
}

function CancelDialog({
  open,
  onClose,
  onConfirm,
  pending,
  reason,
  setReason,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
  reason: string;
  setReason: (value: string) => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Cancel this execution?"
      description="JUNE stops the run at the next safe point. The execution, its logs and its evidence are never deleted."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep running
          </Button>
          <Button variant="danger" loading={pending} onClick={onConfirm} icon={<Ban className="h-4 w-4" />}>
            Request cancellation
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-2.5 rounded-xl border border-signal-amber/25 bg-signal-amber/[0.06] px-3.5 py-2.5">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-signal-amber" />
          <p className="text-[11.5px] leading-relaxed text-ink-muted">
            Cancellation is recorded in the audit trail with your name and reason. Remote targets may already have
            changed — verify their state before retrying.
          </p>
        </div>
        <Field label="Why are you cancelling?" hint="This is shown to everyone who reviews the run.">
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. Wrong target group selected — stopping before promotion."
            maxLength={500}
          />
        </Field>
      </div>
    </Modal>
  );
}
