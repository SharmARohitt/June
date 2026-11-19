import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  meta,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        {eyebrow ? (
          <div className="mb-2 flex items-center gap-2">
            <span className="h-1 w-1 rounded-full bg-lime shadow-[0_0_8px_rgba(214,255,118,0.9)]" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink-faint">{eyebrow}</p>
          </div>
        ) : null}
        <h1 className="truncate text-[27px] font-semibold leading-tight tracking-[-0.035em] text-ink">{title}</h1>
        {description ? (
          <p className="mt-2 max-w-3xl text-[13.5px] leading-relaxed text-ink-muted">{description}</p>
        ) : null}
        {meta ? <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
