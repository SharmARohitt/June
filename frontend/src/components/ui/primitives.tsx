"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Copy, Loader2, Search, X } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type ComponentProps,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";

import { cn, initials, statusLabel, statusTone, toneClasses, type Tone } from "@/lib/utils";

/* ------------------------------------------------------------------ Button */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "cyan" | "outline";
type ButtonSize = "sm" | "md" | "lg" | "icon";

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-lime text-obsidian-950 hover:bg-lime-soft border border-lime/60 shadow-[0_10px_36px_-16px_rgba(214,255,118,0.6)]",
  secondary:
    "bg-white/[0.04] text-ink border border-white/10 hover:bg-white/[0.08] hover:border-white/20",
  outline: "bg-transparent text-lime border border-lime/35 hover:bg-lime/10 hover:border-lime/60",
  ghost: "bg-transparent text-ink-muted border border-transparent hover:text-ink hover:bg-white/[0.05]",
  danger: "bg-signal-red/12 text-signal-red border border-signal-red/30 hover:bg-signal-red/20",
  cyan: "bg-cyan/12 text-cyan border border-cyan/30 hover:bg-cyan/20",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[12.5px] gap-1.5 rounded-lg",
  md: "h-10 px-4 text-sm gap-2 rounded-xl",
  lg: "h-12 px-6 text-[15px] gap-2.5 rounded-xl",
  icon: "h-9 w-9 rounded-xl justify-center",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  className,
  variant = "secondary",
  size = "md",
  loading,
  icon,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "btn-shine inline-flex select-none items-center font-medium transition-all disabled:cursor-not-allowed disabled:opacity-45",
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------- Badge */

export function Badge({
  children,
  tone = "slate",
  className,
  dot,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
  dot?: boolean;
}) {
  const palette = toneClasses[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[11px] font-medium",
        palette.bg,
        palette.border,
        palette.text,
        className,
      )}
    >
      {dot ? <span className={cn("h-1.5 w-1.5 rounded-full", palette.dot)} /> : null}
      {children}
    </span>
  );
}

export function StatusPill({
  status,
  className,
  pulse,
}: {
  status: string;
  className?: string;
  pulse?: boolean;
}) {
  const tone = statusTone(status);
  const palette = toneClasses[tone];
  const animated = pulse ?? ["RUNNING", "QUEUED", "WAITING_FOR_APPROVAL"].includes(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[11px] font-medium",
        palette.bg,
        palette.border,
        palette.text,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", palette.dot, animated && "animate-pulse-dot")} />
      {statusLabel(status)}
    </span>
  );
}

/* -------------------------------------------------------------------- Card */

export function Panel({
  children,
  className,
  hover,
  glow,
  ...props
}: ComponentProps<"div"> & { hover?: boolean; glow?: boolean }) {
  return (
    <div
      className={cn("panel", hover && "panel-hover", glow && "shadow-glow", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function SectionHeading({
  title,
  description,
  action,
  eyebrow,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  eyebrow?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div>
        {eyebrow ? (
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint">{eyebrow}</p>
        ) : null}
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        {description ? <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------- Input */

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      {label ? (
        <span className="mb-1.5 flex items-center gap-1 text-[12.5px] font-medium text-ink-muted">
          {label}
          {required ? <span className="text-lime">*</span> : null}
        </span>
      ) : null}
      {children}
      {error ? (
        <span className="mt-1.5 block text-[12px] text-signal-red">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-[12px] leading-relaxed text-ink-faint">{hint}</span>
      ) : null}
    </label>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("input-base", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn("input-base min-h-[96px] resize-y leading-relaxed", className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        className={cn("input-base appearance-none pr-9", className)}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="input-base pl-9 pr-9"
      />
      {value ? (
        <button
          onClick={() => onChange("")}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-ink-faint hover:bg-white/5 hover:text-ink"
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-6">
      {label ? (
        <div>
          <p className="text-sm font-medium text-ink">{label}</p>
          {description ? <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-muted">{description}</p> : null}
        </div>
      ) : null}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full border transition-colors",
          checked ? "border-lime/60 bg-lime/25" : "border-white/15 bg-white/10",
          disabled && "opacity-50",
        )}
      >
        <span
          className={cn(
            "absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full transition-all",
            checked ? "left-[22px] bg-lime" : "left-[3px] bg-ink-muted",
          )}
        />
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------- Tabs */

export function Tabs({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { key: string; label: string; count?: number; icon?: ReactNode }[];
  value: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  const layoutId = useId();
  return (
    <div className={cn("flex flex-wrap items-center gap-1 rounded-xl border border-white/8 bg-obsidian-900/60 p-1", className)}>
      {tabs.map((tab) => {
        const active = tab.key === value;
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className={cn(
              "relative flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-colors",
              active ? "text-ink" : "text-ink-muted hover:text-ink",
            )}
          >
            {active ? (
              <motion.span
                layoutId={`tab-${layoutId}`}
                className="absolute inset-0 rounded-lg border border-white/10 bg-white/[0.07]"
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
              />
            ) : null}
            <span className="relative z-10 flex items-center gap-1.5">
              {tab.icon}
              {tab.label}
              {tab.count !== undefined ? (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px]",
                    active ? "bg-lime/15 text-lime" : "bg-white/5 text-ink-faint",
                  )}
                >
                  {tab.count}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function Segmented({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("inline-flex rounded-lg border border-white/10 bg-obsidian-900/70 p-0.5", className)}>
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
            value === option.value ? "bg-white/10 text-ink" : "text-ink-faint hover:text-ink-muted",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- Empty etc */

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      {icon ? (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-ink-muted">
          {icon}
        </div>
      ) : null}
      <p className="text-sm font-medium text-ink">{title}</p>
      {description ? <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-ink-muted">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} />;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin text-ink-muted", className)} />;
}

export function ProgressBar({ value, tone = "lime", className }: { value: number; tone?: Tone; className?: string }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]", className)}>
      <motion.div
        className={cn("h-full rounded-full", toneClasses[tone].dot)}
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------- Copy */

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          /* clipboard may be blocked */
        }
      }}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-ink-faint transition hover:bg-white/5 hover:text-ink"
      title="Copy"
    >
      {copied ? <Check className="h-3 w-3 text-lime" /> : <Copy className="h-3 w-3" />}
      {label ? <span>{copied ? "Copied" : label}</span> : null}
    </button>
  );
}

/* ------------------------------------------------------------------ Avatar */

export function Avatar({ name, size = 32, className }: { name: string; size?: number; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border border-white/10 bg-gradient-to-br from-white/[0.09] to-white/[0.02] text-[11px] font-semibold text-ink",
        className,
      )}
      style={{ width: size, height: size }}
      title={name}
    >
      {initials(name)}
    </span>
  );
}

/* ------------------------------------------------------------------- Modal */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!mounted) return null;
  const widths = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-5xl" };

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <motion.div
            className="absolute inset-0 bg-obsidian-950/80 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            className={cn(
              "relative z-10 flex max-h-[88vh] w-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-obsidian-850 shadow-lift",
              widths[size],
            )}
            initial={{ opacity: 0, y: 18, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.99 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-lime/40 to-transparent" />
            {title || description ? (
              <div className="flex items-start justify-between gap-4 border-b border-white/8 px-6 py-5">
                <div>
                  {title ? <h3 className="text-[17px] font-semibold text-ink">{title}</h3> : null}
                  {description ? <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{description}</p> : null}
                </div>
                <button
                  onClick={onClose}
                  className="rounded-lg border border-white/8 p-1.5 text-ink-faint transition hover:bg-white/5 hover:text-ink"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
            {footer ? (
              <div className="flex items-center justify-end gap-2 border-t border-white/8 bg-obsidian-900/60 px-6 py-4">
                {footer}
              </div>
            ) : null}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = "max-w-xl",
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[80]">
          <motion.div
            className="absolute inset-0 bg-obsidian-950/70 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            className={cn(
              "absolute right-0 top-0 flex h-full w-full flex-col border-l border-white/10 bg-obsidian-850 shadow-lift",
              width,
            )}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 32 }}
          >
            <div className="flex items-start justify-between gap-4 border-b border-white/8 px-6 py-5">
              <div>
                {title ? <h3 className="text-[17px] font-semibold text-ink">{title}</h3> : null}
                {subtitle ? <p className="mt-1 text-[12.5px] text-ink-muted">{subtitle}</p> : null}
              </div>
              <button
                onClick={onClose}
                className="rounded-lg border border-white/8 p-1.5 text-ink-faint transition hover:bg-white/5 hover:text-ink"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
            {footer ? <div className="border-t border-white/8 bg-obsidian-900/60 px-6 py-4">{footer}</div> : null}
          </motion.aside>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

/* --------------------------------------------------------------- Command K */

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-white/12 bg-white/[0.06] px-1 font-mono text-[10px] font-medium text-ink-muted">
      {children}
    </kbd>
  );
}

/* ----------------------------------------------------------------- Tooltip */

export function InfoTip({ content, children }: { content: string; children?: ReactNode }) {
  return (
    <span className="group relative inline-flex">
      {children ?? (
        <span className="flex h-4 w-4 items-center justify-center rounded-full border border-white/15 text-[9px] text-ink-faint">
          i
        </span>
      )}
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-56 -translate-x-1/2 rounded-lg border border-white/10 bg-obsidian-700 px-3 py-2 text-[11.5px] leading-relaxed text-ink-muted opacity-0 shadow-lift transition group-hover:opacity-100">
        {content}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ context */

interface SessionUi {
  beginnerMode: boolean;
}

const BeginnerContext = createContext<SessionUi>({ beginnerMode: false });
export const BeginnerProvider = BeginnerContext.Provider;
export function useBeginner(): boolean {
  return useContext(BeginnerContext).beginnerMode;
}

export function useCopyState(): [boolean, (value: string) => void] {
  const [copied, setCopied] = useState(false);
  return [
    copied,
    (value: string) => {
      void navigator.clipboard?.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    },
  ];
}

export function useUiId(prefix: string): string {
  const id = useId();
  return `${prefix}-${id}`;
}

export function useEscape(active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onEscape();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [active, onEscape]);
}

