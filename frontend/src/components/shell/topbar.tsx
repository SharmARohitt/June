"use client";

import { Menu, Search, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { CommandPalette } from "@/components/shell/command-palette";
import { NotificationMenu } from "@/components/shell/notification-menu";
import { UserMenu } from "@/components/shell/profile-menu";
import { Kbd } from "@/components/ui/primitives";
import { useUiStore } from "@/lib/stores";
import { activeEntry } from "@/lib/nav";
import type { User } from "@/lib/types";

export function Topbar({ user }: { user: User }) {
  const pathname = usePathname();
  const entry = activeEntry(pathname);
  const setCommandOpen = useUiStore((state) => state.setCommandOpen);
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen);

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-white/[0.06] bg-obsidian-950/75 px-4 backdrop-blur-md lg:px-6">
      <button
        onClick={() => setMobileNavOpen(true)}
        className="flex h-9 w-9 items-center justify-center rounded-xl border border-transparent text-ink-muted transition hover:border-white/10 hover:bg-white/5 hover:text-ink lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[10.5px] text-ink-faint">
          <span className="hidden uppercase tracking-[0.16em] sm:block">JUNE</span>
          <span className="hidden text-ink-faint/50 sm:block">/</span>
          <span className="truncate uppercase tracking-[0.14em]">{entry?.label ?? "Workspace"}</span>
        </div>
        <p className="truncate text-[13.5px] font-medium text-ink">
          {entry?.description ?? "Governed automation, end to end."}
        </p>
      </div>

      <button
        onClick={() => setCommandOpen(true)}
        className="group hidden h-9 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.025] pl-3 pr-2 text-[12.5px] text-ink-faint transition hover:border-white/15 hover:bg-white/[0.05] hover:text-ink-muted md:flex md:w-[248px]"
        aria-label="Search JUNE"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-left">Search or jump to…</span>
        <Kbd>⌘K</Kbd>
      </button>

      <button
        onClick={() => setCommandOpen(true)}
        className="flex h-9 w-9 items-center justify-center rounded-xl text-ink-muted transition hover:bg-white/5 hover:text-ink md:hidden"
        aria-label="Search JUNE"
      >
        <Search className="h-[18px] w-[18px]" />
      </button>

      <Link
        href="/automations"
        className="hidden h-9 items-center gap-1.5 rounded-xl border border-lime/30 bg-lime/[0.08] px-3 text-[12px] font-medium text-lime transition hover:bg-lime/[0.14] sm:flex"
      >
        <Sparkles className="h-3.5 w-3.5" />
        Run an automation
      </Link>

      <div className="mx-0.5 h-6 w-px bg-white/[0.07]" />

      <NotificationMenu />
      <UserMenu user={user} />
      <CommandPalette user={user} />
    </header>
  );
}
