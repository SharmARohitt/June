"use client";

import { AnimatePresence, motion } from "framer-motion";
import { BookOpen, ChevronDown, CircleHelp, LogOut, Settings2, Sparkles, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Avatar, Button, Modal, Toggle } from "@/components/ui/primitives";
import { useLogout, useUpdatePreferences } from "@/lib/hooks";
import { useUiStore, toast } from "@/lib/stores";
import { cn } from "@/lib/utils";
import type { User } from "@/lib/types";

export function UserMenu({ user }: { user: User }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const logout = useLogout();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function signOut() {
    try {
      await logout.mutateAsync();
    } finally {
      setOpen(false);
      router.replace("/login");
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex items-center gap-2 rounded-xl border border-transparent py-1 pl-1 pr-2 transition hover:border-white/10 hover:bg-white/[0.05]",
          open && "border-white/10 bg-white/[0.06]",
        )}
        aria-label="Account menu"
        aria-expanded={open}
      >
        <Avatar name={user.full_name} size={30} />
        <span className="hidden text-left sm:block">
          <span className="block max-w-[140px] truncate text-[12.5px] font-medium leading-tight text-ink">
            {user.full_name}
          </span>
          <span className="block max-w-[140px] truncate text-[10.5px] leading-tight text-ink-faint">
            {user.role.name}
          </span>
        </span>
        <ChevronDown className={cn("h-3.5 w-3.5 text-ink-faint transition-transform", open && "rotate-180")} />
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.99 }}
            transition={{ duration: 0.16 }}
            className="absolute right-0 top-11 z-50 w-[268px] overflow-hidden rounded-2xl border border-white/10 bg-obsidian-850/97 shadow-lift backdrop-blur-2xl"
          >
            <div className="border-b border-white/[0.06] px-4 py-3.5">
              <div className="flex items-center gap-3">
                <Avatar name={user.full_name} size={38} />
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-ink">{user.full_name}</p>
                  <p className="truncate text-[11.5px] text-ink-faint">{user.email}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className="chip text-ink-muted">{user.role.name}</span>
                {user.team ? <span className="chip text-ink-faint">{user.team.name}</span> : null}
              </div>
            </div>
            <div className="p-1.5">
              <MenuItem
                icon={<Settings2 className="h-4 w-4" />}
                label="Preferences"
                hint="Beginner mode, motion, density"
                onClick={() => {
                  setOpen(false);
                  setPreferencesOpen(true);
                }}
              />
              <MenuItem
                icon={<CircleHelp className="h-4 w-4" />}
                label="Help Center"
                hint="How JUNE works, in plain English"
                onClick={() => {
                  setOpen(false);
                  router.push("/help");
                }}
              />
              <MenuItem
                icon={<BookOpen className="h-4 w-4" />}
                label="Your permissions"
                hint={`${user.permissions.length} capabilities granted`}
                onClick={() => {
                  setOpen(false);
                  router.push("/help#permissions");
                }}
              />
            </div>
            <div className="border-t border-white/[0.06] p-1.5">
              <button
                onClick={signOut}
                disabled={logout.isPending}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[12.5px] font-medium text-ink-muted transition hover:bg-signal-red/10 hover:text-signal-red disabled:opacity-50"
              >
                <LogOut className="h-4 w-4" />
                {logout.isPending ? "Signing out…" : "Sign out"}
              </button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <PreferencesDialog
        open={preferencesOpen}
        onClose={() => setPreferencesOpen(false)}
        user={user}
        onOpenBeginner={() => {
          setPreferencesOpen(false);
          useUiStore.getState().setCommandOpen(false);
        }}
      />
    </div>
  );
}

function MenuItem({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-start gap-2.5 rounded-xl px-3 py-2 text-left transition hover:bg-white/[0.045]"
    >
      <span className="mt-0.5 text-ink-faint">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[12.5px] font-medium text-ink">{label}</span>
        <span className="block truncate text-[10.5px] text-ink-faint">{hint}</span>
      </span>
    </button>
  );
}

function PreferencesDialog({
  open,
  onClose,
  user,
  onOpenBeginner,
}: {
  open: boolean;
  onClose: () => void;
  user: User;
  onOpenBeginner: () => void;
}) {
  const update = useUpdatePreferences();
  const [beginner, setBeginner] = useState(Boolean(user.preferences?.beginner_mode));
  const [reduceMotion, setReduceMotion] = useState(Boolean(user.preferences?.reduce_motion));
  const [density, setDensity] = useState<"comfortable" | "compact">(
    user.preferences?.density === "compact" ? "compact" : "comfortable",
  );

  useEffect(() => {
    if (open) {
      setBeginner(Boolean(user.preferences?.beginner_mode));
      setReduceMotion(Boolean(user.preferences?.reduce_motion));
      setDensity(user.preferences?.density === "compact" ? "compact" : "comfortable");
    }
  }, [open, user.preferences]);

  async function save() {
    try {
      await update.mutateAsync({ beginner_mode: beginner, reduce_motion: reduceMotion, density });
      document.documentElement.dataset.reduceMotion = String(reduceMotion);
      document.body.dataset.density = density;
      toast("Preferences saved", "success", "JUNE will remember how you like to work.");
      onClose();
    } catch {
      toast("Could not save preferences", "error", "Please try again.");
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Your preferences"
      description="These settings are stored against your account and follow you across sessions."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={update.isPending}>
            Save preferences
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="rounded-xl border border-lime/15 bg-lime/[0.04] p-4">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-lime" />
            <p className="text-[12.5px] leading-relaxed text-ink-muted">
              Beginner mode adds a plain-English explanation to every important control: what it does, what it
              affects, and what to do if it fails. Turn it off once you know your way around.
            </p>
          </div>
        </div>

        <div className="space-y-4 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
          <Toggle
            checked={beginner}
            onChange={setBeginner}
            label="Beginner mode"
            description="Show guided explanations and safer default choices."
          />
          <div className="h-px bg-white/[0.06]" />
          <Toggle
            checked={reduceMotion}
            onChange={setReduceMotion}
            label="Reduce motion"
            description="Disable decorative animation and transitions."
          />
          <div className="h-px bg-white/[0.06]" />
          <div>
            <p className="text-sm font-medium text-ink">Information density</p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-muted">
              Compact fits more rows on screen. Comfortable gives every row more breathing room.
            </p>
            <div className="mt-3 inline-flex rounded-lg border border-white/10 bg-obsidian-900/70 p-0.5">
              {(["comfortable", "compact"] as const).map((option) => (
                <button
                  key={option}
                  onClick={() => setDensity(option)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-[12px] font-medium capitalize transition",
                    density === option ? "bg-white/10 text-ink" : "text-ink-faint hover:text-ink-muted",
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.07] p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">Signed in as</p>
          <p className="mt-2 flex items-center gap-2 text-[13px] text-ink">
            <UserRound className="h-4 w-4 text-ink-faint" />
            {user.full_name} · {user.email}
          </p>
          <p className="mt-1 text-[11.5px] text-ink-faint">
            {user.role.name}
            {user.team ? ` · ${user.team.name}` : ""}
          </p>
          <button
            onClick={onOpenBeginner}
            className="mt-3 text-[11.5px] font-medium text-cyan transition hover:text-cyan/80"
          >
            Open the guided tour from the Help Center instead
          </button>
        </div>
      </div>
    </Modal>
  );
}
