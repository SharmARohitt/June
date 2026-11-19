"use client";

import { RefreshCw, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { Button, Panel } from "@/components/ui/primitives";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("JUNE view error", error);
  }, [error]);

  return (
    <Panel className="mx-auto max-w-xl p-8 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-signal-red/25 bg-signal-red/10 text-signal-red">
        <ShieldAlert className="h-5 w-5" />
      </div>
      <h1 className="text-[18px] font-semibold text-ink">This view could not be rendered</h1>
      <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-ink-muted">
        Your session and data are untouched. Reload the view, or return to the dashboard and try the action again. If
        it keeps happening, the error below helps whoever supports this workspace.
      </p>
      {error.digest ? (
        <p className="mono mt-3 text-[10px] text-ink-faint">reference {error.digest}</p>
      ) : null}
      <div className="mt-6 flex justify-center gap-2">
        <Button variant="primary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => reset()}>
          Reload this view
        </Button>
        <Button variant="secondary">
          <Link href="/">Back to dashboard</Link>
        </Button>
      </div>
    </Panel>
  );
}
