"use client";

import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  Cpu,
  Database,
  GitBranch,
  KeyRound,
  Lock,
  Mail,
  Plug,
  RefreshCw,
  Scale,
  ShieldCheck,
  Workflow,
  XCircle,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { PageHeader } from "@/components/shell/page-header";
import {
  Badge,
  Button,
  EmptyState,
  Panel,
  Skeleton,
  StatusPill,
  useBeginner,
} from "@/components/ui/primitives";
import { ApiError } from "@/lib/api";
import { useIntegrations, useMe, useRefreshIntegrations, useTestIntegration } from "@/lib/hooks";
import { can } from "@/lib/nav";
import { toast } from "@/lib/stores";
import type { Integration } from "@/lib/types";
import { cn, relative, statusTone, toneClasses } from "@/lib/utils";

const categoryIcons: Record<string, typeof Plug> = {
  "CI / CD": GitBranch,
  Orchestration: Workflow,
  Identity: KeyRound,
  Secrets: Lock,
  Governance: Scale,
  Storage: Database,
  "Cache / Coordination": Zap,
  Observability: Activity,
  "Security scanner": ShieldCheck,
  Execution: Cpu,
  Notifications: Mail,
};

export default function IntegrationsPage() {
  const me = useMe();
  const integrations = useIntegrations();
  const refresh = useRefreshIntegrations();
  const test = useTestIntegration();
  const beginner = useBeginner();
  const [category, setCategory] = useState("ALL");
  const [status, setStatus] = useState("ALL");

  const permissions = me.data?.user.permissions ?? [];
  const canWrite = can(permissions, "integrations:write");
  const items = integrations.data ?? [];

  const categories = useMemo(
    () => ["ALL", ...Array.from(new Set(items.map((item) => item.category))).sort()],
    [items],
  );

  const filtered = items.filter(
    (item) =>
      (category === "ALL" || item.category === category) && (status === "ALL" || item.status === status),
  );

  const counts = useMemo(() => {
    const map: Record<string, number> = { CONFIGURED: 0, NOT_CONFIGURED: 0, ERROR: 0, DEGRADED: 0 };
    for (const item of items) map[item.status] = (map[item.status] ?? 0) + 1;
    return map;
  }, [items]);

  async function runTest(item: Integration) {
    try {
      const result = await test.mutateAsync(item.key);
      toast(
        result.status === "CONFIGURED" ? `${item.name} connected` : `${item.name} is not ready`,
        result.status === "CONFIGURED" ? "success" : "warning",
        result.message,
      );
    } catch (caught) {
      toast("Connection test failed", "error", (caught as ApiError).message ?? "The adapter could not be tested.");
    }
  }

  async function refreshCatalog() {
    try {
      await refresh.mutateAsync();
      toast("Catalog refreshed", "success", "Integration status was re-read from the running configuration.");
    } catch (caught) {
      toast("Refresh failed", "error", (caught as ApiError).message ?? "The catalog could not be refreshed.");
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 pb-16 pt-7 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Platform"
        title="Integrations"
        description="Exactly what this deployment is connected to. A connector is only marked configured when its configuration is present; tests report real results, and missing integrations show setup guidance."
        meta={
          <>
            <Badge tone="lime" dot>
              {counts.CONFIGURED} configured
            </Badge>
            <Badge tone="slate">{counts.NOT_CONFIGURED} not configured</Badge>
            {counts.DEGRADED ? <Badge tone="amber">{counts.DEGRADED} degraded</Badge> : null}
            {counts.ERROR ? <Badge tone="red">{counts.ERROR} error</Badge> : null}
          </>
        }
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={() => void integrations.refetch()}
              loading={integrations.isFetching}
            >
              Reload
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<Plug className="h-3.5 w-3.5" />}
              onClick={() => void refreshCatalog()}
              loading={refresh.isPending}
              disabled={!canWrite}
              title={!canWrite ? "Your role cannot test integrations." : undefined}
            >
              Refresh catalog
            </Button>
          </>
        }
      />

      {beginner ? (
        <Panel className="mt-5 border-cyan/20 bg-cyan/[0.04] px-5 py-4">
          <p className="text-[12.5px] leading-relaxed text-ink-muted">
            <span className="font-medium text-ink">How this works: </span>
            JUNE works without these systems. The built-in local sandbox executes automations, internal rules gate
            production, and evidence is stored locally. Each connector below says honestly whether it is connected.
          </p>
        </Panel>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-1.5">
        {categories.map((entry) => (
          <button
            key={entry}
            onClick={() => setCategory(entry)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-[11px] font-medium transition",
              category === entry
                ? "border-lime/35 bg-lime/[0.08] text-lime"
                : "border-white/10 bg-white/[0.02] text-ink-muted hover:border-white/20 hover:text-ink",
            )}
          >
            {entry === "ALL" ? "All categories" : entry}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { key: "ALL", label: "All" },
            { key: "CONFIGURED", label: "Configured" },
            { key: "NOT_CONFIGURED", label: "Not configured" },
            { key: "DEGRADED", label: "Degraded" },
            { key: "ERROR", label: "Error" },
          ].map((entry) => (
            <button
              key={entry.key}
              onClick={() => setStatus(entry.key)}
              className={cn(
                "rounded-full px-2.5 py-1 text-[10.5px] transition",
                status === entry.key ? "bg-white/[0.08] text-ink" : "text-ink-faint hover:text-ink-muted",
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <p className="text-[10.5px] text-ink-faint">
          {filtered.length} of {items.length} connectors shown
        </p>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {integrations.isLoading ? (
          [0, 1, 2, 3, 4, 5].map((key) => <Skeleton key={key} className="h-[240px] w-full" />)
        ) : filtered.length ? (
          filtered.map((item) => (
            <IntegrationCard
              key={item.id}
              integration={item}
              canWrite={canWrite}
              testing={test.isPending && test.variables === item.key}
              onTest={() => void runTest(item)}
            />
          ))
        ) : (
          <div className="md:col-span-2 xl:col-span-3">
            <Panel>
              <EmptyState
                icon={<Plug className="h-5 w-5" />}
                title="No connectors match these filters"
                description="Clear the category or status filters to see the full catalog."
              />
            </Panel>
          </div>
        )}
      </div>

      <Panel className="mt-5 border-cyan/20 bg-cyan/[0.03] px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-[12px] font-medium text-ink">
              <Cpu className="h-4 w-4 text-cyan" /> Execution plane in this deployment
            </p>
            <p className="mt-1 max-w-3xl text-[11.5px] leading-relaxed text-ink-muted">
              Development and UAT execute in the local sandbox. Production executes through a simulation adapter that
              is labelled on every run. Remote agents can be registered but are not dispatched to in this release.
            </p>
          </div>
          <Link href="/infrastructure" className="shrink-0">
            <Button variant="secondary" size="sm" icon={<ArrowUpRight className="h-3.5 w-3.5" />}>
              View infrastructure
            </Button>
          </Link>
        </div>
      </Panel>

      <p className="mt-4 text-[10.5px] leading-relaxed text-ink-faint">
        Setup values are read from deployment environment variables. JUNE does not accept credentials in the browser and
        never prints secret values.
      </p>
    </div>
  );
}

function IntegrationCard({
  integration,
  canWrite,
  testing,
  onTest,
}: {
  integration: Integration;
  canWrite: boolean;
  testing: boolean;
  onTest: () => void;
}) {
  const Icon = categoryIcons[integration.category] ?? Plug;
  const tone = statusTone(integration.status);
  const palette = toneClasses[tone];
  const configEntries = Object.entries(integration.config ?? {}).filter(([, value]) => value !== "" && value !== null);
  return (
    <Panel hover className="flex flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-4 py-3.5">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border",
              palette.border,
              palette.bg,
              palette.text,
            )}
          >
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[12.5px] font-medium text-ink">{integration.name}</p>
            <p className="text-[10px] text-ink-faint">{integration.category}</p>
          </div>
        </div>
        <StatusPill status={integration.status} />
      </div>

      <div className="min-h-0 flex-1 px-4">
        <p className="text-[11px] leading-relaxed text-ink-muted">{integration.description}</p>
        <div className="mt-2.5 rounded-lg border border-white/[0.06] bg-white/[0.015] px-3 py-2">
          <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-ink-faint">Reported state</p>
          <p className="mt-1 text-[10.5px] leading-relaxed text-ink-muted">
            {integration.message || "No status message has been recorded. Run a connection test."}
          </p>
        </div>
        {configEntries.length ? (
          <dl className="mt-2 space-y-1">
            {configEntries.slice(0, 3).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between gap-2 text-[10px]">
                <dt className="mono text-ink-faint">{key}</dt>
                <dd className="mono max-w-[190px] truncate text-ink-muted" title={String(value)}>
                  {String(value)}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-2 text-[10px] text-ink-faint">No configuration values are present.</p>
        )}
        <details className="group mt-2">
          <summary className="cursor-pointer list-none text-[10px] text-ink-faint transition hover:text-ink-muted">
            How to connect <span className="text-[9px]">▾</span>
          </summary>
          <p className="mt-1.5 rounded-lg border border-white/[0.06] bg-obsidian-900/50 px-2.5 py-2 text-[10px] leading-relaxed text-ink-muted">
            {integration.setup_hint}
          </p>
        </details>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/[0.06] px-4 py-2.5">
        <span className="text-[9.5px] text-ink-faint">
          {integration.last_checked_at ? `Checked ${relative(integration.last_checked_at)}` : "Never checked"}
        </span>
        <div className="flex items-center gap-1">
          {integration.docs_url ? (
            <a
              href={integration.docs_url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10px] text-ink-faint transition hover:bg-white/5 hover:text-ink"
            >
              Docs <ArrowUpRight className="h-2.5 w-2.5" />
            </a>
          ) : null}
          <Button
            variant={integration.status === "CONFIGURED" ? "outline" : "secondary"}
            size="sm"
            icon={
              integration.status === "CONFIGURED" ? (
                <CheckCircle2 className="h-3 w-3" />
              ) : integration.status === "ERROR" ? (
                <XCircle className="h-3 w-3" />
              ) : (
                <Plug className="h-3 w-3" />
              )
            }
            onClick={onTest}
            loading={testing}
            disabled={!canWrite}
            title={!canWrite ? "Your role cannot run connection tests." : undefined}
          >
            Test
          </Button>
        </div>
      </div>
    </Panel>
  );
}
