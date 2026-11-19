"use client";

import { motion } from "framer-motion";
import {
  ArrowRight,
  ArrowUpRight,
  Clock3,
  FlaskConical,
  ListFilter,
  SearchX,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { PageHeader } from "@/components/shell/page-header";
import {
  Badge,
  Button,
  EmptyState,
  Panel,
  SearchInput,
  Segmented,
  Skeleton,
  useBeginner,
} from "@/components/ui/primitives";
import { useAutomations, useMe } from "@/lib/hooks";
import { automationIcon, cn, pct, relative, riskTone } from "@/lib/utils";

const envLabels: Record<string, string> = {
  development: "Dev",
  uat: "UAT",
  production: "Production",
};

export default function AutomationsPage() {
  const me = useMe();
  const beginner = useBeginner();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [environment, setEnvironment] = useState("all");

  const automations = useAutomations({
    q: search || undefined,
    category: category === "All" ? undefined : category,
    environment: environment === "all" ? undefined : environment,
    page_size: 60,
  });

  const items = automations.data?.items ?? [];
  const categories = useMemo(() => {
    const unique = new Set(items.map((item) => item.category));
    return ["All", ...[...unique].sort()];
  }, [items]);

  const canWrite = me.data?.user?.permissions?.includes("automations:write");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Automation registry"
        title="Discover what JUNE can do"
        description="Every automation is registered, versioned and restricted to an approved runner. Open one to read exactly what it does before you run it."
        meta={
          <>
            <Badge tone="lime" dot>
              {automations.data ? `${automations.data.total} active` : "Loading registry"}
            </Badge>
            <span className="text-[11px] text-ink-faint">No arbitrary scripts. No hidden shell.</span>
          </>
        }
        actions={
          canWrite ? (
            <Button variant="secondary" onClick={() => (window.location.href = "/studio")}>
              Design a pipeline
            </Button>
          ) : (
            <Link
              href="/help"
              className="chip text-ink-muted transition hover:border-white/15 hover:text-ink"
            >
              <ShieldCheck className="h-3 w-3 text-cyan" />
              How execution stays safe
            </Link>
          )
        }
      />

      {beginner ? (
        <div className="flex items-start gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-lime" />
          <p className="text-[12.5px] leading-relaxed text-ink-muted">
            Start with a <span className="text-ink">LOW risk</span> automation. Each card explains what the automation
            does in plain English, which environments allow it, and whether a human must approve it first.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search by name, purpose or category…"
          className="w-full sm:w-[320px]"
        />
        <div className="flex flex-wrap items-center gap-1 rounded-xl border border-white/[0.08] bg-obsidian-900/50 p-1">
          {categories.slice(0, 7).map((option) => (
            <button
              key={option}
              onClick={() => setCategory(option)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-[12px] font-medium transition",
                category === option ? "bg-white/[0.08] text-ink" : "text-ink-faint hover:text-ink-muted",
              )}
            >
              {option}
            </button>
          ))}
        </div>
        <Segmented
          value={environment}
          onChange={setEnvironment}
          options={[
            { value: "all", label: "All environments" },
            { value: "uat", label: "UAT" },
            { value: "production", label: "Production" },
          ]}
          className="ml-auto"
        />
      </div>

      {automations.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-[230px]" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Panel className="p-6">
          <EmptyState
            icon={<SearchX className="h-5 w-5" />}
            title="No automations match those filters"
            description="Try a different search term, category or environment. The registry only lists automations that are active."
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch("");
                  setCategory("All");
                  setEnvironment("all");
                }}
              >
                Clear filters
              </Button>
            }
          />
        </Panel>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((automation, index) => {
            const Icon = automationIcon(automation.icon);
            const neverRun = !automation.execution_count;
            return (
              <motion.div
                key={automation.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index * 0.035, 0.3), duration: 0.4 }}
                className="h-full"
              >
                <Link
                  href={`/automations/${automation.slug}`}
                  className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-obsidian-800/70 p-5 shadow-inset transition duration-300 hover:-translate-y-1 hover:border-white/[0.14] hover:bg-obsidian-700/70 hover:shadow-lift"
                >
                  <span className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-0 transition group-hover:opacity-100" />

                  <div className="flex items-start justify-between gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] bg-gradient-to-br from-white/[0.07] to-transparent text-ink-muted transition group-hover:border-lime/25 group-hover:text-lime">
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                    <div className="flex items-center gap-1.5">
                      {automation.is_sample ? (
                        <span className="rounded-full border border-cyan/20 bg-cyan/[0.07] px-2 py-0.5 text-[9.5px] font-medium uppercase tracking-[0.1em] text-cyan">
                          sample
                        </span>
                      ) : null}
                      <Badge tone={riskTone(automation.risk_level)}>{automation.risk_level}</Badge>
                    </div>
                  </div>

                  <h2 className="mt-4 text-[15px] font-semibold tracking-[-0.015em] text-ink">
                    {automation.name}
                  </h2>
                  <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-ink-muted">
                    {automation.summary}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {automation.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="chip text-[10px] text-ink-faint">
                        {tag}
                      </span>
                    ))}
                    <span className="chip text-[10px] text-ink-faint">{automation.category}</span>
                  </div>

                  <div className="mt-auto pt-5">
                    <div className="flex flex-wrap items-center gap-2 text-[10.5px] text-ink-faint">
                      {automation.supported_environments.map((env) => (
                        <span
                          key={env}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-2 py-[2px]",
                            env === "production"
                              ? "border-signal-amber/20 bg-signal-amber/[0.06] text-signal-amber"
                              : "border-white/10 bg-white/[0.02]",
                          )}
                        >
                          {env === "uat" ? <FlaskConical className="h-2.5 w-2.5" /> : null}
                          {envLabels[env] ?? env}
                        </span>
                      ))}
                      {automation.approval_required ? (
                        <span className="inline-flex items-center gap-1 text-signal-amber">
                          <ShieldCheck className="h-2.5 w-2.5" />
                          approval
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-3">
                      <div className="flex items-center gap-3 text-[10.5px] text-ink-faint">
                        {neverRun ? (
                          <span>Never run</span>
                        ) : (
                          <>
                            <span className="inline-flex items-center gap-1">
                              <TrendingUp className="h-3 w-3 text-lime/70" />
                              {pct(automation.success_rate)} success
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Clock3 className="h-3 w-3" />
                              {relative(automation.last_execution_at)}
                            </span>
                          </>
                        )}
                      </div>
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-ink-faint transition group-hover:text-lime">
                        Open
                        <ArrowUpRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                      </span>
                    </div>
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.015] px-4 py-3">
        <p className="inline-flex items-center gap-2 text-[11px] text-ink-faint">
          <ListFilter className="h-3.5 w-3.5" />
          Showing {items.length} of {automations.data?.total ?? 0} automations. Archived automations are hidden from
          discovery but remain in the audit trail.
        </p>
        <Link href="/studio" className="inline-flex items-center gap-1 text-[11px] font-medium text-ink-muted hover:text-lime">
          <Workflow className="h-3.5 w-3.5" />
          Pipeline Studio
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
