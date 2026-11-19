"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";

import { useToastStore, type ToastTone } from "@/lib/stores";
import { cn } from "@/lib/utils";

const toneMap: Record<ToastTone, { icon: typeof Info; className: string; iconClass: string }> = {
  success: { icon: CheckCircle2, className: "border-lime/25", iconClass: "text-lime" },
  error: { icon: XCircle, className: "border-signal-red/30", iconClass: "text-signal-red" },
  warning: { icon: AlertTriangle, className: "border-signal-amber/30", iconClass: "text-signal-amber" },
  info: { icon: Info, className: "border-cyan/25", iconClass: "text-cyan" },
};

export function Toaster() {
  const { toasts, dismiss } = useToastStore();
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[120] flex w-[380px] max-w-[calc(100vw-2.5rem)] flex-col gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          const meta = toneMap[toast.tone];
          const Icon = meta.icon;
          return (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
              className={cn(
                "pointer-events-auto flex items-start gap-3 rounded-xl border bg-obsidian-800/95 px-4 py-3.5 shadow-lift backdrop-blur-xl",
                meta.className,
              )}
            >
              <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", meta.iconClass)} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-ink">{toast.title}</p>
                {toast.description ? (
                  <p className="mt-0.5 text-[12px] leading-relaxed text-ink-muted">{toast.description}</p>
                ) : null}
              </div>
              <button
                onClick={() => dismiss(toast.id)}
                className="rounded p-0.5 text-ink-faint transition hover:text-ink"
                aria-label="Dismiss notification"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
