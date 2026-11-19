"use client";

import { FlaskConical, Radio } from "lucide-react";

import { cn } from "@/lib/utils";
import type { EnvironmentMini } from "@/lib/types";

const kindStyles: Record<string, string> = {
  DEVELOPMENT: "border-cyan/25 bg-cyan/10 text-cyan",
  UAT: "border-signal-violet/25 bg-signal-violet/10 text-signal-violet",
  PRODUCTION: "border-signal-amber/25 bg-signal-amber/10 text-signal-amber",
};

export function EnvBadge({
  environment,
  className,
  showMode = true,
}: {
  environment: Pick<EnvironmentMini, "kind" | "name" | "execution_mode">;
  className?: string;
  showMode?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2 py-[3px] text-[10.5px] font-medium",
          kindStyles[environment.kind] ?? "border-white/10 bg-white/5 text-ink-muted",
        )}
      >
        {environment.kind === "PRODUCTION" ? (
          <Radio className="h-2.5 w-2.5" />
        ) : environment.kind === "UAT" ? (
          <FlaskConical className="h-2.5 w-2.5" />
        ) : null}
        {environment.name}
      </span>
      {showMode && environment.execution_mode === "SIMULATION" ? (
        <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-[3px] text-[10px] font-medium text-ink-faint">
          simulated
        </span>
      ) : null}
    </span>
  );
}

export function SimulationNotice({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-signal-amber/25 bg-signal-amber/[0.08] px-2.5 py-1 text-[10.5px] font-medium text-signal-amber",
        className,
      )}
      title="No real infrastructure was contacted. JUNE labels simulated outcomes explicitly."
    >
      <FlaskConical className="h-3 w-3" />
      Simulation adapter — nothing was deployed
    </span>
  );
}
