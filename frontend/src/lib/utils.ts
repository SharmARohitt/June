import { clsx, type ClassValue } from "clsx";
import { format, formatDistanceToNowStrict, isValid, parseISO } from "date-fns";
import {
  Activity,
  Archive,
  Bell,
  Boxes,
  Box,
  ClipboardCheck,
  Database,
  FileText,
  FlaskConical,
  GitBranch,
  HeartPulse,
  KeyRound,
  Layers,
  ListChecks,
  Lock,
  Package,
  Play,
  Radar,
  RefreshCw,
  Rocket,
  ScanLine,
  ScrollText,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = parseISO(value);
  return isValid(parsed) ? parsed : null;
}

export function formatDate(value: string | null | undefined, pattern = "d MMM yyyy, HH:mm"): string {
  const date = parseDate(value);
  return date ? format(date, pattern) : "—";
}

export function formatTime(value: string | null | undefined): string {
  return formatDate(value, "HH:mm:ss");
}

export function relative(value: string | null | undefined): string {
  const date = parseDate(value);
  if (!date) return "—";
  const diff = Date.now() - date.getTime();
  if (Math.abs(diff) < 45_000) return "just now";
  return formatDistanceToNowStrict(date, { addSuffix: true });
}

export function duration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function humanize(value: string): string {
  return value
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .replace(/\bApi\b/g, "API")
    .replace(/\bUat\b/g, "UAT")
    .replace(/\bHttp\b/g, "HTTP");
}

export type Tone = "lime" | "cyan" | "amber" | "red" | "violet" | "slate" | "green";

export const toneClasses: Record<Tone, { text: string; bg: string; border: string; dot: string }> = {
  lime: { text: "text-lime", bg: "bg-lime/10", border: "border-lime/25", dot: "bg-lime" },
  cyan: { text: "text-cyan", bg: "bg-cyan/10", border: "border-cyan/25", dot: "bg-cyan" },
  amber: { text: "text-signal-amber", bg: "bg-signal-amber/10", border: "border-signal-amber/25", dot: "bg-signal-amber" },
  red: { text: "text-signal-red", bg: "bg-signal-red/10", border: "border-signal-red/25", dot: "bg-signal-red" },
  violet: { text: "text-signal-violet", bg: "bg-signal-violet/10", border: "border-signal-violet/25", dot: "bg-signal-violet" },
  green: { text: "text-signal-green", bg: "bg-signal-green/10", border: "border-signal-green/25", dot: "bg-signal-green" },
  slate: { text: "text-ink-muted", bg: "bg-white/5", border: "border-white/10", dot: "bg-ink-faint" },
};

export function statusTone(status: string): Tone {
  switch (status) {
    case "SUCCEEDED":
    case "PASSED":
    case "APPROVED":
    case "ONLINE":
    case "HEALTHY":
    case "CONFIGURED":
    case "REACHABLE":
    case "PASS":
      return "lime";
    case "RUNNING":
    case "ACTIVE":
      return "cyan";
    case "WAITING_FOR_APPROVAL":
    case "PENDING":
    case "DEGRADED":
    case "STALE":
      return "amber";
    case "FAILED":
    case "ERROR":
    case "BLOCKED":
    case "REJECTED":
    case "INVALIDATED":
    case "UNREACHABLE":
    case "FAIL":
      return "red";
    case "TIMED_OUT":
    case "EXPIRED":
      return "violet";
    case "QUEUED":
    case "SKIPPED":
    case "CANCELLED":
    case "OFFLINE":
    case "NOT_CONFIGURED":
      return "slate";
    default:
      return "slate";
  }
}

export function riskTone(risk: string): Tone {
  switch (risk) {
    case "LOW":
      return "lime";
    case "MEDIUM":
      return "cyan";
    case "HIGH":
      return "amber";
    case "CRITICAL":
      return "red";
    default:
      return "slate";
  }
}

export const automationIcons: Record<string, LucideIcon> = {
  "heart-pulse": HeartPulse,
  "file-text": FileText,
  database: Database,
  zap: Zap,
  package: Package,
  "key-round": KeyRound,
  "sliders-horizontal": SlidersHorizontal,
  activity: Activity,
  shield: ShieldCheck,
  "shield-check": ShieldCheck,
  workflow: Workflow,
  server: Server,
  rocket: Rocket,
  scan: ScanLine,
  radar: Radar,
  layers: Layers,
  git: GitBranch,
  box: Box,
  boxes: Boxes,
  sparkles: Sparkles,
  play: Play,
  refresh: RefreshCw,
  clipboard: ClipboardCheck,
  lock: Lock,
  archive: Archive,
  scroll: ScrollText,
  flask: FlaskConical,
  "list-checks": ListChecks,
  branch: GitBranch,
  bell: Bell,
};

export function automationIcon(name: string): LucideIcon {
  return automationIcons[name] ?? Workflow;
}

export const stageIcons: Record<string, LucideIcon> = {
  source_checkout: GitBranch,
  input_validation: ListChecks,
  security_scan: ShieldCheck,
  uat_deploy: FlaskConical,
  automated_test: ScanLine,
  approval_gate: Lock,
  production_deploy: Rocket,
  verification: ClipboardCheck,
};

export function stageIcon(key: string): LucideIcon {
  return stageIcons[key] ?? Activity;
}

export function plural(count: number, singular: string, pluralForm?: string): string {
  return `${count} ${count === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}

export function pct(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(value % 1 === 0 ? 0 : 1)}%`;
}

export function shortenHash(hash: string | null | undefined, size = 10): string {
  if (!hash) return "—";
  return hash.length <= size * 2 ? hash : `${hash.slice(0, size)}…${hash.slice(-4)}`;
}

// crypto.randomUUID() is unavailable when JUNE is served over plain HTTP from a
// LAN address (non-secure context), so fall back to getRandomValues/Math.random.
export function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const riskCopy: Record<string, string> = {
  LOW: "Read-only or low-impact. Safe to rehearse in UAT.",
  MEDIUM: "Changes controlled state. Review inputs before running.",
  HIGH: "Production-impacting change. Requires approval and evidence.",
  CRITICAL: "Platform-wide impact. Restricted to governed production approvals.",
};

export const statusLabels: Record<string, string> = {
  WAITING_FOR_APPROVAL: "Awaiting approval",
  NOT_CONFIGURED: "Not configured",
  SUCCEEDED: "Succeeded",
  FAILED: "Failed",
  BLOCKED: "Blocked",
  TIMED_OUT: "Timed out",
  CANCELLED: "Cancelled",
  QUEUED: "Queued",
  RUNNING: "Running",
  SKIPPED: "Skipped",
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
  INVALIDATED: "Invalidated",
};

export function statusLabel(status: string): string {
  return statusLabels[status] ?? humanize(status);
}
