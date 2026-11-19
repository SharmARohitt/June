"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  FileWarning,
  Fingerprint,
  FlaskConical,
  Play,
  RefreshCw,
  ScanLine,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";

import { PageHeader } from "@/components/shell/page-header";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Modal,
  Panel,
  Select,
  Skeleton,
  StatusPill,
  Tabs,
  useBeginner,
} from "@/components/ui/primitives";
import { ApiError } from "@/lib/api";
import {
  useAllAutomations,
  useFindings,
  useMe,
  usePolicies,
  useRunScan,
  useScans,
  useSecuritySummary,
} from "@/lib/hooks";
import { can } from "@/lib/nav";
import { toast } from "@/lib/stores";
import type { Finding, Policy, Scan } from "@/lib/types";
import {
  automationIcon,
  cn,
  formatDate,
  humanize,
  relative,
  statusTone,
  toneClasses,
} from "@/lib/utils";

const SEVERITIES = ["ALL", "CRITICAL", "HIGH", "MEDIUM", "LOW"];
const FINDING_STATUSES = ["ALL", "OPEN", "FIXED", "ACCEPTED"];

function severityTone(severity: string) {
  switch (severity) {
    case "CRITICAL":
      return "red" as const;
    case "HIGH":
      return "amber" as const;
    case "MEDIUM":
      return "violet" as const;
    default:
      return "slate" as const;
  }
}

export default function SecurityPage() {
  const me = useMe();
  const summary = useSecuritySummary();
  const scans = useScans(60);
  const policies = usePolicies();
  const beginner = useBeginner();
  const [tab, setTab] = useState("FINDINGS");
  const [severity, setSeverity] = useState("ALL");
  const [findingStatus, setFindingStatus] = useState("ALL");
  const findings = useFindings({
    severity: severity === "ALL" ? undefined : severity,
    status: findingStatus === "ALL" ? undefined : findingStatus,
  });
  const [scanOpen, setScanOpen] = useState(false);

  const permissions = me.data?.user.permissions ?? [];
  const canScan = can(permissions, "security:run");
  const data = summary.data;
  const openFindings = data?.open_findings ?? {};

  const counts = {
    FINDINGS: findings.data?.total ?? 0,
    SCANS: scans.data?.total ?? 0,
    POLICIES: policies.data?.length ?? 0,
  };

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 pb-16 pt-7 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Governance"
        title="Security & Evidence"
        description="JUNE scans the published package before a candidate can progress. Findings, scan evidence and the policies that gate execution are shown exactly as the engine recorded them."
        meta={
          <>
            <Badge tone={data?.total_open ? "amber" : "lime"} dot>
              {data?.total_open ?? 0} open findings
            </Badge>
            <Badge tone="cyan">{data?.scans_total ?? 0} scans recorded</Badge>
            {data?.executions_blocked ? (
              <Badge tone="red">{data.executions_blocked} executions blocked</Badge>
            ) : null}
          </>
        }
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={() => {
                void summary.refetch();
                void scans.refetch();
                void findings.refetch();
              }}
              loading={summary.isFetching || scans.isFetching}
            >
              Refresh
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<ScanLine className="h-3.5 w-3.5" />}
              onClick={() => setScanOpen(true)}
              disabled={!canScan}
              title={!canScan ? "Your role cannot start security scans." : undefined}
            >
              Run a scan
            </Button>
          </>
        }
      />

      {beginner ? (
        <Panel className="mt-5 border-cyan/20 bg-cyan/[0.04] px-5 py-4">
          <p className="text-[12.5px] leading-relaxed text-ink-muted">
            <span className="font-medium text-ink">How this works: </span>
            Every run performs a secret scan and a dependency policy check before deployment. A blocking finding stops
            the run before anything changes — JUNE does not report a failure as a pass.
          </p>
        </Panel>
      ) : null}

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MetricTile
          label="Critical open"
          value={openFindings.CRITICAL ?? 0}
          tone="red"
          icon={<ShieldAlert className="h-4 w-4" />}
          loading={summary.isLoading}
        />
        <MetricTile
          label="High open"
          value={openFindings.HIGH ?? 0}
          tone="amber"
          icon={<TriangleAlert className="h-4 w-4" />}
          loading={summary.isLoading}
        />
        <MetricTile
          label="Total open"
          value={data?.total_open ?? 0}
          tone="cyan"
          icon={<FileWarning className="h-4 w-4" />}
          loading={summary.isLoading}
        />
        <MetricTile
          label="Failed scans"
          value={data?.scans_failed ?? 0}
          tone="violet"
          icon={<XCircle className="h-4 w-4" />}
          loading={summary.isLoading}
        />
        <MetricTile
          label="Runs blocked"
          value={data?.executions_blocked ?? 0}
          tone="slate"
          icon={<Ban className="h-4 w-4" />}
          loading={summary.isLoading}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Panel className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-3.5">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-lime" />
              <p className="text-[12.5px] font-medium text-ink">Scanner coverage</p>
            </div>
            <Badge tone={data?.scanner_coverage.external_vulnerability_db ? "lime" : "amber"} dot>
              {data?.scanner_coverage.external_vulnerability_db ? "Full coverage" : "Coverage gap"}
            </Badge>
          </div>
          <div className="grid gap-3 px-5 py-4 sm:grid-cols-3">
            <CoverageItem
              active={data?.scanner_coverage.built_in_secret_rules ?? true}
              title="Built-in secret rules"
              detail="Scans the published package for plaintext credentials and unsafe secret handling."
            />
            <CoverageItem
              active={data?.scanner_coverage.built_in_dependency_policy ?? true}
              title="Dependency policy"
              detail="Checks declared dependencies against the JUNE allowlist policy."
            />
            <CoverageItem
              active={data?.scanner_coverage.external_vulnerability_db ?? false}
              title="External vulnerability DB"
              detail="Not configured. Requires Trivy/Grype or an enterprise scanner integration."
              warning
            />
          </div>
          {data?.scanner_coverage.note ? (
            <p className="border-t border-white/[0.06] px-5 py-2.5 text-[10.5px] leading-relaxed text-ink-faint">
              {data.scanner_coverage.note}
            </p>
          ) : null}
        </Panel>

        <Panel className="px-5 py-4">
          <div className="flex items-center gap-2">
            <Fingerprint className="h-4 w-4 text-cyan" />
            <p className="text-[12.5px] font-medium text-ink">Built-in scanners</p>
          </div>
          <ul className="mt-3 space-y-2 text-[11.5px] leading-relaxed text-ink-muted">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lime" />
              <span>
                <span className="mono text-[10.5px] text-ink">june-secret-rules</span> — package-level secret detection
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lime" />
              <span>
                <span className="mono text-[10.5px] text-ink">june-dependency-policy</span> — allowlist verification
              </span>
            </li>
          </ul>
          <p className="mt-3 border-t border-white/[0.06] pt-3 text-[10.5px] leading-relaxed text-ink-faint">
            Scans run automatically as a stage in every execution and can be triggered manually for the current
            published version.
          </p>
        </Panel>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { key: "FINDINGS", label: "Findings", count: counts.FINDINGS },
            { key: "SCANS", label: "Scans", count: counts.SCANS },
            { key: "POLICIES", label: "Policies", count: counts.POLICIES },
          ]}
        />
        {tab === "FINDINGS" ? (
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={severity}
              onChange={(event) => setSeverity(event.target.value)}
              className="h-8 w-[140px] text-[12px]"
            >
              {SEVERITIES.map((entry) => (
                <option key={entry} value={entry}>
                  {entry === "ALL" ? "All severities" : humanize(entry)}
                </option>
              ))}
            </Select>
            <Select
              value={findingStatus}
              onChange={(event) => setFindingStatus(event.target.value)}
              className="h-8 w-[130px] text-[12px]"
            >
              {FINDING_STATUSES.map((entry) => (
                <option key={entry} value={entry}>
                  {entry === "ALL" ? "All statuses" : humanize(entry)}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>

      <div className="mt-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {tab === "FINDINGS" ? (
              <FindingsList findings={findings.data?.items ?? []} loading={findings.isLoading} />
            ) : tab === "SCANS" ? (
              <ScansList scans={scans.data?.items ?? []} loading={scans.isLoading} />
            ) : (
              <PoliciesGrid policies={policies.data ?? []} loading={policies.isLoading} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <p className="mt-5 text-[10.5px] leading-relaxed text-ink-faint">
        Findings and scan results are read directly from the engine. JUNE does not fabricate a clean bill of health:
        coverage gaps and blocking findings are always visible.
      </p>

      <RunScanModal open={scanOpen} onClose={() => setScanOpen(false)} />
    </div>
  );
}

function MetricTile({
  label,
  value,
  tone,
  icon,
  loading,
}: {
  label: string;
  value: number;
  tone: "red" | "amber" | "cyan" | "violet" | "slate";
  icon: React.ReactNode;
  loading?: boolean;
}) {
  const palette = toneClasses[tone];
  return (
    <Panel className="px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-faint">{label}</p>
        <span className={cn("flex h-7 w-7 items-center justify-center rounded-lg border", palette.border, palette.bg, palette.text)}>
          {icon}
        </span>
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-12" />
      ) : (
        <p className={cn("kpi-value mt-1.5 text-[26px] font-semibold leading-none", value ? palette.text : "text-ink")}>
          {value}
        </p>
      )}
    </Panel>
  );
}

function CoverageItem({
  active,
  title,
  detail,
  warning,
}: {
  active: boolean;
  title: string;
  detail: string;
  warning?: boolean;
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11.5px] font-medium text-ink">{title}</p>
        {active ? (
          <Badge tone="lime" dot>
            Active
          </Badge>
        ) : (
          <Badge tone={warning ? "amber" : "slate"} dot>
            Not configured
          </Badge>
        )}
      </div>
      <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-faint">{detail}</p>
    </div>
  );
}

function FindingsList({ findings, loading }: { findings: Finding[]; loading: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (loading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} className="h-[64px] w-full" />
        ))}
      </div>
    );
  }
  if (!findings.length) {
    return (
      <Panel>
        <EmptyState
          icon={<CheckCircle2 className="h-5 w-5" />}
          title="No findings match these filters"
          description="Either the package is clean for this severity, or the filters are narrower than the records."
        />
      </Panel>
    );
  }
  return (
    <Panel className="overflow-hidden">
      <ul className="divide-y divide-white/[0.05]">
        {findings.map((finding) => {
          const open = openId === finding.id;
          return (
            <li key={finding.id}>
              <button
                onClick={() => setOpenId(open ? null : finding.id)}
                className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-white/[0.02] sm:px-5"
              >
                <span className="mt-0.5">
                  <Badge tone={severityTone(finding.severity)} dot>
                    {humanize(finding.severity)}
                  </Badge>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[12.5px] font-medium text-ink">{finding.title}</p>
                    <Badge tone={statusTone(finding.status)}>{humanize(finding.status)}</Badge>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-ink-faint">
                    {finding.rule_id ? <span className="mono">{finding.rule_id}</span> : null}
                    {finding.file_path ? (
                      <span className="mono">
                        {" "}
                        · {finding.file_path}
                        {finding.line_number ? `:${finding.line_number}` : ""}
                      </span>
                    ) : null}
                  </p>
                </div>
                <ChevronDown
                  className={cn("mt-1 h-4 w-4 shrink-0 text-ink-faint transition", open && "rotate-180")}
                />
              </button>
              <AnimatePresence initial={false}>
                {open ? (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-2.5 px-4 pb-4 pl-[92px] pr-5 sm:px-5 sm:pl-[100px]">
                      <p className="text-[11.5px] leading-relaxed text-ink-muted">{finding.description}</p>
                      <div className="rounded-lg border border-cyan/20 bg-cyan/[0.04] px-3 py-2.5">
                        <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-cyan">Remediation</p>
                        <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">{finding.remediation}</p>
                      </div>
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function ScansList({ scans, loading }: { scans: Scan[]; loading: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (loading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} className="h-[72px] w-full" />
        ))}
      </div>
    );
  }
  if (!scans.length) {
    return (
      <Panel>
        <EmptyState
          icon={<ScanLine className="h-5 w-5" />}
          title="No scans recorded yet"
          description="Run a scan or execute an automation to produce real security evidence."
        />
      </Panel>
    );
  }
  return (
    <Panel className="overflow-hidden">
      <ul className="divide-y divide-white/[0.05]">
        {scans.map((scan) => {
          const Icon = automationIcon(scan.automation.icon);
          const open = openId === scan.id;
          return (
            <li key={scan.id}>
              <button
                onClick={() => setOpenId(open ? null : scan.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/[0.02] sm:px-5"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-obsidian-900/60">
                  <Icon className="h-3.5 w-3.5 text-ink-muted" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-[12.5px] font-medium text-ink">{scan.automation.name}</p>
                    <Badge tone="slate">{humanize(scan.kind)}</Badge>
                    <StatusPill status={scan.status} />
                  </div>
                  <p className="mt-0.5 truncate text-[10.5px] text-ink-faint">
                    v{scan.automation_version} · {scan.scanner} · {scan.findings.length} finding
                    {scan.findings.length === 1 ? "" : "s"} · {relative(scan.created_at)}
                    {scan.artifact_path ? " · artifact attached" : ""}
                  </p>
                </div>
                <ChevronDown
                  className={cn("h-4 w-4 shrink-0 text-ink-faint transition", open && "rotate-180")}
                />
              </button>
              <AnimatePresence initial={false}>
                {open ? (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-2 px-4 pb-4 sm:px-5">
                      <div className="flex flex-wrap items-center gap-2 text-[10.5px] text-ink-faint">
                        <span>Started {formatDate(scan.started_at)}</span>
                        <span>·</span>
                        <span>Finished {formatDate(scan.finished_at)}</span>
                        {scan.artifact_path ? (
                          <>
                            <span>·</span>
                            <span className="mono truncate">{scan.artifact_path}</span>
                          </>
                        ) : null}
                      </div>
                      {scan.findings.length ? (
                        <ul className="space-y-1.5">
                          {scan.findings.map((finding) => (
                            <li
                              key={finding.id}
                              className="flex items-start gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2"
                            >
                              <Badge tone={severityTone(finding.severity)} dot className="mt-0.5">
                                {humanize(finding.severity)}
                              </Badge>
                              <div className="min-w-0">
                                <p className="text-[11.5px] text-ink-muted">{finding.title}</p>
                                {finding.rule_id ? (
                                  <p className="mono text-[9.5px] text-ink-faint">
                                    {finding.rule_id}
                                    {finding.file_path ? ` · ${finding.file_path}` : ""}
                                  </p>
                                ) : null}
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="flex items-center gap-1.5 text-[11.5px] text-lime">
                          <CheckCircle2 className="h-3.5 w-3.5" /> This scan passed with no findings.
                        </p>
                      )}
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function PoliciesGrid({ policies, loading }: { policies: Policy[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="grid gap-3 md:grid-cols-2">
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} className="h-[150px] w-full" />
        ))}
      </div>
    );
  }
  if (!policies.length) {
    return (
      <Panel>
        <EmptyState
          icon={<ShieldCheck className="h-5 w-5" />}
          title="No policies are loaded"
          description="Policies are seeded with the platform. An empty list means the policy engine has not been initialised."
        />
      </Panel>
    );
  }
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {policies.map((policy) => (
        <Panel key={policy.id} hover className="px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[12.5px] font-medium text-ink">{policy.name}</p>
              <p className="mono mt-0.5 text-[10px] text-ink-faint">{policy.key}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Badge tone={policy.severity === "BLOCK" ? "red" : "amber"} dot>
                {humanize(policy.severity)}
              </Badge>
              <Badge tone={policy.is_active ? "lime" : "slate"}>{policy.is_active ? "Active" : "Inactive"}</Badge>
            </div>
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-ink-muted">{policy.description}</p>
          <div className="mt-3 rounded-lg border border-white/[0.06] bg-obsidian-900/50 px-3 py-2">
            <p className="flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
              <Sparkles className="h-3 w-3" /> Rules
            </p>
            <dl className="mt-1.5 space-y-1">
              {Object.entries(policy.rules).map(([key, value]) => (
                <div key={key} className="flex items-start justify-between gap-3 text-[10.5px]">
                  <dt className="mono text-ink-faint">{key}</dt>
                  <dd className="max-w-[230px] truncate text-right text-ink-muted" title={String(value)}>
                    {Array.isArray(value) ? value.join(", ") : String(value)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          <p className="mt-2.5 text-[10px] text-ink-faint">
            {humanize(policy.mode)} · applies to {policy.applies_to.toLowerCase()} · v{policy.version}
          </p>
        </Panel>
      ))}
    </div>
  );
}

function RunScanModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const automations = useAllAutomations();
  const runScan = useRunScan();
  const [automationId, setAutomationId] = useState("");

  const items = automations.data?.items ?? [];
  const selected = items.find((item) => item.id === automationId);

  async function submit() {
    if (!automationId) return;
    try {
      const scans = await runScan.mutateAsync(automationId);
      const findings = scans.reduce((total, scan) => total + scan.findings.length, 0);
      const failed = scans.filter((scan) => scan.status !== "PASSED").length;
      toast(
        failed ? "Scan completed with findings" : "Scans passed",
        failed ? "warning" : "success",
        failed
          ? `${failed} of ${scans.length} scans reported findings. Review them before promoting a candidate.`
          : `${scans.length} scans passed with ${findings} finding${findings === 1 ? "" : "s"}.`,
      );
      onClose();
    } catch (caught) {
      toast("Scan could not run", "error", (caught as ApiError).message ?? "The scanner rejected the request.");
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!runScan.isPending) onClose();
      }}
      title="Run security scans"
      description="Scans the current published version of an automation with the built-in secret and dependency scanners."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={runScan.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={<Play className="h-4 w-4" />}
            loading={runScan.isPending}
            disabled={!automationId}
            onClick={() => void submit()}
          >
            Start scan
          </Button>
        </>
      }
    >
      <Field label="Automation" hint="The published version at the moment you start the scan is inspected.">
        <Select value={automationId} onChange={(event) => setAutomationId(event.target.value)}>
          <option value="">Select an automation…</option>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · v{item.current_version}
            </option>
          ))}
        </Select>
      </Field>
      {selected ? (
        <div className="mt-3 rounded-lg border border-white/[0.07] bg-obsidian-900/50 px-3.5 py-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] font-medium text-ink">{selected.name}</p>
            <Badge tone="slate">v{selected.current_version}</Badge>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">{selected.summary}</p>
        </div>
      ) : null}
      <ul className="mt-3 space-y-1.5 text-[11px] text-ink-faint">
        <li className="flex items-center gap-1.5">
          <FlaskConical className="h-3 w-3" /> Secret rules scan the published package files.
        </li>
        <li className="flex items-center gap-1.5">
          <FlaskConical className="h-3 w-3" /> Dependency policy checks declared packages against the allowlist.
        </li>
        <li className="flex items-center gap-1.5">
          <Fingerprint className="h-3 w-3" /> Results are hash-referenced and written to the Chronicle.
        </li>
      </ul>
    </Modal>
  );
}
