"use client";

import { ArrowLeft, ArrowRight, ListChecks, PlayCircle, SearchX, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { ExecutionRow } from "@/components/domain/execution-row";
import { PageHeader } from "@/components/shell/page-header";
import {
  Badge,
  Button,
  EmptyState,
  Panel,
  SearchInput,
  Select,
  Skeleton,
  Tabs,
} from "@/components/ui/primitives";
import { useEnvironments, useExecutions } from "@/lib/hooks";
import { plural } from "@/lib/utils";

const statusTabs = [
  { key: "ALL", label: "All" },
  { key: "ACTIVE", label: "Active" },
  { key: "WAITING_FOR_APPROVAL", label: "Awaiting approval" },
  { key: "SUCCEEDED", label: "Succeeded" },
  { key: "FAILED", label: "Failed" },
  { key: "BLOCKED", label: "Blocked" },
  { key: "CANCELLED", label: "Cancelled" },
];

export default function ExecutionsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[420px]" />}>
      <ExecutionsContent />
    </Suspense>
  );
}

function ExecutionsContent() {
  const params = useSearchParams();
  const [status, setStatus] = useState(params.get("status") ?? "ALL");
  const [q, setQ] = useState(params.get("q") ?? "");
  const [environment, setEnvironment] = useState(params.get("environment") ?? "");
  const [automation, setAutomation] = useState(params.get("automation") ?? "");
  const [page, setPage] = useState(1);

  const environments = useEnvironments();
  const executions = useExecutions({
    status: status === "ALL" ? undefined : status,
    environment: environment || undefined,
    automation_id: automation || undefined,
    q: q || undefined,
    page,
    page_size: 25,
  });

  const items = executions.data?.items ?? [];
  const total = executions.data?.total ?? 0;
  const pages = executions.data?.pages ?? 1;

  function resetFilters() {
    setStatus("ALL");
    setQ("");
    setEnvironment("");
    setAutomation("");
    setPage(1);
  }

  const filtered = Boolean(status !== "ALL" || q || environment || automation);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Execution ledger"
        title="Every run, accounted for"
        description="Live progress, complete logs and the exact reason each execution ended the way it did. Nothing disappears from this ledger."
        meta={
          <>
            <Badge tone="cyan" dot>
              {executions.data ? `${total} execution${total === 1 ? "" : "s"}` : "Loading"}
            </Badge>
            <span className="text-[11px] text-ink-faint">Auto-refreshes every 8 seconds</span>
            {automation ? (
              <button
                onClick={() => {
                  setAutomation("");
                  setPage(1);
                }}
                className="inline-flex items-center gap-1 rounded-full border border-cyan/25 bg-cyan/10 px-2.5 py-1 text-[10.5px] font-medium text-cyan"
              >
                Filtered to one automation
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </>
        }
        actions={
          <Link
            href="/automations"
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-lime/40 bg-lime px-4 text-sm font-medium text-obsidian-950 transition hover:bg-lime-soft"
          >
            <PlayCircle className="h-4 w-4" />
            New execution
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          tabs={statusTabs}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <SearchInput
            value={q}
            onChange={(value) => {
              setQ(value);
              setPage(1);
            }}
            placeholder="Search execution ID…"
            className="w-[220px]"
          />
          <Select
            value={environment}
            onChange={(event) => {
              setEnvironment(event.target.value);
              setPage(1);
            }}
            className="w-[170px]"
          >
            <option value="">All environments</option>
            {(environments.data ?? []).map((env) => (
              <option key={env.id} value={env.key}>
                {env.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <Panel className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
          <p className="inline-flex items-center gap-2 text-[11px] font-medium text-ink-muted">
            <ListChecks className="h-3.5 w-3.5 text-ink-faint" />
            {executions.isLoading
              ? "Loading executions…"
              : `${plural(items.length, "execution")} on this page${filtered ? " · filters applied" : ""}`}
          </p>
          {filtered ? (
            <button
              onClick={resetFilters}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-ink-faint transition hover:text-ink"
            >
              <X className="h-3 w-3" />
              Clear filters
            </button>
          ) : (
            <span className="text-[10.5px] text-ink-faint">Newest first</span>
          )}
        </div>

        {executions.isLoading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-16 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<SearchX className="h-5 w-5" />}
            title={filtered ? "No executions match these filters" : "No executions yet"}
            description={
              filtered
                ? "Try a different status, environment or execution ID."
                : "Discover an automation and run it in UAT. The full evidence trail will appear here."
            }
            action={
              filtered ? (
                <Button variant="secondary" onClick={resetFilters}>
                  Clear filters
                </Button>
              ) : (
                <Button variant="primary">
                  <Link href="/automations">Browse automations</Link>
                </Button>
              )
            }
          />
        ) : (
          <div className="p-2">
            {items.map((execution) => (
              <ExecutionRow key={execution.id} execution={execution} />
            ))}
          </div>
        )}

        {pages > 1 ? (
          <div className="flex items-center justify-between border-t border-white/[0.06] px-4 py-3">
            <p className="text-[11px] text-ink-faint">
              Page {page} of {pages} · {total} total
            </p>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={page <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                icon={<ArrowLeft className="h-3.5 w-3.5" />}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={page >= pages}
                onClick={() => setPage((value) => Math.min(pages, value + 1))}
              >
                Next
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : null}
      </Panel>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.015] px-4 py-3 text-[11px] text-ink-faint">
        <PlayCircle className="h-3.5 w-3.5" />
        Executions are immutable records. Cancelling stops the run but never deletes its evidence.
      </div>
    </div>
  );
}
