"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  CalendarDays,
  ChevronDown,
  Download,
  Fingerprint,
  Link2,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  ShieldX,
  Sparkles,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { PageHeader } from "@/components/shell/page-header";
import {
  Avatar,
  Badge,
  Button,
  CopyButton,
  EmptyState,
  Panel,
  SearchInput,
  Select,
  Skeleton,
  useBeginner,
} from "@/components/ui/primitives";
import { ApiError, download, query } from "@/lib/api";
import { useAuditActions, useAuditEvents, useAuditIntegrity } from "@/lib/hooks";
import { toast } from "@/lib/stores";
import type { AuditEvent } from "@/lib/types";
import { cn, formatDate, humanize, relative, shortenHash, toneClasses, type Tone } from "@/lib/utils";

const OUTCOMES = ["ALL", "SUCCESS", "FAILED", "DENIED", "REJECTED", "EXPIRED"];

function outcomeTone(outcome: string): Tone {
  switch (outcome) {
    case "SUCCESS":
      return "lime";
    case "DENIED":
    case "FAILED":
      return "red";
    case "REJECTED":
      return "amber";
    case "EXPIRED":
      return "violet";
    default:
      return "slate";
  }
}

export default function ChroniclePage() {
  const beginner = useBeginner();
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [resourceType, setResourceType] = useState("");
  const [outcome, setOutcome] = useState("ALL");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<number | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchText.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchText]);

  const events = useAuditEvents({
    q: search || undefined,
    action: action || undefined,
    resource_type: resourceType || undefined,
    outcome: outcome === "ALL" ? undefined : outcome,
    page,
    page_size: 50,
  });
  const actions = useAuditActions();
  const integrity = useAuditIntegrity();

  const actionOptions = actions.data ?? [];
  const resourceTypes = useMemo(
    () => Array.from(new Set(actionOptions.map((entry) => entry.resource_type))).sort(),
    [actionOptions],
  );
  const items = events.data?.items ?? [];
  const totalPages = events.data?.pages ?? 1;

  const grouped = useMemo(() => {
    const groups: { day: string; events: AuditEvent[] }[] = [];
    for (const event of items) {
      const day = formatDate(event.created_at, "EEEE d MMMM yyyy");
      const current = groups[groups.length - 1];
      if (current && current.day === day) current.events.push(event);
      else groups.push({ day, events: [event] });
    }
    return groups;
  }, [items]);

  const latest = items[0];
  const chain = integrity.data;

  async function exportAs(format: "json" | "csv") {
    try {
      const params = query({
        format,
        action: action || undefined,
        resource_type: resourceType || undefined,
        outcome: outcome === "ALL" ? undefined : outcome,
        q: search || undefined,
      });
      await download(`/audit-events/export${params}`, `june-chronicle-${Date.now()}.${format}`);
      toast("Export downloaded", "success", "The export includes the chain integrity report.");
    } catch (caught) {
      toast("Export failed", "error", (caught as ApiError).message ?? "The Chronicle could not be exported.");
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 pb-16 pt-7 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Governance"
        title="Chronicle"
        description="A tamper-evident ledger of every login, run, approval, scan and configuration change. Each record hashes the record before it, so altering history breaks the chain."
        meta={
          <>
            <Badge tone={chain?.valid === false ? "red" : "lime"} dot>
              {chain ? (chain.valid ? "Chain intact" : "Chain broken") : "Verifying chain"}
            </Badge>
            <Badge tone="cyan">{events.data?.total ?? 0} records</Badge>
            {latest ? <Badge tone="slate">Latest {relative(latest.created_at)}</Badge> : null}
          </>
        }
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={() => {
                void events.refetch();
                void integrity.refetch();
              }}
              loading={events.isFetching || integrity.isFetching}
            >
              Refresh
            </Button>
            <Button variant="secondary" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={() => void exportAs("json")}>
              JSON
            </Button>
            <Button variant="secondary" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={() => void exportAs("csv")}>
              CSV
            </Button>
          </>
        }
      />

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Panel
          className={cn(
            "overflow-hidden",
            chain?.valid === false ? "border-signal-red/30" : "border-lime/15",
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-xl border",
                  chain?.valid === false
                    ? "border-signal-red/25 bg-signal-red/10 text-signal-red"
                    : "border-lime/25 bg-lime/10 text-lime",
                )}
              >
                {chain?.valid === false ? <ShieldX className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
              </span>
              <div>
                <p className="text-[13px] font-medium text-ink">
                  {chain ? (chain.valid ? "Hash chain verified" : "Hash chain integrity failure") : "Verifying hash chain…"}
                </p>
                <p className="mt-0.5 text-[11px] text-ink-faint">
                  {chain
                    ? `${chain.checked_events} records checked · ${chain.message}`
                    : "Recomputing every link from the genesis record."}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              icon={<Fingerprint className="h-3.5 w-3.5" />}
              onClick={() => {
                void integrity.refetch().then((result) => {
                  const valid = result.data?.valid;
                  toast(
                    valid ? "Integrity verified" : "Integrity failure",
                    valid ? "success" : "error",
                    result.data?.message ?? "The chain check did not return a result.",
                  );
                });
              }}
              loading={integrity.isFetching}
            >
              Verify now
            </Button>
          </div>
          {chain?.first_invalid_event_id ? (
            <p className="border-t border-signal-red/20 bg-signal-red/[0.06] px-5 py-2.5 text-[11px] text-signal-red">
              First invalid record: #{chain.first_invalid_event_id}. Treat the Chronicle as compromised and investigate
              before relying on it.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-white/[0.05] px-5 py-2.5 text-[10.5px] text-ink-faint">
              <span className="inline-flex items-center gap-1.5">
                <Link2 className="h-3 w-3 text-lime" /> SHA-256 linked
              </span>
              <span className="inline-flex items-center gap-1.5">
                <ScrollText className="h-3 w-3 text-cyan" /> Append-only
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Fingerprint className="h-3 w-3 text-signal-violet" /> No update or delete path
              </span>
            </div>
          )}
        </Panel>

        <Panel className="px-5 py-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-signal-violet" />
            <p className="text-[12.5px] font-medium text-ink">What this proves</p>
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-ink-muted">
            {beginner
              ? "Imagine a notebook where every new page starts by copying the fingerprint of the page before it. If someone tears out or edits a page, the fingerprints no longer line up."
              : "Each record commits to its predecessor's digest. Verification recomputes the chain; any edit, deletion or reordering changes subsequent hashes and is detected."}
          </p>
          <div className="mt-3 flex items-center gap-2 text-[10px] text-ink-faint">
            <span className="mono rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5">
              prev_hash
            </span>
            <ArrowRight className="h-3 w-3" />
            <span className="mono rounded border border-lime/20 bg-lime/[0.05] px-1.5 py-0.5 text-lime">
              hash
            </span>
            <ArrowRight className="h-3 w-3" />
            <span className="mono rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5">
              next
            </span>
          </div>
        </Panel>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <SearchInput
          value={searchText}
          onChange={setSearchText}
          placeholder="Search actor, action, resource…"
          className="w-full sm:w-[300px]"
        />
        <Select
          value={action}
          onChange={(event) => {
            setAction(event.target.value);
            setPage(1);
          }}
          className="h-10 w-[190px] text-[12.5px]"
        >
          <option value="">All actions</option>
          {actionOptions.map((entry) => (
            <option key={entry.action} value={entry.action}>
              {humanize(entry.action)} ({entry.count})
            </option>
          ))}
        </Select>
        <Select
          value={resourceType}
          onChange={(event) => {
            setResourceType(event.target.value);
            setPage(1);
          }}
          className="h-10 w-[160px] text-[12.5px]"
        >
          <option value="">All resources</option>
          {resourceTypes.map((entry) => (
            <option key={entry} value={entry}>
              {humanize(entry)}
            </option>
          ))}
        </Select>
        <Select
          value={outcome}
          onChange={(event) => {
            setOutcome(event.target.value);
            setPage(1);
          }}
          className="h-10 w-[150px] text-[12.5px]"
        >
          {OUTCOMES.map((entry) => (
            <option key={entry} value={entry}>
              {entry === "ALL" ? "All outcomes" : humanize(entry)}
            </option>
          ))}
        </Select>
        {(action || resourceType || outcome !== "ALL" || search) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setAction("");
              setResourceType("");
              setOutcome("ALL");
              setSearchText("");
              setSearch("");
              setPage(1);
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      <div className="mt-4">
        {events.isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map((key) => (
              <Skeleton key={key} className="h-[66px] w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <Panel>
            <EmptyState
              icon={<ScrollText className="h-5 w-5" />}
              title="No records match these filters"
              description="The Chronicle only contains actions that actually happened. Widen the filters to see more."
            />
          </Panel>
        ) : (
          <Panel className="overflow-hidden">
            {grouped.map((group, groupIndex) => (
              <div key={group.day}>
                <div
                  className={cn(
                    "flex items-center gap-2 bg-obsidian-900/70 px-5 py-2",
                    groupIndex > 0 && "border-t border-white/[0.06]",
                  )}
                >
                  <CalendarDays className="h-3 w-3 text-ink-faint" />
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">{group.day}</p>
                  <span className="text-[10px] text-ink-faint">· {group.events.length} records</span>
                </div>
                <ul className="divide-y divide-white/[0.04]">
                  {group.events.map((event) => (
                    <LedgerRow
                      key={event.id}
                      event={event}
                      open={openId === event.id}
                      onToggle={() => setOpenId(openId === event.id ? null : event.id)}
                    />
                  ))}
                </ul>
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] px-5 py-3">
              <p className="text-[10.5px] text-ink-faint">
                Page {events.data?.page ?? 1} of {totalPages} · {events.data?.total ?? 0} records
              </p>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((value) => value + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </Panel>
        )}
      </div>

      <p className="mt-5 text-[10.5px] leading-relaxed text-ink-faint">
        The application exposes no update or delete path for audit records. Exports preserve the stored hashes and
        include the integrity report so they can be verified independently.
      </p>
    </div>
  );
}

function LedgerRow({ event, open, onToggle }: { event: AuditEvent; open: boolean; onToggle: () => void }) {
  const tone = outcomeTone(event.outcome);
  const palette = toneClasses[tone];
  const isSystem = !event.actor_id;
  return (
    <li className="transition hover:bg-white/[0.015]">
      <button onClick={onToggle} className="flex w-full items-start gap-3 px-4 py-3 text-left sm:px-5">
        <div className="relative mt-0.5 flex flex-col items-center">
          <span className={cn("h-2 w-2 rounded-full ring-4 ring-obsidian-800", palette.dot)} />
          <span className="mt-1 h-6 w-px bg-white/[0.07]" />
        </div>
        <span className="mono mt-0.5 w-12 shrink-0 text-[10px] text-ink-faint">#{event.id}</span>
        <span className="mt-0.5 w-[70px] shrink-0 text-[10.5px] text-ink-faint">
          {formatDate(event.created_at, "HH:mm:ss")}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[12px] font-medium text-ink">{humanize(event.action)}</p>
            <Badge tone={tone} dot>
              {humanize(event.outcome)}
            </Badge>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-ink-faint">
            <span className="inline-flex items-center gap-1">
              {isSystem ? <Sparkles className="h-2.5 w-2.5" /> : <UserRound className="h-2.5 w-2.5" />}
              {event.actor_label || "System"}
            </span>
            <span>·</span>
            <span>{humanize(event.resource_type)}</span>
            {event.resource_id ? (
              <>
                <span>·</span>
                {event.resource_type === "execution" ? (
                  <Link
                    href={`/executions/${event.resource_id}`}
                    onClick={(clickEvent) => clickEvent.stopPropagation()}
                    className="mono text-ink-muted underline-offset-2 transition hover:text-lime hover:underline"
                  >
                    {shortenHash(event.resource_id, 8)}
                  </Link>
                ) : (
                  <span className="mono">{shortenHash(event.resource_id, 8)}</span>
                )}
              </>
            ) : null}
            <span>·</span>
            <span className="mono">{shortenHash(event.hash, 7)}</span>
          </div>
        </div>
        <ChevronDown className={cn("mt-1 h-4 w-4 shrink-0 text-ink-faint transition", open && "rotate-180")} />
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
            <div className="grid gap-3 px-5 pb-4 pl-[76px] sm:grid-cols-[minmax(0,1fr)_280px] sm:pl-[92px]">
              <div>
                <p className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Details</p>
                <pre className="scroll-fade mono mt-1.5 max-h-[220px] overflow-auto rounded-lg border border-white/[0.07] bg-obsidian-950/70 px-3 py-2.5 text-[10.5px] leading-relaxed text-ink-muted">
                  {JSON.stringify(event.details ?? {}, null, 2)}
                </pre>
              </div>
              <div className="space-y-1.5">
                <p className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Chain link</p>
                <ChainRow label="Record hash" value={event.hash} />
                <ChainRow label="Previous hash" value={event.prev_hash || "genesis"} />
                <div className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5">
                  <span className="text-[10px] text-ink-faint">Client IP</span>
                  <span className="mono text-[10px] text-ink-muted">{event.ip_address || "—"}</span>
                </div>
                <div className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5">
                  <span className="text-[10px] text-ink-faint">Recorded</span>
                  <span className="text-[10px] text-ink-muted">{formatDate(event.created_at)}</span>
                </div>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </li>
  );
}

function ChainRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5">
      <span className="shrink-0 text-[10px] text-ink-faint">{label}</span>
      <span className="mono inline-flex min-w-0 items-center gap-1 text-[10px] text-ink-muted">
        <span className="truncate">{shortenHash(value, 8)}</span>
        {value && value !== "genesis" ? <CopyButton value={value} /> : null}
      </span>
    </div>
  );
}
