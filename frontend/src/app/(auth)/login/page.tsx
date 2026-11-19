"use client";

import { motion } from "framer-motion";
import {
  ArrowRight,
  Eye,
  EyeOff,
  Fingerprint,
  Lock,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button, Field, Input } from "@/components/ui/primitives";
import { useLogin, useMe } from "@/lib/hooks";
import type { ApiError } from "@/lib/api";

const proofPoints = [
  { icon: Workflow, label: "Discover", copy: "Every automation with a plain-English guide." },
  { icon: ShieldCheck, label: "Govern", copy: "Approvals bound to the exact candidate." },
  { icon: Fingerprint, label: "Prove", copy: "Hash-chained evidence for every action." },
];

export default function LoginPage() {
  const router = useRouter();
  const login = useLogin();
  const me = useMe();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (me.data?.user) router.replace("/");
  }, [me.data, router]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await login.mutateAsync({ email: email.trim(), password });
      router.replace("/");
    } catch (caught) {
      setError((caught as ApiError).message ?? "Sign in failed.");
    }
  }

  return (
    <main className="relative flex min-h-screen items-stretch overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 top-24 h-[520px] w-[520px] rounded-full bg-cyan/10 blur-[140px]" />
        <div className="absolute -right-20 top-0 h-[460px] w-[460px] rounded-full bg-lime/[0.08] blur-[130px]" />
        <div className="absolute inset-0 grid-surface opacity-40" />
      </div>

      <section className="relative z-10 hidden w-[54%] flex-col justify-between px-16 py-12 lg:flex xl:px-24">
        <div className="flex items-center gap-3">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-lime/30 bg-lime/10">
            <span className="text-[17px] font-bold tracking-tight text-lime">J</span>
            <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-lime shadow-[0_0_12px_#D6FF76]" />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-[0.18em] text-ink">JUNE</p>
            <p className="text-[10.5px] uppercase tracking-[0.16em] text-ink-faint">Job Unification &amp; Network Execution</p>
          </div>
        </div>

        <div className="max-w-[590px]">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11.5px] text-ink-muted">
              <Sparkles className="h-3.5 w-3.5 text-lime" />
              Governed delivery, without opening Jenkins again
            </div>
            <h1 className="text-[52px] font-semibold leading-[1.02] tracking-[-0.045em] xl:text-[64px]">
              <span className="text-gradient-lime">Automation</span>
              <br />
              that can prove
              <br />
              what it did.
            </h1>
            <p className="mt-7 max-w-[470px] text-[15.5px] leading-relaxed text-ink-muted">
              JUNE unifies discovery, safe execution, production approvals, security evidence and a
              tamper-evident audit trail into one calm control plane.
            </p>
          </motion.div>

          <motion.div
            className="mt-11 grid grid-cols-3 gap-3"
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.09, delayChildren: 0.25 } } }}
          >
            {proofPoints.map((point) => (
              <motion.div
                key={point.label}
                variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0 } }}
                transition={{ type: "spring", stiffness: 240, damping: 26 }}
                className="rounded-xl border border-white/8 bg-white/[0.025] p-4 backdrop-blur"
              >
                <point.icon className="mb-3 h-4 w-4 text-cyan" />
                <p className="text-[13px] font-medium text-ink">{point.label}</p>
                <p className="mt-1 text-[11.5px] leading-relaxed text-ink-faint">{point.copy}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>

        <div className="flex items-center gap-6 text-[11px] text-ink-faint">
          <span className="inline-flex items-center gap-1.5">
            <Lock className="h-3 w-3" /> httpOnly sessions
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-3 w-3" /> CSRF defended
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Fingerprint className="h-3 w-3" /> Separation of duties
          </span>
        </div>
      </section>

      <section className="relative z-10 flex w-full items-center justify-center px-5 py-10 lg:w-[46%] lg:border-l lg:border-white/8 lg:bg-obsidian-950/40 lg:px-12">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1], delay: 0.1 }}
          className="w-full max-w-[430px]"
        >
          <div className="mb-8 lg:hidden">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-lime/30 bg-lime/10 text-sm font-bold text-lime">
                J
              </div>
              <p className="text-[13px] font-semibold tracking-[0.2em] text-ink">JUNE</p>
            </div>
          </div>

          <div className="relative rounded-2xl border border-white/10 bg-obsidian-850/85 p-7 shadow-lift backdrop-blur-2xl sm:p-8">
            <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-lime/50 to-transparent" />
            <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">Welcome back</h2>
            <p className="mt-1.5 text-[13px] text-ink-muted">
              Sign in to the control plane. Your role determines what you can run and approve.
            </p>

            <form onSubmit={submit} className="mt-7 space-y-4">
              <Field label="Work email">
                <Input
                  type="email"
                  value={email}
                  autoComplete="username"
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@company.com"
                  required
                />
              </Field>
              <Field label="Password">
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    autoComplete="current-password"
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="••••••••••••"
                    required
                    className="pr-11"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint transition hover:text-ink"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </Field>

              {error ? (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-lg border border-signal-red/30 bg-signal-red/10 px-3 py-2 text-[12.5px] text-signal-red"
                >
                  {error}
                </motion.p>
              ) : null}

              <Button type="submit" variant="primary" size="lg" className="w-full" loading={login.isPending}>
                Enter JUNE
                <ArrowRight className="h-4 w-4" />
              </Button>
            </form>

          </div>

          <p className="mt-5 text-center text-[11px] leading-relaxed text-ink-faint">
            By signing in you accept the audit trail. Every decision is recorded and hash-linked.
          </p>
        </motion.div>
      </section>
    </main>
  );
}
