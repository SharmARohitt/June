"use client";

import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  CircleSlash,
  FlaskConical,
  Info,
  Lock,
  Play,
  Server,
  ShieldAlert,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  Badge,
  Button,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
  Toggle,
} from "@/components/ui/primitives";
import { EnvBadge } from "@/components/domain/env-badge";
import { ApiError } from "@/lib/api";
import { useEnvironment, useEnvironments, usePreflight, useSubmitExecution } from "@/lib/hooks";
import { toast } from "@/lib/stores";
import { cn, newId, riskCopy, riskTone } from "@/lib/utils";
import type { AutomationDetail, Environment, ExecutionDetail, JsonSchema, Preflight } from "@/lib/types";

const stepLabels = ["Environment", "Inputs", "Checks & submit"];

export function RunWizard({
  automation,
  open,
  onClose,
  onSubmitted,
}: {
  automation: AutomationDetail;
  open: boolean;
  onClose: () => void;
  onSubmitted: (execution: ExecutionDetail) => void;
}) {
  const environments = useEnvironments();
  const [step, setStep] = useState(0);
  const [environmentId, setEnvironmentId] = useState<string>("");
  const [groupId, setGroupId] = useState<string>("");
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [reason, setReason] = useState("");
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blockingDetails, setBlockingDetails] = useState<string[]>([]);
  const [idempotencyKey, setIdempotencyKey] = useState("");

  const supported = useMemo(
    () => (environments.data ?? []).filter((env) => automation.supported_environments.includes(env.key)),
    [environments.data, automation.supported_environments],
  );
  const selectedEnv = supported.find((env) => env.id === environmentId);
  const environment = useEnvironment(environmentId || null);
  const preflightMutation = usePreflight();
  const submit = useSubmitExecution();

  useEffect(() => {
    if (!open) return;
    setStep(0);
    const preferred = supported.find((env) => env.key === "uat") ?? supported[0];
    setEnvironmentId(preferred?.id ?? "");
    setGroupId("");
    setParams(defaultParams(automation.input_schema));
    setReason("");
    setPreflight(null);
    setError(null);
    setBlockingDetails([]);
    setIdempotencyKey(newId());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, automation.id, supported.length]);

  useEffect(() => {
    setGroupId("");
    setPreflight(null);
  }, [environmentId]);

  const groups = environment.data?.groups ?? [];
  const schema = automation.input_schema ?? {};
  const schemaFields = Object.entries(schema.properties ?? {});

  async function continueToChecks() {
    setError(null);
    setBlockingDetails([]);
    try {
      const result = await preflightMutation.mutateAsync({
        automation_id: automation.id,
        environment_id: environmentId,
        server_group_id: groupId || null,
        params,
      });
      setPreflight(result);
      setStep(2);
    } catch (caught) {
      const apiError = caught as ApiError;
      setError(apiError.message);
      const details = apiError.details as { blocking_issues?: string[] } | null;
      setBlockingDetails(details?.blocking_issues ?? []);
    }
  }

  async function submitExecution() {
    if (!selectedEnv) return;
    setError(null);
    try {
      const execution = await submit.mutateAsync({
        automation_id: automation.id,
        environment_id: environmentId,
        server_group_id: groupId || null,
        params,
        reason,
        idempotency_key: idempotencyKey,
      });
      toast(
        execution.status === "WAITING_FOR_APPROVAL" ? "Submitted for approval" : "Execution queued",
        "success",
        execution.status === "WAITING_FOR_APPROVAL"
          ? "A separation-of-duties approver must review the candidate before it continues."
          : "JUNE is starting the run. Live logs will stream on the execution page.",
      );
      onSubmitted(execution);
    } catch (caught) {
      const apiError = caught as ApiError;
      setError(apiError.message);
      const details = apiError.details as { blocking_issues?: string[] } | null;
      setBlockingDetails(details?.blocking_issues ?? []);
    }
  }

  const canContinue =
    step === 0
      ? Boolean(environmentId)
      : step === 1
        ? true
        : Boolean(preflight?.can_submit) && reason.trim().length >= 8;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={`Run ${automation.name}`}
      description="JUNE checks policy, inputs and environment safety before anything starts. You will see every check first."
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            {stepLabels.map((label, index) => (
              <span
                key={label}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] font-medium",
                  index === step
                    ? "border-lime/30 bg-lime/10 text-lime"
                    : index < step
                      ? "border-white/10 bg-white/[0.04] text-ink-muted"
                      : "border-white/[0.06] text-ink-faint",
                )}
              >
                {index < step ? <CheckCircle2 className="h-2.5 w-2.5" /> : <span className="mono">{index + 1}</span>}
                {label}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {step > 0 ? (
              <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => setStep(step - 1)}>
                Back
              </Button>
            ) : (
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
            )}
            {step < 2 ? (
              <Button
                variant="primary"
                loading={preflightMutation.isPending}
                onClick={() => {
                  if (step === 1) void continueToChecks();
                  else setStep(1);
                }}
              >
                {step === 1 ? "Run safety checks" : "Continue"}
                <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                variant="primary"
                loading={submit.isPending}
                disabled={!canContinue}
                icon={<Play className="h-4 w-4" />}
                onClick={() => void submitExecution()}
              >
                {preflight?.requires_approval ? "Submit for approval" : "Start execution"}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={riskTone(automation.risk_level)}>{automation.risk_level} risk</Badge>
          <span className="chip text-ink-muted">{automation.current_version}</span>
          {automation.approval_required ? (
            <span className="chip border-signal-amber/25 text-signal-amber">
              <ShieldAlert className="h-3 w-3" />
              approval required
            </span>
          ) : null}
          <span className="ml-auto text-[11px] text-ink-faint">{riskCopy[automation.risk_level]}</span>
        </div>

        {error ? (
          <div className="rounded-xl border border-signal-red/25 bg-signal-red/[0.07] px-4 py-3">
            <p className="flex items-center gap-2 text-[12.5px] font-medium text-signal-red">
              <TriangleAlert className="h-4 w-4" />
              {error}
            </p>
            {blockingDetails.length ? (
              <ul className="mt-2 space-y-1 pl-6 text-[11.5px] text-ink-muted">
                {blockingDetails.map((detail) => (
                  <li key={detail} className="list-disc">
                    {detail}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {step === 0 ? (
          <section className="space-y-4">
            <div>
              <p className="text-[13px] font-semibold text-ink">Where should this run?</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-ink-muted">
                Only environments declared safe by the automation are listed. Production runs are governed by
                approval policy and separation of duties.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {environments.isLoading
                ? [0, 1].map((index) => <div key={index} className="skeleton h-[112px]" />)
                : supported.map((env) => (
                    <EnvironmentOption
                      key={env.id}
                      env={env}
                      selected={env.id === environmentId}
                      onSelect={() => setEnvironmentId(env.id)}
                    />
                  ))}
            </div>
            {supported.length === 0 && !environments.isLoading ? (
              <div className="rounded-xl border border-signal-amber/25 bg-signal-amber/[0.06] px-4 py-3 text-[12px] text-signal-amber">
                This automation is not enabled for any active environment. Ask a platform administrator to review its
                supported environments.
              </div>
            ) : null}

            <Field
              label="Target server group"
              hint={
                groups.length
                  ? "JUNE picks the first group if you leave this blank."
                  : "No server groups are registered for this environment. The run will use the environment default."
              }
            >
              <Select value={groupId} onChange={(event) => setGroupId(event.target.value)} disabled={!groups.length}>
                <option value="">Automatic (first group)</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name} · {group.servers.length} targets
                  </option>
                ))}
              </Select>
            </Field>

            {selectedEnv ? (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3 text-[11.5px] text-ink-muted">
                <EnvBadge environment={selectedEnv} />
                <span className="text-ink-faint">·</span>
                <span>
                  {selectedEnv.execution_mode === "SIMULATION"
                    ? "Deployments are simulated and labelled — no real infrastructure is touched."
                    : "Runs execute in the isolated local sandbox."}
                </span>
              </div>
            ) : null}
          </section>
        ) : null}

        {step === 1 ? (
          <section className="space-y-4">
            <div>
              <p className="text-[13px] font-semibold text-ink">Confirm the inputs</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-ink-muted">
                These values are validated against the published input schema and bound into the approval candidate
                hash. Changing them later creates a different candidate.
              </p>
            </div>
            {schemaFields.length === 0 ? (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-[12px] text-ink-muted">
                This automation takes no inputs. Continue to the safety checks.
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {schemaFields.map(([name, spec]) => (
                  <SchemaField
                    key={name}
                    name={name}
                    spec={spec}
                    required={(schema.required ?? []).includes(name)}
                    value={params[name]}
                    onChange={(value) => setParams((current) => ({ ...current, [name]: value }))}
                  />
                ))}
              </div>
            )}
            <div className="rounded-xl border border-cyan/15 bg-cyan/[0.04] px-4 py-3">
              <p className="flex items-center gap-2 text-[11.5px] text-cyan">
                <Info className="h-3.5 w-3.5" />
                Schema version {automation.current_version} · {schemaFields.length} declared input
                {schemaFields.length === 1 ? "" : "s"}
              </p>
            </div>
          </section>
        ) : null}

        {step === 2 ? (
          <section className="space-y-4">
            <div>
              <p className="text-[13px] font-semibold text-ink">Safety checks and reason</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-ink-muted">
                {preflight?.evaluated_by
                  ? `Evaluated by ${preflight.evaluated_by}. Every check below is shown, including the ones that pass.`
                  : "JUNE evaluates policy before anything starts."}
              </p>
            </div>

            {preflight ? (
              <>
                <div className="grid gap-2">
                  {preflight.checks.map((check) => (
                    <div
                      key={check.key}
                      className={cn(
                        "flex items-start gap-3 rounded-xl border px-3.5 py-2.5",
                        check.status === "PASS"
                          ? "border-lime/15 bg-lime/[0.035]"
                          : check.status === "WARN"
                            ? "border-signal-amber/25 bg-signal-amber/[0.06]"
                            : "border-signal-red/25 bg-signal-red/[0.06]",
                      )}
                    >
                      {check.status === "PASS" ? (
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lime" />
                      ) : check.status === "WARN" ? (
                        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-signal-amber" />
                      ) : (
                        <CircleSlash className="mt-0.5 h-3.5 w-3.5 shrink-0 text-signal-red" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[12px] font-medium text-ink">{check.name}</p>
                          <span
                            className={cn(
                              "text-[9.5px] font-semibold uppercase tracking-[0.12em]",
                              check.status === "PASS"
                                ? "text-lime"
                                : check.status === "WARN"
                                  ? "text-signal-amber"
                                  : "text-signal-red",
                            )}
                          >
                            {check.status}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-ink-muted">{check.message}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div
                  className={cn(
                    "flex items-start gap-3 rounded-xl border px-4 py-3",
                    preflight.requires_approval
                      ? "border-signal-amber/25 bg-signal-amber/[0.06]"
                      : "border-white/[0.07] bg-white/[0.02]",
                  )}
                >
                  {preflight.requires_approval ? (
                    <Lock className="mt-0.5 h-4 w-4 shrink-0 text-signal-amber" />
                  ) : (
                    <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-lime" />
                  )}
                  <div>
                    <p className="text-[12px] font-medium text-ink">
                      {preflight.requires_approval
                        ? "A human decision is required before this candidate proceeds"
                        : "No approval gate is required for this run"}
                    </p>
                    <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-muted">
                      {preflight.requires_approval
                        ? "JUNE runs the evidence stages first, then pauses at an approval gate bound to this exact candidate hash. You cannot approve your own request. Execution resumes only after an authorised approver decides."
                        : "The run will start immediately after submission and stream live logs."}
                    </p>
                  </div>
                </div>
              </>
            ) : null}

            <Field
              label="Why are you running this?"
              required
              hint="This reason is stored on the execution, the approval and the audit trail. Be specific — it is what your reviewer will read."
            >
              <Textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="e.g. Verify the UAT fleet answers /health after the 18 Nov certificate rotation."
                minLength={8}
                maxLength={1000}
              />
            </Field>

            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">Candidate</p>
              <div className="mt-2 grid gap-x-6 gap-y-1.5 text-[11.5px] sm:grid-cols-2">
                <SummaryRow label="Automation" value={`${automation.name} ${automation.current_version}`} />
                <SummaryRow label="Environment" value={selectedEnv?.name ?? "—"} />
                <SummaryRow label="Target group" value={groups.find((group) => group.id === groupId)?.name ?? "Environment default"} />
                <SummaryRow label="Timeout" value={`${automation.timeout_seconds}s`} />
              </div>
              <p className="mono mt-3 border-t border-white/[0.06] pt-2.5 text-[9.5px] text-ink-faint">
                idempotency {idempotencyKey.slice(0, 18)}… — double submits return the same execution
              </p>
            </div>
          </section>
        ) : null}
      </div>
    </Modal>
  );
}

function EnvironmentOption({
  env,
  selected,
  onSelect,
}: {
  env: Environment;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        "relative rounded-xl border p-4 text-left transition",
        selected
          ? "border-lime/40 bg-lime/[0.06] shadow-[0_0_0_1px_rgba(214,255,118,0.12)]"
          : "border-white/[0.07] bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {env.kind === "PRODUCTION" ? (
            <ShieldAlert className="h-4 w-4 text-signal-amber" />
          ) : env.kind === "UAT" ? (
            <FlaskConical className="h-4 w-4 text-signal-violet" />
          ) : (
            <Server className="h-4 w-4 text-cyan" />
          )}
          <p className="text-[13px] font-medium text-ink">{env.name}</p>
        </div>
        <span
          className={cn(
            "flex h-4 w-4 items-center justify-center rounded-full border",
            selected ? "border-lime bg-lime text-obsidian-950" : "border-white/20",
          )}
        >
          {selected ? <CheckCircle2 className="h-3 w-3" /> : null}
        </span>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-muted">{env.description || "No description."}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span className="chip text-[9.5px] text-ink-faint">{env.group_count} groups</span>
        <span className="chip text-[9.5px] text-ink-faint">{env.server_count} targets</span>
        {env.execution_mode === "SIMULATION" ? (
          <span className="rounded-full border border-signal-amber/25 bg-signal-amber/[0.08] px-2 py-0.5 text-[9.5px] font-medium text-signal-amber">
            simulated
          </span>
        ) : null}
        {env.approval_required || env.kind === "PRODUCTION" ? (
          <span className="rounded-full border border-signal-amber/25 bg-signal-amber/[0.08] px-2 py-0.5 text-[9.5px] font-medium text-signal-amber">
            approval
          </span>
        ) : null}
      </div>
    </button>
  );
}

function SchemaField({
  name,
  spec,
  required,
  value,
  onChange,
}: {
  name: string;
  spec: NonNullable<JsonSchema["properties"]>[string];
  required: boolean;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const label = spec.title ?? name.replace(/_/g, " ");
  const hint = spec.description;

  if (spec.type === "boolean") {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3">
        <Toggle
          checked={Boolean(value)}
          onChange={onChange}
          label={label}
          description={hint ?? "Enabled by default."}
        />
      </div>
    );
  }

  if (spec.enum?.length) {
    return (
      <Field label={label} hint={hint} required={required}>
        <Select value={String(value ?? spec.enum[0])} onChange={(event) => onChange(event.target.value)}>
          {spec.enum.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      </Field>
    );
  }

  if (spec.type === "array") {
    const items = Array.isArray(value) ? (value as string[]) : [];
    return (
      <Field
        label={label}
        hint={hint ?? "Comma-separated values, e.g. /health, /ready"}
        required={required}
        className="sm:col-span-2"
      >
        <Input
          value={items.join(", ")}
          onChange={(event) =>
            onChange(
              event.target.value
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean),
            )
          }
          placeholder="/health"
        />
      </Field>
    );
  }

  return (
    <Field
      label={label}
      hint={
        hint ??
        (spec.minimum !== undefined || spec.maximum !== undefined
          ? `Allowed range: ${spec.minimum ?? "—"} to ${spec.maximum ?? "—"}.`
          : undefined)
      }
      required={required}
    >
      <Input
        type={spec.type === "integer" || spec.type === "number" ? "number" : "text"}
        value={value === undefined || value === null ? "" : String(value)}
        min={spec.minimum}
        max={spec.maximum}
        onChange={(event) => {
          const raw = event.target.value;
          if (spec.type === "integer") onChange(raw === "" ? undefined : Number.parseInt(raw, 10));
          else if (spec.type === "number") onChange(raw === "" ? undefined : Number.parseFloat(raw));
          else onChange(raw);
        }}
      />
    </Field>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-ink-faint">{label}</span>
      <span className="truncate text-right text-ink">{value}</span>
    </div>
  );
}

function defaultParams(schema: JsonSchema): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(schema.properties ?? {})) {
    if (spec.default !== undefined) result[name] = spec.default;
    else if (spec.type === "boolean") result[name] = false;
    else if (spec.type === "array") result[name] = [];
    else if (spec.enum?.length) result[name] = spec.enum[0];
  }
  return result;
}
