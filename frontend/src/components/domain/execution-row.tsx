"use client";

import { motion } from "framer-motion";
import { ArrowUpRight, Clock3 } from "lucide-react";
import Link from "next/link";

import { StatusPill } from "@/components/ui/primitives";
import { automationIcon, cn, duration, relative } from "@/lib/utils";
import type { ExecutionSummary } from "@/lib/types";
import { EnvBadge } from "@/components/domain/env-badge";

export function ExecutionRow({
  execution,
  compact = false,
}: {
  execution: ExecutionSummary;
  compact?: boolean;
}) {
  const Icon = automationIcon(execution.automation.icon);
  const running = execution.status === "RUNNING" || execution.status === "QUEUED";
  return (
    <Link
      href={`/executions/${execution.id}`}
      className={cn(
        "group relative flex items-center gap-3 rounded-xl border border-transparent px-3 transition-colors hover:border-white/[0.07] hover:bg-white/[0.03]",
        compact ? "py-2.5" : "py-3",
      )}
    >
      <span
        className={cn(
          "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-ink-muted transition group-hover:border-white/[0.14] group-hover:text-ink",
          running && "border-cyan/25 bg-cyan/[0.07] text-cyan",
        )}
      >
        <Icon className="h-[15px] w-[15px]" />
        {running ? (
          <motion.span
            className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-cyan"
            animate={{ opacity: [1, 0.35, 1] }}
            transition={{ duration: 1.8, repeat: Infinity }}
          />
        ) : null}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-ink">{execution.automation.name}</span>
          <span className="mono hidden shrink-0 text-[10px] text-ink-faint sm:block">{execution.display_id}</span>
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-faint">
          <EnvBadge environment={execution.environment} showMode={false} />
          <span className="text-ink-faint/60">·</span>
          <span className="truncate">{execution.requested_by_user.full_name}</span>
          <span className="text-ink-faint/60">·</span>
          <span className="inline-flex items-center gap-1">
            <Clock3 className="h-2.5 w-2.5" />
            {relative(execution.created_at)}
          </span>
          {execution.duration_ms !== null ? (
            <>
              <span className="text-ink-faint/60">·</span>
              <span className="mono">{duration(execution.duration_ms)}</span>
            </>
          ) : null}
        </span>
      </span>

      <span className="flex shrink-0 items-center gap-2">
        <StatusPill status={execution.status} />
        <ArrowUpRight className="h-3.5 w-3.5 text-ink-faint opacity-0 transition group-hover:opacity-100" />
      </span>
    </Link>
  );
}
