"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, CornerDownLeft, Search, Workflow } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Kbd } from "@/components/ui/primitives";
import { useAllAutomations } from "@/lib/hooks";
import { allNavEntries, can } from "@/lib/nav";
import { automationIcon, cn } from "@/lib/utils";
import { useUiStore } from "@/lib/stores";
import type { User } from "@/lib/types";

interface Result {
  key: string;
  label: string;
  hint: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  group: string;
}

export function CommandPalette({ user }: { user: User }) {
  const router = useRouter();
  const open = useUiStore((state) => state.commandOpen);
  const setOpen = useUiStore((state) => state.setCommandOpen);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const automations = useAllAutomations();

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const results = useMemo<Result[]>(() => {
    const needle = query.trim().toLowerCase();
    const pages: Result[] = allNavEntries
      .filter((entry) => can(user.permissions, entry.permission))
      .filter((entry) => !needle || `${entry.label} ${entry.description}`.toLowerCase().includes(needle))
      .map((entry) => ({
        key: `page-${entry.href}`,
        label: entry.label,
        hint: entry.description,
        href: entry.href,
        icon: entry.icon,
        group: "Pages",
      }));

    const automationResults: Result[] = (automations.data?.items ?? [])
      .filter((automation) => !needle || `${automation.name} ${automation.summary} ${automation.category}`.toLowerCase().includes(needle))
      .slice(0, needle ? 6 : 4)
      .map((automation) => ({
        key: `automation-${automation.id}`,
        label: automation.name,
        hint: `${automation.category} · ${automation.risk_level.toLowerCase()} risk`,
        href: `/automations/${automation.slug}`,
        icon: automationIcon(automation.icon),
        group: "Automations",
      }));

    return [...pages, ...automationResults];
  }, [query, user.permissions, automations.data]);

  useEffect(() => {
    setCursor((value) => Math.min(value, Math.max(0, results.length - 1)));
  }, [results.length]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setCursor((value) => (results.length ? (value + 1) % results.length : 0));
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setCursor((value) => (results.length ? (value - 1 + results.length) % results.length : 0));
      }
      if (event.key === "Enter" && results[cursor]) {
        event.preventDefault();
        setOpen(false);
        router.push(results[cursor].href);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, results, cursor, router, setOpen]);

  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`);
    active?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const grouped = useMemo(() => {
    const map = new Map<string, { result: Result; index: number }[]>();
    results.forEach((result, index) => {
      const bucket = map.get(result.group) ?? [];
      bucket.push({ result, index });
      map.set(result.group, bucket);
    });
    return [...map.entries()];
  }, [results]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[90] flex items-start justify-center px-4 pt-[12vh]">
          <motion.div
            className="absolute inset-0 bg-obsidian-950/70 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          />
          <motion.div
            initial={{ opacity: 0, y: -14, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.99 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className="relative z-10 w-full max-w-[620px] overflow-hidden rounded-2xl border border-white/12 bg-obsidian-850/97 shadow-lift backdrop-blur-2xl"
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
          >
            <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-lime/50 to-transparent" />
            <div className="flex items-center gap-3 border-b border-white/[0.07] px-4">
              <Search className="h-4 w-4 shrink-0 text-ink-faint" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search pages and automations…"
                className="h-14 w-full bg-transparent text-[14.5px] text-ink outline-none placeholder:text-ink-faint"
              />
              <Kbd>esc</Kbd>
            </div>

            <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
              {grouped.length === 0 ? (
                <div className="px-3 py-10 text-center">
                  <p className="text-[13px] font-medium text-ink">No matches</p>
                  <p className="mt-1 text-[12px] text-ink-muted">
                    Try an automation name, &ldquo;approvals&rdquo;, &ldquo;security&rdquo; or &ldquo;audit&rdquo;.
                  </p>
                </div>
              ) : (
                grouped.map(([group, entries]) => (
                  <div key={group} className="mb-1.5">
                    <p className="px-3 pb-1 pt-2 text-[9.5px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
                      {group}
                    </p>
                    {entries.map(({ result, index }) => {
                      const Icon = result.icon ?? Workflow;
                      const active = index === cursor;
                      return (
                        <button
                          key={result.key}
                          data-index={index}
                          onMouseEnter={() => setCursor(index)}
                          onClick={() => {
                            setOpen(false);
                            router.push(result.href);
                          }}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                            active ? "bg-white/[0.07]" : "hover:bg-white/[0.035]",
                          )}
                        >
                          <span
                            className={cn(
                              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
                              active ? "border-lime/25 bg-lime/10 text-lime" : "border-white/8 bg-white/[0.03] text-ink-muted",
                            )}
                          >
                            <Icon className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium text-ink">{result.label}</span>
                            <span className="block truncate text-[11.5px] text-ink-faint">{result.hint}</span>
                          </span>
                          {active ? <ArrowRight className="h-3.5 w-3.5 shrink-0 text-lime" /> : null}
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center justify-between border-t border-white/[0.06] bg-obsidian-900/60 px-4 py-2.5">
              <div className="flex items-center gap-3 text-[10.5px] text-ink-faint">
                <span className="inline-flex items-center gap-1">
                  <Kbd>↑</Kbd>
                  <Kbd>↓</Kbd> navigate
                </span>
                <span className="inline-flex items-center gap-1">
                  <Kbd>
                    <CornerDownLeft className="h-2.5 w-2.5" />
                  </Kbd>
                  open
                </span>
              </div>
              <span className="text-[10.5px] text-ink-faint">JUNE command palette</span>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
