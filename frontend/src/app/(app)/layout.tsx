"use client";

import { AnimatePresence, motion } from "framer-motion";
import { RefreshCw, ShieldAlert } from "lucide-react";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { BrandMark, Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { BeginnerProvider, Button } from "@/components/ui/primitives";
import { ApiError } from "@/lib/api";
import { useApprovals, useMe } from "@/lib/hooks";
import { useUiStore } from "@/lib/stores";
import { cn } from "@/lib/utils";

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const me = useMe();
  const collapsed = useUiStore((state) => state.collapsed);
  const setCollapsed = useUiStore((state) => state.setCollapsed);
  const commandOpen = useUiStore((state) => state.commandOpen);
  const setCommandOpen = useUiStore((state) => state.setCommandOpen);
  const mobileNavOpen = useUiStore((state) => state.mobileNavOpen);
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen);
  const [redirecting, setRedirecting] = useState(false);
  const user = me.data?.user;
  const pendingApprovals = useApprovals("PENDING", Boolean(user));

  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) {
      setRedirecting(true);
      router.replace("/login");
    }
  }, [me.error, router]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(!commandOpen);
      }
      if (event.key === "/" && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [commandOpen, setCommandOpen]);

  useEffect(() => {
    if (!user) return;
    document.documentElement.dataset.reduceMotion = String(Boolean(user.preferences?.reduce_motion));
    document.body.dataset.density = user.preferences?.density === "compact" ? "compact" : "comfortable";
  }, [user]);

  if (me.isLoading || redirecting) {
    return <BootScreen />;
  }

  if (!user) {
    const offline = me.error instanceof ApiError && me.error.status === 0;
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-obsidian-850/80 p-7 text-center shadow-lift backdrop-blur-xl">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-signal-red/25 bg-signal-red/10 text-signal-red">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <h1 className="text-[18px] font-semibold text-ink">
            {offline ? "The control plane is unreachable" : "Your session has ended"}
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
            {offline
              ? "JUNE could not reach the API. Confirm the backend is running, then try again."
              : "Sign in again to continue where you left off."}
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <Button variant="secondary" onClick={() => me.refetch()} icon={<RefreshCw className="h-4 w-4" />}>
              Try again
            </Button>
            <Button variant="primary" onClick={() => router.replace("/login")}>
              Go to sign in
            </Button>
          </div>
        </div>
      </main>
    );
  }

  const beginnerMode = Boolean(user.preferences?.beginner_mode);

  return (
    <BeginnerProvider value={{ beginnerMode }}>
      <div className="relative z-10 flex min-h-screen">
        <div className="sticky top-0 hidden h-screen shrink-0 lg:block">
          <Sidebar
            user={user}
            pendingApprovals={pendingApprovals.data?.length ?? 0}
            collapsed={collapsed}
            onToggleCollapse={() => setCollapsed(!collapsed)}
          />
        </div>

        <AnimatePresence>
          {mobileNavOpen ? (
            <div className="fixed inset-0 z-[70] lg:hidden">
              <motion.div
                className="absolute inset-0 bg-obsidian-950/75 backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setMobileNavOpen(false)}
              />
              <motion.div
                initial={{ x: "-100%" }}
                animate={{ x: 0 }}
                exit={{ x: "-100%" }}
                transition={{ type: "spring", stiffness: 320, damping: 34 }}
                className="absolute left-0 top-0 h-full w-[272px]"
              >
                <Sidebar
                  user={user}
                  pendingApprovals={pendingApprovals.data?.length ?? 0}
                  collapsed={false}
                  onToggleCollapse={() => undefined}
                  onNavigate={() => setMobileNavOpen(false)}
                />
              </motion.div>
            </div>
          ) : null}
        </AnimatePresence>

        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar user={user} />
          <main className={cn("mx-auto w-full max-w-[1560px] flex-1 px-4 py-6 lg:px-8 lg:py-8")}>
            <motion.div
              key={pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
            >
              {children}
            </motion.div>
          </main>
          <footer className="mx-auto flex w-full max-w-[1560px] flex-wrap items-center justify-between gap-2 px-4 pb-6 text-[10.5px] text-ink-faint lg:px-8">
            <span>JUNE · Job Unification &amp; Network Execution</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-lime" />
              Every action is recorded in the Chronicle
            </span>
          </footer>
        </div>
      </div>
    </BeginnerProvider>
  );
}

function BootScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6">
      <div className="relative">
        <div className="absolute inset-0 animate-ping rounded-2xl bg-lime/10" />
        <div className="relative">
          <BrandMark />
        </div>
      </div>
      <div className="flex flex-col items-center gap-3">
        <div className="h-1 w-40 overflow-hidden rounded-full bg-white/[0.06]">
          <motion.div
            className="h-full w-1/3 rounded-full bg-lime"
            animate={{ x: ["-120%", "320%"] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>
        <p className="text-[11.5px] uppercase tracking-[0.18em] text-ink-faint">Opening the control plane</p>
      </div>
    </div>
  );
}
