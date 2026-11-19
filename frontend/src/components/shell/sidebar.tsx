"use client";

import { motion } from "framer-motion";
import { ChevronsLeft, ChevronsRight, PanelLeftClose, PanelLeftOpen, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Skeleton } from "@/components/ui/primitives";
import { useSystemHealth } from "@/lib/hooks";
import { can, navSections } from "@/lib/nav";
import { cn, statusTone, toneClasses } from "@/lib/utils";
import type { User } from "@/lib/types";

export function BrandMark({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <Link href="/" className="group flex items-center gap-2.5 overflow-hidden">
      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-lime/30 bg-gradient-to-br from-lime/20 to-lime/[0.04] text-[15px] font-bold tracking-tight text-lime shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
        J
        <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-lime shadow-[0_0_10px_#D6FF76]" />
      </span>
      {collapsed ? null : (
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold tracking-[0.22em] text-ink">JUNE</span>
          <span className="block whitespace-nowrap text-[9.5px] uppercase tracking-[0.14em] text-ink-faint">
            Control plane
          </span>
        </span>
      )}
    </Link>
  );
}

export function Sidebar({
  user,
  pendingApprovals,
  collapsed,
  onToggleCollapse,
  onNavigate,
}: {
  user: User;
  pendingApprovals: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const health = useSystemHealth();
  const healthStatus = health.data?.status ?? "UNKNOWN";
  const tone = statusTone(healthStatus);
  const beginner = Boolean(user.preferences?.beginner_mode);

  return (
    <aside
      className={cn(
        "flex h-full flex-col border-r border-white/[0.06] bg-obsidian-900/90 backdrop-blur-md transition-[width] duration-300",
        collapsed ? "w-[76px]" : "w-[252px]",
      )}
    >
      <div className={cn("flex h-16 shrink-0 items-center", collapsed ? "justify-center px-3" : "justify-between px-4")}>
        <BrandMark collapsed={collapsed} />
        {collapsed ? null : (
          <button
            onClick={onToggleCollapse}
            className="rounded-lg p-1.5 text-ink-faint transition hover:bg-white/5 hover:text-ink"
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        )}
      </div>

      {collapsed ? (
        <button
          onClick={onToggleCollapse}
          className="mx-auto mb-3 rounded-lg p-1.5 text-ink-faint transition hover:bg-white/5 hover:text-ink"
          title="Expand sidebar"
          aria-label="Expand sidebar"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
      ) : (
        <div className="mx-3 mb-4 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
          <p className="text-[11px] font-medium text-ink">{user.team?.name ?? "Platform Engineering"}</p>
          <p className="mt-0.5 truncate text-[10.5px] text-ink-faint">{user.role.name}</p>
        </div>
      )}

      <nav className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2.5 pb-4">
        {navSections.map((section) => {
          const entries = section.entries.filter((entry) => can(user.permissions, entry.permission));
          if (!entries.length) return null;
          return (
            <div key={section.label} className="mb-4">
              {collapsed ? (
                <div className="mx-auto mb-2 h-px w-8 bg-white/[0.07]" />
              ) : (
                <p className="mb-1.5 px-2.5 text-[9.5px] font-semibold uppercase tracking-[0.18em] text-ink-faint/80">
                  {section.label}
                </p>
              )}
              <div className="space-y-0.5">
                {entries.map((entry) => {
                  const active =
                    entry.href === "/" ? pathname === "/" : pathname.startsWith(entry.href);
                  const Icon = entry.icon;
                  return (
                    <Link
                      key={entry.href}
                      href={entry.href}
                      onClick={onNavigate}
                      title={collapsed ? entry.label : undefined}
                      className={cn(
                        "group relative flex items-center rounded-xl text-[13px] transition-colors",
                        collapsed ? "justify-center px-0 py-2.5" : "gap-2.5 px-2.5 py-2",
                        active ? "text-ink" : "text-ink-muted hover:text-ink",
                      )}
                    >
                      {active ? (
                        <motion.span
                          layoutId="sidebar-active"
                          className="absolute inset-0 rounded-xl border border-white/[0.09] bg-white/[0.06]"
                          transition={{ type: "spring", stiffness: 420, damping: 36 }}
                        />
                      ) : (
                        <span className="absolute inset-0 rounded-xl bg-white/0 transition-colors group-hover:bg-white/[0.035]" />
                      )}
                      {active ? (
                        <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-lime shadow-[0_0_8px_rgba(214,255,118,0.8)]" />
                      ) : null}
                      <Icon
                        className={cn(
                          "relative z-10 h-[16px] w-[16px] shrink-0",
                          active ? "text-lime" : "text-ink-faint group-hover:text-ink-muted",
                        )}
                      />
                      {collapsed ? null : (
                        <span className="relative z-10 flex-1 truncate font-medium">{entry.label}</span>
                      )}
                      {entry.badge === "approvals" && pendingApprovals > 0 ? (
                        <span
                          className={cn(
                            "relative z-10 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-semibold",
                            collapsed
                              ? "absolute -right-0.5 -top-0.5"
                              : "border border-signal-amber/30 bg-signal-amber/15 text-signal-amber",
                          )}
                        >
                          {pendingApprovals > 99 ? "99+" : pendingApprovals}
                        </span>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className={cn("shrink-0 border-t border-white/[0.06] p-3", collapsed && "px-2")}>
        {collapsed ? (
          <Link
            href="/admin"
            title={`System ${healthStatus.toLowerCase()}`}
            className="mx-auto flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.02]"
          >
            {health.isLoading ? (
              <Skeleton className="h-2.5 w-2.5 rounded-full" />
            ) : (
              <span className={cn("h-2 w-2 rounded-full", toneClasses[tone].dot)} />
            )}
          </Link>
        ) : (
          <Link
            href="/admin"
            className="block rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 transition hover:border-white/10 hover:bg-white/[0.04]"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
                Control plane
              </span>
              {health.isLoading ? (
                <Skeleton className="h-3 w-10" />
              ) : (
                <span className="inline-flex items-center gap-1.5 text-[10.5px] font-medium text-ink-muted">
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      toneClasses[tone].dot,
                      healthStatus === "HEALTHY" && "animate-pulse-dot",
                    )}
                  />
                  {healthStatus === "HEALTHY" ? "Healthy" : healthStatus.toLowerCase()}
                </span>
              )}
            </div>
            <p className="mt-1 text-[10.5px] text-ink-faint">
              {health.data?.version ? `v${health.data.version} · ` : ""}
              {health.data?.environment ?? "local"}
            </p>
          </Link>
        )}

        {!collapsed && beginner ? (
          <div className="mt-2 flex items-start gap-2 rounded-xl border border-lime/15 bg-lime/[0.045] px-3 py-2">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lime" />
            <p className="text-[10.5px] leading-relaxed text-ink-muted">
              Beginner mode is on — look for the plain-English explanations beside each control.
            </p>
          </div>
        ) : null}

        {!collapsed ? (
          <button
            onClick={onToggleCollapse}
            className="mt-2 hidden w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] text-ink-faint transition hover:bg-white/5 hover:text-ink lg:flex"
          >
            <ChevronsLeft className="h-3.5 w-3.5" />
            Collapse navigation
          </button>
        ) : (
          <button
            onClick={onToggleCollapse}
            className="mx-auto mt-2 hidden rounded-lg p-1.5 text-ink-faint transition hover:bg-white/5 hover:text-ink lg:block"
            aria-label="Expand navigation"
          >
            <ChevronsRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </aside>
  );
}
