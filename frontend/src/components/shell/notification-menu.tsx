"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Bell, CheckCheck, Inbox } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { EmptyState, Skeleton } from "@/components/ui/primitives";
import { useMarkNotification, useNotifications, useUnreadCount } from "@/lib/hooks";
import { cn, relative, toneClasses } from "@/lib/utils";
import type { Notification } from "@/lib/types";

function destination(notification: Notification): string | null {
  if (!notification.resource_type || !notification.resource_id) return null;
  if (notification.resource_type === "execution") return `/executions/${notification.resource_id}`;
  if (notification.resource_type === "approval") return "/approvals";
  if (notification.resource_type === "security_scan") return "/security";
  if (notification.resource_type === "automation") return `/automations/${notification.resource_id}`;
  return null;
}

function notificationTone(kind: string): string {
  const key = kind.toLowerCase();
  if (key.includes("fail") || key.includes("block") || key.includes("reject")) return "red";
  if (key.includes("approval") || key.includes("pending")) return "amber";
  if (key.includes("success") || key.includes("complete")) return "lime";
  if (key.includes("scan") || key.includes("security")) return "cyan";
  return "slate";
}

export function NotificationMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const notifications = useNotifications();
  const unread = useUnreadCount();
  const mark = useMarkNotification();

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

  const items = notifications.data?.items ?? [];
  const count = unread.data?.unread ?? 0;

  function openNotification(notification: Notification) {
    if (!notification.read_at) mark.mutate({ id: notification.id });
    const href = destination(notification);
    if (href) {
      setOpen(false);
      router.push(href);
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "relative flex h-9 w-9 items-center justify-center rounded-xl border border-transparent text-ink-muted transition hover:border-white/10 hover:bg-white/[0.05] hover:text-ink",
          open && "border-white/10 bg-white/[0.06] text-ink",
        )}
        aria-label={`Notifications${count ? `, ${count} unread` : ""}`}
        aria-expanded={open}
      >
        <Bell className="h-[17px] w-[17px]" />
        {count > 0 ? (
          <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-obsidian-900 bg-lime px-1 text-[9px] font-bold text-obsidian-950">
            {count > 9 ? "9+" : count}
          </span>
        ) : null}
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.99 }}
            transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
            className="absolute right-0 top-11 z-50 w-[380px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-white/10 bg-obsidian-850/97 shadow-lift backdrop-blur-2xl"
          >
            <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-cyan/40 to-transparent" />
            <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
              <div>
                <p className="text-[13px] font-semibold text-ink">Notifications</p>
                <p className="text-[11px] text-ink-faint">
                  {count ? `${count} unread` : "You are all caught up"}
                </p>
              </div>
              <button
                onClick={() => mark.mutate({ all: true })}
                disabled={!count || mark.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium text-ink-muted transition hover:bg-white/5 hover:text-ink disabled:opacity-40"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Mark all read
              </button>
            </div>

            <div className="max-h-[420px] overflow-y-auto">
              {notifications.isLoading ? (
                <div className="space-y-2 p-3">
                  {[0, 1, 2].map((index) => (
                    <Skeleton key={index} className="h-16 w-full" />
                  ))}
                </div>
              ) : items.length === 0 ? (
                <EmptyState
                  icon={<Inbox className="h-5 w-5" />}
                  title="Nothing needs your attention"
                  description="Approval requests, execution outcomes and security alerts will appear here."
                  className="py-10"
                />
              ) : (
                <ul className="divide-y divide-white/[0.05]">
                  {items.map((notification) => {
                    const tone = notificationTone(notification.kind);
                    return (
                      <li key={notification.id}>
                        <button
                          onClick={() => openNotification(notification)}
                          className={cn(
                            "flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-white/[0.035]",
                            !notification.read_at && "bg-white/[0.02]",
                          )}
                        >
                          <span
                            className={cn(
                              "mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border",
                              toneClasses[tone as keyof typeof toneClasses]?.bg ?? "bg-white/5",
                              toneClasses[tone as keyof typeof toneClasses]?.border ?? "border-white/10",
                            )}
                          >
                            <Bell
                              className={cn(
                                "h-3.5 w-3.5",
                                toneClasses[tone as keyof typeof toneClasses]?.text ?? "text-ink-muted",
                              )}
                            />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-start justify-between gap-2">
                              <span className="text-[12.5px] font-medium leading-snug text-ink">
                                {notification.title}
                              </span>
                              <span className="shrink-0 text-[10px] text-ink-faint">
                                {relative(notification.created_at)}
                              </span>
                            </span>
                            <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-muted">
                              {notification.body}
                            </span>
                          </span>
                          {!notification.read_at ? (
                            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-lime" />
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
