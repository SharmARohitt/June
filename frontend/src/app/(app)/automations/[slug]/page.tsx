"use client";

import { motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Boxes,
  CircleHelp,
  Clock3,
  Compass,
  FileJson,
  FolderGit2,
  GitBranch,
  Layers,
  Lock,
  Package,
  Play,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  UserRound,
  Workflow as WorkflowIcon,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { EnvBadge } from "@/components/domain/env-badge";
import { ExecutionRow } from "@/components/domain/execution-row";
import { RunWizard } from "@/components/domain/run-wizard";
import {
  Badge,
  Button,
  CopyButton,
  EmptyState,
  Panel,
  Skeleton,
  Tabs,
  useBeginner,
} from "@/components/ui/primitives";
import { useAutomation, useEnvironments, useExecutions } from "@/lib/hooks";
import {
  automationIcon,
  cn,
  formatDate,
  pct,
  relative,
  riskCopy,
  riskTone,
  shortenHash,
  stageIcon,
} from "@/lib/utils";
import type { AutomationDetail } from "@/lib/types";

const tabs = [
  { key: "guide", label: "Guide", icon: <BookOpen className="h-3.5 w-3.5" /> },
  { key: "inputs", label: "Inputs", icon: <FileJson className="h-3.5 w-3.5" /> },
  { key: "pipeline", label: "Pipeline", icon: <GitBranch className="h-3.5 w-3.5" /> },
  { key: "versions", label: "Versions", icon: <Layers className="h-3.5 w-3.5" /> },
];

export default function AutomationDetailPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const beginner = useBeginner();
  const automation = useAutomation(params.slug);
  const environments = useEnvironments();
  const [tab, setTab] = useState("guide");
  const [wizardOpen, setWizardOpen] = useState(false);
  const data = automation.data;

  const recent = useExecutions(
    { automation_id: data?.id, page_size: 5 },
    Boolean(data?.id),
  );

  const supportedEnvs = useMemo(
    () => (environments.data ?? []).filter((env) => data?.supported_environments.includes(env.key)),
    [environments.data, data?.supported_environments],
  );

  if (automation.isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-[190px]" />
        <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
          <Skeleton className="h-[420px]" />
          <Skeleton className="h-[420px]" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <Panel className="p-8">
        <EmptyState
          icon={<XCircle className="h-5 w-5" />}
          title="Automation not found"
          description="It may have been archived or removed. The registry only shows automations your role can read."
          action={
            <Button variant="secondary" onClick={() => router.push("/automations")}>
              Back to automations
            </Button>
          }
        />
      </Panel>
    );
  }

  const Icon = automationIcon(data.icon);
  const workflow = data.workflow;
  const workflowVersion = workflow?.versions[0];
  const nodes = [...(workflowVersion?.definition.nodes ?? [])].sort(
    (a, b) => a.position.y - b.position.y || a.position.x - b.position.x,
  );

  return (
    <div className="space-y-5">
      <Link
        href="/automations"
        className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-ink-faint transition hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Automation registry
      </Link>

      <Panel className="relative overflow-hidden p-0">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 grid-surface opacity-30" />
          <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-lime/[0.07] blur-[100px]" />
        </div>
        <div className="relative p-6">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/[0.1] bg-gradient-to-br from-white/[0.09] to-white/[0.01] text-lime shadow-inset">
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="truncate text-[24px] font-semibold tracking-[-0.03em] text-ink">{data.name}</h1>
                    <Badge tone={riskTone(data.risk_level)}>{data.risk_level}</Badge>
                    {data.is_sample ? (
                      <span className="rounded-full border border-cyan/20 bg-cyan/[0.07] px-2 py-0.5 text-[9.5px] font-medium uppercase tracking-[0.1em] text-cyan">
                        sample
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-[12px] text-ink-faint">
                    {data.category} · {data.current_version} · {data.runner_key}
                  </p>
                </div>
              </div>
              <p className="mt-4 max-w-3xl text-[14px] leading-relaxed text-ink-muted">{data.summary}</p>

              <div className="mt-4 flex flex-wrap items-center gap-3 text-[11px] text-ink-faint">
                {supportedEnvs.map((env) => (
                  <EnvBadge key={env.id} environment={env} />
                ))}
                {!supportedEnvs.length && !environments.isLoading
                  ? data.supported_environments.map((env) => (
                      <span key={env} className="chip text-[10px]">
                        {env}
                      </span>
                    ))
                  : null}
                <span className="h-3 w-px bg-white/10" />
                <span className="inline-flex items-center gap-1.5">
                  <Clock3 className="h-3 w-3" />
                  {data.execution_count ? `${data.execution_count} runs · ${pct(data.success_rate)} success` : "Never run"}
                </span>
                {data.owner ? (
                  <>
                    <span className="h-3 w-px bg-white/10" />
                    <span className="inline-flex items-center gap-1.5">
                      <UserRound className="h-3 w-3" />
                      {data.owner.full_name}
                      {data.team_name ? ` · ${data.team_name}` : ""}
                    </span>
                  </>
                ) : null}
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={() => router.push(`/executions?automation=${data.id}`)}>
                Executions
              </Button>
              <Button
                variant="primary"
                size="lg"
                icon={<Play className="h-4 w-4" />}
                onClick={() => setWizardOpen(true)}
              >
                Run this automation
              </Button>
            </div>
          </div>

          {beginner ? (
            <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-cyan/15 bg-cyan/[0.04] px-3.5 py-2.5">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan" />
              <p className="text-[11.5px] leading-relaxed text-ink-muted">
                Read the <button onClick={() => setTab("guide")} className="font-medium text-cyan hover:underline">Guide</button>{" "}
                first. When you run it, JUNE shows the environment, the inputs, and every safety check before
                anything starts.
              </p>
            </div>
          ) : null}
        </div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.62fr)_minmax(300px,1fr)]">
        <div className="min-w-0 space-y-5">
          <div className="flex items-center justify-between gap-3">
            <Tabs tabs={tabs} value={tab} onChange={setTab} />
            {workflow ? (
              <Link
                href={`/studio?workflow=${workflow.id}`}
                className="hidden items-center gap-1 text-[11px] font-medium text-ink-muted transition hover:text-lime sm:inline-flex"
              >
                <WorkflowIcon className="h-3.5 w-3.5" />
                Open in Studio
              </Link>
            ) : null}
          </div>

          {tab === "guide" ? <GuideTab automation={data} /> : null}
          {tab === "inputs" ? <InputsTab automation={data} /> : null}
          {tab === "pipeline" ? (
            <Panel className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[13px] font-semibold text-ink">Published pipeline</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
                    These stages run in order. The approval gate is bound to the exact candidate hash, not a person.
                  </p>
                </div>
                {workflowVersion ? (
                  <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-right">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">Version</p>
                    <p className="text-[12px] font-medium text-ink">
                      v{workflowVersion.version} · {workflowVersion.status}
                    </p>
                    <p className="mono text-[9.5px] text-ink-faint">{shortenHash(workflowVersion.checksum, 12)}</p>
                  </div>
                ) : null}
              </div>

              <ol className="relative mt-6 space-y-1.5">
                {nodes.length ? (
                  nodes.map((node, index) => {
                    const StageIcon = stageIcon(node.stage_key);
                    const isGate = node.stage_key === "approval_gate";
                    return (
                      <li key={node.id} className="relative flex gap-4">
                        <div className="flex flex-col items-center">
                          <span
                            className={cn(
                              "relative z-10 flex h-8 w-8 items-center justify-center rounded-lg border",
                              isGate
                                ? "border-signal-amber/30 bg-signal-amber/10 text-signal-amber"
                                : "border-white/[0.08] bg-white/[0.03] text-ink-muted",
                            )}
                          >
                            <StageIcon className="h-3.5 w-3.5" />
                          </span>
                          {index < nodes.length - 1 ? (
                            <span className="my-1 h-8 w-px bg-gradient-to-b from-white/15 to-white/5" />
                          ) : null}
                        </div>
                        <div className="min-w-0 flex-1 pb-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-[12.5px] font-medium text-ink">{node.label}</p>
                            <span className="mono text-[9.5px] text-ink-faint">{node.stage_key}</span>
                          </div>
                          <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-muted">
                            {node.description || "No stage description was provided."}
                          </p>
                        </div>
                      </li>
                    );
                  })
                ) : (
                  <li className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-5 text-[12px] text-ink-muted">
                    No published pipeline is available. A platform administrator must publish one in Pipeline Studio
                    before this automation can run.
                  </li>
                )}
              </ol>

              {workflow ? (
                <div className="mt-4 flex items-center justify-between border-t border-white/[0.06] pt-4">
                  <span className="text-[11px] text-ink-faint">
                    {workflow.name} · default workflow · {nodes.length} stages
                  </span>
                  <Link
                    href={`/studio?workflow=${workflow.id}`}
                    className="inline-flex items-center gap-1 text-[11.5px] font-medium text-cyan hover:text-cyan/80"
                  >
                    Inspect in Pipeline Studio
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              ) : null}
            </Panel>
          ) : null}
          {tab === "versions" ? <VersionsTab automation={data} /> : null}
        </div>

        <div className="min-w-0 space-y-5">
          <Panel className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-semibold text-ink">Run readiness</p>
              <Badge tone={data.approval_required ? "amber" : "lime"} dot>
                {data.approval_required ? "Approval required" : "Direct run"}
              </Badge>
            </div>
            <dl className="mt-4 space-y-2.5 text-[12px]">
              <ReadyRow label="Execution runner" value={data.runner_key} mono />
              <ReadyRow label="Timeout" value={`${data.timeout_seconds}s`} />
              <ReadyRow label="Concurrency limit" value={String(data.concurrency_limit)} />
              <ReadyRow label="Language" value={data.language} />
              <ReadyRow label="Last run" value={data.last_execution_at ? relative(data.last_execution_at) : "Never"} />
              <ReadyRow label="Version" value={data.current_version} mono />
            </dl>

            <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                Environment policy
              </p>
              <div className="mt-2 space-y-2">
                {supportedEnvs.length ? (
                  supportedEnvs.map((env) => (
                    <div key={env.id} className="flex items-center justify-between gap-2">
                      <EnvBadge environment={env} showMode={false} />
                      <span className="text-[10.5px] text-ink-faint">
                        {env.kind === "PRODUCTION" || env.approval_required ? "approval" : "direct"}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-[11px] text-ink-faint">No active supported environment.</p>
                )}
              </div>
            </div>

            <Button
              variant="outline"
              className="mt-4 w-full justify-center"
              icon={<Play className="h-4 w-4" />}
              onClick={() => setWizardOpen(true)}
            >
              Start a governed run
            </Button>
          </Panel>

          <Panel className="p-5">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-signal-amber" />
              <p className="text-[13px] font-semibold text-ink">What could go wrong</p>
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">{data.what_could_go_wrong}</p>
            <div className="mt-3 rounded-lg border border-signal-amber/20 bg-signal-amber/[0.05] px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-signal-amber">If it fails</p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">{data.failure_guidance}</p>
            </div>
          </Panel>

          <Panel className="p-5">
            <p className="text-[13px] font-semibold text-ink">Blast radius</p>
            <p className="mt-1 text-[11.5px] text-ink-muted">{riskCopy[data.risk_level]}</p>
            <div className="mt-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                Systems affected
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {data.systems_affected.length ? (
                  data.systems_affected.map((system) => (
                    <span key={system} className="chip text-[10.5px] text-ink-muted">
                      <Boxes className="h-2.5 w-2.5 text-ink-faint" />
                      {system}
                    </span>
                  ))
                ) : (
                  <span className="text-[11px] text-ink-faint">No systems declared.</span>
                )}
              </div>
            </div>
            <div className="mt-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                Required permissions
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {data.required_permissions.length ? (
                  data.required_permissions.map((permission) => (
                    <span key={permission} className="mono chip text-[9.5px] text-ink-muted">
                      {permission}
                    </span>
                  ))
                ) : (
                  <span className="text-[11px] text-ink-faint">No elevated permissions declared.</span>
                )}
              </div>
            </div>
          </Panel>

          <Panel className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
              <p className="text-[12.5px] font-semibold text-ink">Recent runs</p>
              <Link href="/executions" className="text-[10.5px] font-medium text-ink-faint hover:text-lime">
                All
              </Link>
            </div>
            <div className="p-2">
              {(recent.data?.items ?? []).length ? (
                (recent.data?.items ?? []).slice(0, 4).map((execution) => (
                  <ExecutionRow key={execution.id} execution={execution} compact />
                ))
              ) : (
                <p className="px-3 py-6 text-center text-[11.5px] text-ink-faint">
                  No runs yet. The first execution will appear here with its full evidence.
                </p>
              )}
            </div>
          </Panel>
        </div>
      </div>

      <RunWizard
        automation={data}
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onSubmitted={(execution) => {
          setWizardOpen(false);
          router.push(`/executions/${execution.id}`);
        }}
      />
    </div>
  );
}

function GuideTab({ automation }: { automation: AutomationDetail }) {
  const sections = [
    {
      key: "does",
      icon: Compass,
      title: "What it does",
      body: automation.what_it_does,
      tone: "lime" as const,
    },
    {
      key: "why",
      icon: CircleHelp,
      title: "Why it exists",
      body: automation.why_it_exists,
      tone: "cyan" as const,
    },
    {
      key: "when",
      icon: Clock3,
      title: "When to use it",
      body: automation.when_to_use,
      tone: "violet" as const,
    },
    {
      key: "output",
      icon: Package,
      title: "What you get back",
      body: automation.expected_output,
      tone: "lime" as const,
    },
    {
      key: "wrong",
      icon: TriangleAlert,
      title: "What could go wrong",
      body: automation.what_could_go_wrong,
      tone: "amber" as const,
    },
    {
      key: "failed",
      icon: ShieldCheck,
      title: "If the run fails",
      body: automation.failure_guidance,
      tone: "red" as const,
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {sections.map((section, index) => (
        <motion.div
          key={section.key}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.045, duration: 0.35 }}
        >
          <Panel className="h-full p-5">
            <div className="flex items-center gap-2.5">
              <span
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-lg border",
                  section.tone === "lime"
                    ? "border-lime/20 bg-lime/[0.07] text-lime"
                    : section.tone === "cyan"
                      ? "border-cyan/20 bg-cyan/[0.07] text-cyan"
                      : section.tone === "violet"
                        ? "border-signal-violet/20 bg-signal-violet/[0.07] text-signal-violet"
                        : section.tone === "amber"
                          ? "border-signal-amber/20 bg-signal-amber/[0.07] text-signal-amber"
                          : "border-signal-red/20 bg-signal-red/[0.07] text-signal-red",
                )}
              >
                <section.icon className="h-4 w-4" />
              </span>
              <p className="text-[13px] font-semibold text-ink">{section.title}</p>
            </div>
            <p className="mt-3 text-[12.5px] leading-relaxed text-ink-muted">{section.body}</p>
          </Panel>
        </motion.div>
      ))}
    </div>
  );
}

function InputsTab({ automation }: { automation: AutomationDetail }) {
  const schema = automation.input_schema ?? {};
  const fields = Object.entries(schema.properties ?? {});
  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-5 py-4">
        <div>
          <p className="text-[13px] font-semibold text-ink">Published input schema</p>
          <p className="mt-0.5 text-[11.5px] text-ink-muted">
            Values outside this contract are rejected before the run is created.
          </p>
        </div>
        <span className="chip text-[10.5px] text-ink-muted">
          {fields.length} input{fields.length === 1 ? "" : "s"}
        </span>
      </div>
      {fields.length === 0 ? (
        <p className="px-5 py-8 text-center text-[12px] text-ink-faint">
          This automation takes no inputs.
        </p>
      ) : (
        <div className="divide-y divide-white/[0.05]">
          {fields.map(([name, spec]) => {
            const required = (schema.required ?? []).includes(name);
            const constraints = [
              spec.enum ? `one of ${spec.enum.join(", ")}` : null,
              spec.minimum !== undefined ? `min ${spec.minimum}` : null,
              spec.maximum !== undefined ? `max ${spec.maximum}` : null,
              spec.maxLength !== undefined ? `≤ ${spec.maxLength} chars` : null,
              spec.type === "array" ? "comma-separated list" : null,
            ].filter(Boolean);
            return (
              <div key={name} className="flex flex-wrap items-start gap-4 px-5 py-3.5">
                <div className="w-40 shrink-0">
                  <p className="mono text-[12px] text-ink">{name}</p>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className="rounded border border-white/10 px-1.5 py-px text-[9px] uppercase tracking-wide text-ink-faint">
                      {spec.type ?? "any"}
                    </span>
                    {required ? <span className="text-[9.5px] font-medium text-lime">required</span> : null}
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] text-ink-muted">{spec.description ?? "No description was published."}</p>
                  {constraints.length ? (
                    <p className="mt-1 text-[10.5px] text-ink-faint">{constraints.join(" · ")}</p>
                  ) : null}
                </div>
                <div className="w-40 shrink-0 text-right">
                  <p className="text-[9.5px] uppercase tracking-[0.12em] text-ink-faint">Default</p>
                  <p className="mono mt-0.5 truncate text-[11px] text-ink-muted">
                    {spec.default === undefined ? "—" : JSON.stringify(spec.default)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {automation.output_schema && Object.keys(automation.output_schema).length ? (
        <div className="border-t border-white/[0.06] px-5 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Output contract</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {Object.keys(automation.output_schema.properties ?? {}).map((key) => (
              <span key={key} className="mono chip text-[10px] text-ink-muted">
                {key}
              </span>
            ))}
            {!Object.keys(automation.output_schema.properties ?? {}).length ? (
              <span className="text-[11px] text-ink-faint">No structured output declared.</span>
            ) : null}
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

function VersionsTab({ automation }: { automation: AutomationDetail }) {
  return (
    <Panel className="overflow-hidden">
      <div className="border-b border-white/[0.06] px-5 py-4">
        <p className="text-[13px] font-semibold text-ink">Published versions</p>
        <p className="mt-0.5 text-[11.5px] text-ink-muted">
          Executions reference an immutable version and checksum. A new version requires a new approval.
        </p>
      </div>
      <ol className="divide-y divide-white/[0.05]">
        {automation.versions.map((version, index) => (
          <li key={version.id} className="flex flex-wrap items-start gap-4 px-5 py-4">
            <div className="flex w-24 shrink-0 items-center gap-2">
              <span
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-lg border text-[10px] font-semibold",
                  index === 0
                    ? "border-lime/25 bg-lime/10 text-lime"
                    : "border-white/10 bg-white/[0.03] text-ink-muted",
                )}
              >
                {version.version}
              </span>
              {index === 0 ? <span className="text-[9px] font-medium uppercase tracking-wide text-lime">current</span> : null}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] text-ink">{version.changelog || "No changelog provided."}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[10.5px] text-ink-faint">
                <span>{formatDate(version.created_at)}</span>
                <span>·</span>
                <span className="mono inline-flex items-center gap-1">
                  {shortenHash(version.checksum, 14)}
                  <CopyButton value={version.checksum} />
                </span>
                <span>·</span>
                <Badge tone={version.status === "PUBLISHED" ? "lime" : "slate"}>{version.status}</Badge>
              </div>
            </div>
            {index === 0 ? (
              <span className="chip text-[10px] text-ink-muted">
                <Lock className="h-2.5 w-2.5" />
                bound to approvals
              </span>
            ) : null}
          </li>
        ))}
        {!automation.versions.length ? (
          <li className="px-5 py-8 text-center text-[12px] text-ink-faint">
            No versions have been published yet.
          </li>
        ) : null}
      </ol>
      {automation.repository ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] px-5 py-3.5">
          <span className="inline-flex items-center gap-2 text-[11px] text-ink-muted">
            <FolderGit2 className="h-3.5 w-3.5 text-ink-faint" />
            {automation.repository.name} · {automation.repository.default_branch}
          </span>
          <span className="mono text-[10px] text-ink-faint">{automation.repository_path}</span>
        </div>
      ) : null}
    </Panel>
  );
}

function ReadyRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-faint">{label}</dt>
      <dd className={cn("truncate text-right text-ink", mono && "mono text-[11px]")}>{value}</dd>
    </div>
  );
}
