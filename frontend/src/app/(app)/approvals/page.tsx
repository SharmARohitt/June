"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  Clock3,
  FileCheck2,
  Fingerprint,
  Hash,
  Inbox,
  Lock,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  UserRound,
  X,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { EnvBadge } from "@/components/domain/env-badge";
import { PageHeader } from "@/components/shell/page-header";
import {
  Avatar,
  Badge,
  Button,
  CopyButton,
  EmptyState,
  Field,
  Modal,
  Panel,
  Skeleton,
  StatusPill,
  Tabs,
  Textarea,
  useBeginner,
} from "@/components/ui/primitives";
import { ApiError } from "@/lib/api";
import { useApprovalDecision, useApprovals, useExecution, useMe } from "@/lib/hooks";
import { can } from "@/lib/nav";
import { toast } from "@/lib/stores";
import type { Approval } from "@/lib/types";
import {
  automationIcon,
  cn,
  formatDate,
  humanize,
  relative,
  riskTone,
  shortenHash,
  statusLabel,
  statusTone,
  toneClasses,
} from "@/lib/utils";

const TABS = [
  { key: "PENDING", label: "Waiting" },
  { key: "APPROVED", label: "Approved" },
  { key: "REJECTED", label: "Rejected" },
  { key: "ALL", label: "All records" },
];

export default function ApprovalsPage() {
  const me = useMe();
  const approvals = useApprovals("ALL");
  const [tab, setTab] = useState("PENDING");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const beginner = useBeginner();

  const items = approvals.data ?? [];
  const counts = useMemo(() => {
    const map: Record<string, number> = { PENDING: 0, APPROVED: 0, REJECTED: 0, ALL: items.length };
    for (const item of items) map[item.status] = (map[item.status] ?? 0) + 1;
    return map;
  }, [items]);

  const filtered = useMemo(
    () => (tab === "ALL" ? items : items.filter((item) => item.status === tab)),
    [items, tab],
  );

  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0] ?? null;
  const permissions = me.data?.user.permissions ?? [];
  const pendingCount = counts.PENDING ?? 0;
  const expiringSoon = items.filter((item) => {
    if (item.status !== "PENDING" || !item.expires_at) return false;
    const left = new Date(item.expires_at).getTime() - Date.now();
    return left > 0 && left < 6 * 3600_000;
  }).length;

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 pb-16 pt-7 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Governance"
        title="Approval Center"
        description="Production promotions wait here until a different human reviews the exact candidate evidence. Approvals are bound to a hash — if the candidate changes, the request becomes invalid."
        meta={
          <>
            <Badge tone={pendingCount ? "amber" : "slate"} dot>
              {pendingCount} waiting
            </Badge>
            <Badge tone="cyan">Separation of duties enforced</Badge>
            {expiringSoon ? <Badge tone="red">{expiringSoon} expiring within 6h</Badge> : null}
          </>
        }
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw className="h-3.5 w-3.5" />}
            onClick={() => void approvals.refetch()}
            loading={approvals.isFetching}
          >
            Refresh
          </Button>
        }
      />

      {beginner ? (
        <Panel className="mt-5 border-cyan/20 bg-cyan/[0.04] px-5 py-4">
          <p className="text-[12.5px] leading-relaxed text-ink-muted">
            <span className="font-medium text-ink">How this works: </span>
            A request appears when a production run reaches the approval gate. Read the evidence, then approve to
            promote exactly that candidate — or reject to stop it. You can never approve your own request.
          </p>
        </Panel>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <Tabs
          tabs={TABS.map((entry) => ({
            key: entry.key,
            label: entry.label,
            count: counts[entry.key] ?? 0,
          }))}
          value={tab}
          onChange={(key) => {
            setTab(key);
            setSelectedId(null);
          }}
        />
        <p className="text-[11px] text-ink-faint">
          Decision window 24 hours · every decision is written to the Chronicle
        </p>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,390px)_minmax(0,1fr)]">
        <div className="min-w-0">
          {approvals.isLoading ? (
            <div className="space-y-2.5">
              {[0, 1, 2].map((key) => (
                <Skeleton key={key} className="h-[112px] w-full" />
              ))}
            </div>
          ) : filtered.length ? (
            <div className="space-y-2.5">
              {filtered.map((approval) => (
                <QueueCard
                  key={approval.id}
                  approval={approval}
                  active={selected?.id === approval.id}
                  onSelect={() => setSelectedId(approval.id)}
                />
              ))}
            </div>
          ) : (
            <Panel>
              <EmptyState
                icon={tab === "PENDING" ? <Inbox className="h-5 w-5" /> : <FileCheck2 className="h-5 w-5" />}
                title={tab === "PENDING" ? "Nothing is waiting for a decision" : `No ${tab.toLowerCase()} approvals`}
                description={
                  tab === "PENDING"
                    ? "When a production run reaches the approval gate it will appear here with its bound evidence."
                    : "Records stay here as an immutable history of who decided what, and why."
                }
              />
            </Panel>
          )}
        </div>

        <div className="min-w-0">
          <AnimatePresence mode="wait">
            {selected ? (
              <motion.div
                key={selected.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
              >
                <ApprovalDetail
                  approval={selected}
                  currentUserId={me.data?.user.id ?? ""}
                  canDecide={can(permissions, "approvals:decide")}
                />
              </motion.div>
            ) : (
              <Panel key="empty" className="min-h-[320px]">
                <EmptyState
                  icon={<ShieldCheck className="h-5 w-5" />}
                  title="Select an approval"
                  description="Choose a request from the queue to inspect its candidate, evidence and decision controls."
                />
              </Panel>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function QueueCard({
  approval,
  active,
  onSelect,
}: {
  approval: Approval;
  active: boolean;
  onSelect: () => void;
}) {
  const Icon = automationIcon(approval.automation.icon);
  const expired = approval.status === "EXPIRED" || approval.status === "INVALIDATED";
  return (
    <button
      onClick={onSelect}
      className={cn(
        "group relative w-full overflow-hidden rounded-xl border p-3.5 text-left transition",
        active
          ? "border-lime/35 bg-lime/[0.06] shadow-[0_0_0_1px_rgba(214,255,118,0.08)]"
          : "border-white/[0.07] bg-white/[0.015] hover:border-white/15 hover:bg-white/[0.03]",
      )}
    >
      {active ? <span className="absolute inset-y-0 left-0 w-[2px] bg-lime" /> : null}
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-obsidian-900/70">
          <Icon className={cn("h-4 w-4", active ? "text-lime" : "text-ink-muted")} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate text-[13px] font-medium text-ink">{approval.automation.name}</p>
            <StatusPill status={approval.status} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <EnvBadge environment={approval.environment} showMode={false} />
            <span className="text-[10.5px] text-ink-faint">v{approval.automation_version}</span>
            <Badge tone={riskTone(approval.automation.risk_level)} className="px-1.5 py-0 text-[9.5px]">
              {humanize(approval.automation.risk_level)} risk
            </Badge>
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/[0.05] pt-2.5">
        <span className="inline-flex items-center gap-1.5 text-[10.5px] text-ink-faint">
          <Avatar name={approval.requester.full_name} size={18} />
          {approval.requester.full_name}
        </span>
        <span className="inline-flex items-center gap-1 text-[10.5px] text-ink-faint">
          {expired ? <Clock3 className="h-3 w-3" /> : null}
          {relative(approval.created_at)}
          <ArrowUpRight className="h-3 w-3 opacity-0 transition group-hover:opacity-100" />
        </span>
      </div>
    </button>
  );
}

function ApprovalDetail({
  approval,
  currentUserId,
  canDecide,
}: {
  approval: Approval;
  currentUserId: string;
  canDecide: boolean;
}) {
  const decision = useApprovalDecision();
  const liveExecution = useExecution(approval.execution?.id).data;
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [comment, setComment] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isOwnRequest = approval.requested_by === currentUserId;
  const pending = approval.status === "PENDING";
  const scans = approval.evidence.security ?? [];
  const uatKeys = Object.keys(approval.evidence.uat ?? {});
  const versionCurrent = approval.automation_version === approval.automation.current_version;
  const hashMatches = !liveExecution || liveExecution.candidate_hash === approval.candidate_hash;
  const scansPassed = scans.length > 0 && scans.every((scan) => scan.status === "PASSED");
  const ready = versionCurrent && hashMatches && scansPassed && uatKeys.length > 0 && !isOwnRequest;
  const expiresIn = approval.expires_at
    ? Math.max(0, Math.floor((new Date(approval.expires_at).getTime() - Date.now()) / 60000))
    : null;

  const checks = [
    {
      key: "sod",
      label: "Separation of duties",
      pass: !isOwnRequest,
      detail: isOwnRequest
        ? "You requested this run. A different approver must decide."
        : `Requested by ${approval.requester.full_name}. You are an eligible second party.`,
    },
    {
      key: "hash",
      label: "Candidate matches the request",
      pass: hashMatches,
      detail: hashMatches
        ? `Bound to ${shortenHash(approval.candidate_hash, 12)}. The promoted artifact cannot change silently.`
        : "The execution candidate hash no longer matches this approval.",
    },
    {
      key: "version",
      label: "Version still current",
      pass: versionCurrent,
      detail: versionCurrent
        ? `Version ${approval.automation_version} is the published version.`
        : `Version ${approval.automation.current_version} was published after this request was raised.`,
    },
    {
      key: "scans",
      label: "Security evidence passed",
      pass: scansPassed,
      detail: scans.length
        ? scans.map((scan) => `${scan.kind} ${scan.status.toLowerCase()}`).join(" · ")
        : "No security scan evidence is attached to this candidate.",
    },
    {
      key: "uat",
      label: "UAT evidence captured",
      pass: uatKeys.length > 0,
      detail: uatKeys.length
        ? `Recorded: ${uatKeys.map(humanize).join(", ")}.`
        : "The execution has not recorded UAT outputs for this candidate.",
    },
  ];

  async function submit() {
    if (!mode) return;
    setError(null);
    if (comment.trim().length < 4) {
      setError("Add a short decision note (at least 4 characters). It becomes part of the audit record.");
      return;
    }
    try {
      await decision.mutateAsync({ id: approval.id, decision: mode, comment: comment.trim(), reason: reason.trim() });
      toast(
        mode === "approve" ? "Approval recorded" : "Production promotion rejected",
        mode === "approve" ? "success" : "warning",
        mode === "approve"
          ? "The exact candidate will now be promoted. The requester has been notified."
          : "The execution is blocked and the requester has been notified.",
      );
      setMode(null);
      setComment("");
      setReason("");
    } catch (caught) {
      const message = (caught as ApiError).message ?? "The decision could not be recorded.";
      const details = (caught as ApiError).details;
      const detailList = Array.isArray(details) ? details.map(String) : [];
      setError(detailList.length ? `${message} ${detailList.join(" ")}` : message);
      toast("Decision not recorded", "error", message);
    }
  }

  return (
    <div className="space-y-4">
      <Panel className="overflow-hidden">
        <div className="border-b border-white/[0.06] px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={approval.status} />
                <EnvBadge environment={approval.environment} />
                <Badge tone="slate">v{approval.automation_version}</Badge>
              </div>
              <h2 className="mt-3 text-[20px] font-semibold tracking-[-0.025em] text-ink">
                {approval.automation.name}
              </h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-faint">
                <Link
                  href={`/automations/${approval.automation.slug}`}
                  className="inline-flex items-center gap-1 text-ink-muted transition hover:text-lime"
                >
                  Automation guide <ArrowUpRight className="h-3 w-3" />
                </Link>
                {approval.execution ? (
                  <Link
                    href={`/executions/${approval.execution.id}`}
                    className="inline-flex items-center gap-1 text-ink-muted transition hover:text-lime"
                  >
                    Execution {approval.execution.display_id} <ArrowUpRight className="h-3 w-3" />
                  </Link>
                ) : null}
                <span>Requested {formatDate(approval.created_at)}</span>
              </div>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-obsidian-900/50 px-3.5 py-2.5 text-right">
              <p className="text-[9.5px] uppercase tracking-[0.14em] text-ink-faint">Candidate</p>
              <p className="mono mt-1 text-[11.5px] text-ink">{shortenHash(approval.candidate_hash, 14)}</p>
              {pending && expiresIn !== null ? (
                <p
                  className={cn(
                    "mt-1 text-[10px]",
                    expiresIn < 360 ? "text-signal-red" : "text-signal-amber",
                  )}
                >
                  {expiresIn > 0 ? `${Math.floor(expiresIn / 60)}h ${expiresIn % 60}m left` : "Expired"}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="grid gap-0 sm:grid-cols-2">
          <div className="border-b border-white/[0.06] px-5 py-4 sm:border-b-0 sm:border-r sm:px-6">
            <p className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-faint">Requested by</p>
            <div className="mt-2.5 flex items-center gap-2.5">
              <Avatar name={approval.requester.full_name} size={32} />
              <div className="min-w-0">
                <p className="truncate text-[12.5px] font-medium text-ink">{approval.requester.full_name}</p>
                <p className="truncate text-[10.5px] text-ink-faint">{approval.requester.title}</p>
              </div>
            </div>
            {approval.execution?.reason ? (
              <p className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[11.5px] leading-relaxed text-ink-muted">
                &ldquo;{approval.execution.reason}&rdquo;
              </p>
            ) : null}
          </div>
          <div className="px-5 py-4 sm:px-6">
            <p className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
              Decision impact
            </p>
            <p className="mt-2.5 text-[12px] leading-relaxed text-ink-muted">
              {approval.evidence.impact ??
                "Approving promotes the bound candidate to the target production environment."}
            </p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {(approval.evidence.systems_affected ?? []).map((system) => (
                <Badge key={system} tone="slate">
                  {system}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </Panel>

      {pending ? (
        <Panel className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-3.5 sm:px-6">
            <div className="flex items-center gap-2">
              <Fingerprint className="h-4 w-4 text-cyan" />
              <p className="text-[12.5px] font-medium text-ink">Decision readiness</p>
            </div>
            <Badge tone={ready ? "lime" : "amber"} dot>
              {ready ? "Ready for a decision" : "Needs review"}
            </Badge>
          </div>
          <ul className="divide-y divide-white/[0.05]">
            {checks.map((check) => (
              <li key={check.key} className="flex items-start gap-3 px-5 py-3 sm:px-6">
                {check.pass ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-lime" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-signal-red" />
                )}
                <div className="min-w-0">
                  <p className="text-[12px] font-medium text-ink">{check.label}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">{check.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-5 py-3.5">
            <Hash className="h-3.5 w-3.5 text-ink-faint" />
            <p className="text-[12px] font-medium text-ink">Bound candidate</p>
          </div>
          <dl className="space-y-0 divide-y divide-white/[0.05]">
            <FactRow label="Candidate hash">
              <span className="mono inline-flex items-center gap-1.5 text-[11px] text-ink-muted">
                {shortenHash(approval.candidate_hash, 12)}
                <CopyButton value={approval.candidate_hash} />
              </span>
            </FactRow>
            <FactRow label="Workflow version">
              {approval.evidence.candidate?.workflow_version ?? "—"}
            </FactRow>
            <FactRow label="Workflow checksum">
              <span className="mono text-[11px] text-ink-muted">
                {shortenHash(approval.evidence.candidate?.workflow_checksum, 10)}
              </span>
            </FactRow>
            <FactRow label="Server group">
              {approval.evidence.candidate?.server_group ?? approval.execution?.server_group?.name ?? "—"}
            </FactRow>
            <FactRow label="Risk">
              <Badge tone={riskTone(approval.evidence.risk_level ?? approval.automation.risk_level)}>
                {humanize(approval.evidence.risk_level ?? approval.automation.risk_level)}
              </Badge>
            </FactRow>
          </dl>
        </Panel>

        <Panel className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-5 py-3.5">
            <ShieldCheck className="h-3.5 w-3.5 text-ink-faint" />
            <p className="text-[12px] font-medium text-ink">Evidence</p>
          </div>
          <div className="px-5 py-4">
            {scans.length ? (
              <ul className="space-y-2">
                {scans.map((scan) => (
                  <li
                    key={scan.kind}
                    className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2"
                  >
                    <div>
                      <p className="text-[11.5px] font-medium text-ink">{humanize(scan.kind)} scan</p>
                      <p className="text-[10px] text-ink-faint">
                        {scan.findings} finding{scan.findings === 1 ? "" : "s"}
                        {Object.keys(scan.severity_counts ?? {}).length
                          ? ` · ${Object.entries(scan.severity_counts)
                              .map(([severity, count]) => `${severity.toLowerCase()} ${count}`)
                              .join(", ")}`
                          : ""}
                      </p>
                    </div>
                    <StatusPill status={scan.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[11.5px] text-ink-faint">No security scans attached.</p>
            )}

            <p className="mt-4 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-faint">UAT outputs</p>
            {uatKeys.length ? (
              <ul className="mt-2 space-y-1.5">
                {uatKeys.map((key) => {
                  const output = (approval.evidence.uat ?? {})[key] as Record<string, unknown> | null;
                  const status = typeof output?.status === "string" ? output.status : null;
                  return (
                    <li key={key} className="flex items-center justify-between gap-2 text-[11.5px]">
                      <span className="text-ink-muted">{humanize(key)}</span>
                      {status ? <StatusPill status={status} /> : <span className="text-ink-faint">recorded</span>}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-1.5 text-[11.5px] text-ink-faint">No UAT outputs recorded yet.</p>
            )}

            {approval.evidence.what_could_go_wrong ? (
              <div className="mt-4 rounded-lg border border-signal-amber/20 bg-signal-amber/[0.05] px-3 py-2.5">
                <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-signal-amber">
                  <TriangleAlert className="h-3 w-3" /> What could go wrong
                </p>
                <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">
                  {approval.evidence.what_could_go_wrong}
                </p>
              </div>
            ) : null}
          </div>
        </Panel>
      </div>

      {pending ? (
        isOwnRequest ? (
          <Panel className="border-signal-amber/25 bg-signal-amber/[0.04] px-5 py-4">
            <p className="flex items-center gap-2 text-[12.5px] font-medium text-signal-amber">
              <Lock className="h-4 w-4" /> Separation of duties
            </p>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-muted">
              You requested this production run. JUNE will not let you approve your own change — another approver must
              decide. Your request has been routed to everyone with approval rights.
            </p>
          </Panel>
        ) : canDecide ? (
          <Panel className="overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-3.5 sm:px-6">
              <div className="flex items-center gap-2">
                <UserRound className="h-4 w-4 text-lime" />
                <p className="text-[12.5px] font-medium text-ink">Record a decision</p>
              </div>
              <span className="text-[10.5px] text-ink-faint">Signed with your identity</span>
            </div>
            <div className="grid gap-4 px-5 py-4 sm:grid-cols-2 sm:px-6">
              <Field label="Decision note" hint="Required. Stored in the audit record.">
                <Textarea
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="Explain what you verified before deciding."
                  rows={3}
                  className="resize-none"
                />
              </Field>
              <Field label="Reason (optional)" hint="Why this candidate is safe — or why it is being stopped.">
                <Textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="e.g. Verified UAT evidence, change window approved by service owner."
                  rows={3}
                  className="resize-none"
                />
              </Field>
            </div>
            {error ? (
              <p className="mx-5 mb-3 rounded-lg border border-signal-red/25 bg-signal-red/[0.08] px-3 py-2 text-[11.5px] text-signal-red sm:mx-6">
                {error}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] px-5 py-3.5 sm:px-6">
              <p className="max-w-[420px] text-[10.5px] leading-relaxed text-ink-faint">
                Approving promotes exactly this candidate. Rejecting blocks the run and notifies the requester.
              </p>
              <div className="flex items-center gap-2">
                <Button variant="danger" icon={<X className="h-3.5 w-3.5" />} onClick={() => setMode("reject")}>
                  Reject
                </Button>
                <Button
                  variant="primary"
                  icon={<Check className="h-4 w-4" />}
                  onClick={() => setMode("approve")}
                  disabled={!ready}
                >
                  Approve candidate
                </Button>
              </div>
            </div>
            {!ready ? (
              <p className="border-t border-white/[0.06] bg-signal-amber/[0.04] px-5 py-2.5 text-[10.5px] text-signal-amber sm:px-6">
                Resolve the readiness checks above before approving. You can always reject with a note.
              </p>
            ) : null}
          </Panel>
        ) : (
          <Panel className="border-white/[0.07] px-5 py-4">
            <p className="flex items-center gap-2 text-[12.5px] font-medium text-ink">
              <ShieldCheck className="h-4 w-4 text-cyan" /> Review only
            </p>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-muted">
              Your role can inspect approval evidence but not decide production promotions. Ask an approver to review
              this request, or open Administration to see role boundaries.
            </p>
          </Panel>
        )
      ) : (
        <Panel className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-5 py-3.5 sm:px-6">
            <Clock3 className="h-4 w-4 text-ink-faint" />
            <p className="text-[12.5px] font-medium text-ink">Decision record</p>
            <StatusPill status={approval.status} className="ml-auto" />
          </div>
          <div className="grid gap-4 px-5 py-4 sm:grid-cols-3 sm:px-6">
            <div>
              <p className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-faint">Decided by</p>
              {approval.decider ? (
                <div className="mt-2 flex items-center gap-2">
                  <Avatar name={approval.decider.full_name} size={26} />
                  <div>
                    <p className="text-[11.5px] font-medium text-ink">{approval.decider.full_name}</p>
                    <p className="text-[10px] text-ink-faint">{approval.decider.title}</p>
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-[11.5px] text-ink-faint">No human decision recorded.</p>
              )}
            </div>
            <div>
              <p className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-faint">Decided at</p>
              <p className="mt-2 text-[11.5px] text-ink-muted">{formatDate(approval.decided_at)}</p>
            </div>
            <div>
              <p className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-faint">Outcome</p>
              <p className={cn("mt-2 text-[11.5px]", toneClasses[statusTone(approval.status)].text)}>
                {statusLabel(approval.status)}
              </p>
            </div>
          </div>
          {approval.comment ? (
            <p className="mx-5 mb-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[11.5px] leading-relaxed text-ink-muted sm:mx-6">
              {approval.comment}
            </p>
          ) : null}
          {approval.decision_reason ? (
            <p className="mx-5 mb-4 text-[11px] leading-relaxed text-ink-faint sm:mx-6">
              Reason: {approval.decision_reason}
            </p>
          ) : null}
        </Panel>
      )}

      <p className="px-1 text-[10.5px] leading-relaxed text-ink-faint">
        Approvals are bound to the candidate hash and the published automation version. Publishing a new version or
        changing the candidate automatically invalidates any pending request.
      </p>

      <Modal
        open={mode !== null}
        onClose={() => {
          if (!decision.isPending) setMode(null);
        }}
        title={mode === "approve" ? "Approve this production promotion?" : "Reject this production promotion?"}
        description={
          mode === "approve"
            ? "You are acting as the second human. The exact bound candidate will be promoted after this decision."
            : "The run will be blocked, the requester notified, and the reason preserved in the Chronicle."
        }
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setMode(null)} disabled={decision.isPending}>
              Cancel
            </Button>
            {mode === "approve" ? (
              <Button
                variant="primary"
                icon={<Check className="h-4 w-4" />}
                loading={decision.isPending}
                onClick={() => void submit()}
              >
                Confirm approval
              </Button>
            ) : (
              <Button
                variant="danger"
                icon={<X className="h-4 w-4" />}
                loading={decision.isPending}
                onClick={() => void submit()}
              >
                Confirm rejection
              </Button>
            )}
          </>
        }
      >
        <div className="rounded-xl border border-white/[0.08] bg-obsidian-900/60 px-4 py-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] font-medium text-ink">{approval.automation.name}</p>
            <EnvBadge environment={approval.environment} />
          </div>
          <dl className="mt-3 space-y-1.5 text-[11.5px]">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-ink-faint">Candidate</dt>
              <dd className="mono text-ink-muted">{shortenHash(approval.candidate_hash, 12)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-ink-faint">Version</dt>
              <dd className="text-ink-muted">{approval.automation_version}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-ink-faint">Requester</dt>
              <dd className="text-ink-muted">{approval.requester.full_name}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-ink-faint">Your note</dt>
              <dd className="max-w-[260px] truncate text-ink-muted">{comment || "—"}</dd>
            </div>
          </dl>
        </div>
        <p className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-ink-faint">
          <Fingerprint className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan" />
          JUNE records your identity, the candidate hash and the moment of decision in a hash-linked audit chain.
        </p>
        {error ? (
          <p className="mt-3 rounded-lg border border-signal-red/25 bg-signal-red/[0.08] px-3 py-2 text-[11.5px] text-signal-red">
            {error}
          </p>
        ) : null}
      </Modal>
    </div>
  );
}

function FactRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-2.5">
      <dt className="text-[11px] text-ink-faint">{label}</dt>
      <dd className="text-right text-[11.5px] text-ink-muted">{children}</dd>
    </div>
  );
}
