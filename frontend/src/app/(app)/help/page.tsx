"use client";

import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Compass,
  Fingerprint,
  FlaskConical,
  Hash,
  KeyRound,
  Layers,
  LifeBuoy,
  Lock,
  PlayCircle,
  ScrollText,
  ShieldCheck,
  Users,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { PageHeader } from "@/components/shell/page-header";
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  InfoTip,
  Panel,
  SearchInput,
  SectionHeading,
  Skeleton,
  useBeginner,
} from "@/components/ui/primitives";
import { useMe } from "@/lib/hooks";
import { can } from "@/lib/nav";
import { cn, type Tone } from "@/lib/utils";

const SECTIONS = [
  { id: "start", label: "Start here", icon: Compass },
  { id: "journey", label: "A run, step by step", icon: PlayCircle },
  { id: "permissions", label: "Roles & permissions", icon: KeyRound },
  { id: "safety", label: "Safety model", icon: ShieldCheck },
  { id: "concepts", label: "Glossary", icon: BookOpen },
  { id: "faq", label: "FAQ", icon: CircleHelp },
];

const ROLE_GUIDE = [
  {
    key: "SUPER_ADMIN",
    name: "Super Administrator",
    summary: "Unrestricted platform administration. Still cannot approve their own production requests.",
  },
  {
    key: "PLATFORM_ADMIN",
    name: "Platform Administrator",
    summary: "Runs the registry, pipelines, environments, integrations and people administration.",
  },
  {
    key: "AUTOMATION_DEVELOPER",
    name: "Automation Developer",
    summary: "Builds and validates pipelines, runs security scans and requests UAT executions.",
  },
  {
    key: "OPERATIONS_ENGINEER",
    name: "Operations Engineer",
    summary: "Operates approved automations and requests governed production runs.",
  },
  {
    key: "SECURITY_REVIEWER",
    name: "Security Reviewer",
    summary: "Reviews scan evidence, findings and policies. Does not approve production runs.",
  },
  {
    key: "APPROVER",
    name: "Approver",
    summary: "Decides production approvals with full evidence. Cannot approve their own request.",
  },
  { key: "VIEWER", name: "Viewer", summary: "Read-only visibility across automations, runs, security and audit history." },
];

const PERMISSION_GROUPS: { label: string; description: string; permissions: { key: string; label: string }[] }[] = [
  {
    label: "Automations & pipelines",
    description: "What you can discover, edit and publish.",
    permissions: [
      { key: "automations:read", label: "View automations and their instructions" },
      { key: "automations:write", label: "Create and edit automation metadata" },
      { key: "automations:archive", label: "Archive automations" },
      { key: "pipelines:read", label: "Inspect pipeline definitions and versions" },
      { key: "pipelines:write", label: "Validate, save and publish pipeline versions" },
    ],
  },
  {
    label: "Execution",
    description: "What you can run, watch and stop.",
    permissions: [
      { key: "executions:read", label: "View runs, live logs and results" },
      { key: "executions:create", label: "Request development and UAT runs" },
      { key: "executions:create:production", label: "Request production runs (still gated by approval)" },
      { key: "executions:cancel", label: "Cancel queued or running executions" },
    ],
  },
  {
    label: "Governance",
    description: "How you participate in the approval process.",
    permissions: [
      { key: "approvals:read", label: "View the approval queue and its evidence" },
      { key: "approvals:decide", label: "Approve or reject eligible production candidates" },
      { key: "security:read", label: "View scans, findings and policies" },
      { key: "security:run", label: "Run security scans against a candidate" },
    ],
  },
  {
    label: "Infrastructure & insight",
    description: "The environments JUNE runs in and the evidence it produces.",
    permissions: [
      { key: "infrastructure:read", label: "View environments, server groups and agents" },
      { key: "infrastructure:write", label: "Manage server groups, servers and agents" },
      { key: "analytics:read", label: "View measured analytics" },
      { key: "audit:read", label: "Read and export the Chronicle audit chain" },
      { key: "integrations:read", label: "View integration status and configuration" },
      { key: "integrations:write", label: "Update integration configuration" },
    ],
  },
  {
    label: "Administration",
    description: "Platform-level control, normally reserved for administrators.",
    permissions: [
      { key: "admin:users", label: "Manage people and teams" },
      { key: "admin:roles", label: "Inspect the role permission matrix" },
      { key: "admin:environments", label: "Create and manage execution environments" },
      { key: "admin:settings", label: "Read platform settings and aggregate summary" },
    ],
  },
];

const SAFETY_CARDS = [
  {
    icon: ShieldCheck,
    title: "Separation of duties is enforced, not suggested",
    body:
      "A requester can never approve their own production run, even with the Super Administrator role. The backend checks this on every decision, so a hidden button is never the only protection.",
  },
  {
    icon: Hash,
    title: "Approvals are bound to one exact candidate",
    body:
      "Each approval records the automation version and candidate hash. If the pipeline is republished or the candidate changes, pending approvals are invalidated and must be requested again.",
  },
  {
    icon: Lock,
    title: "No arbitrary shell",
    body:
      "Executions use allowlisted runners with typed parameter schemas. There is no field where a user can type a shell command, and production runs cannot skip the approval gate.",
  },
  {
    icon: KeyRound,
    title: "Credentials stay references",
    body:
      "JUNE stores secrets-provider references rather than plaintext secrets. User passwords are hashed with scrypt and a per-user salt. Session tokens live in httpOnly cookies.",
  },
  {
    icon: FlaskConical,
    title: "Simulation is always labelled",
    body:
      "An environment using the simulation adapter never contacts real infrastructure. Runs, results and approval evidence are explicitly marked as simulated — JUNE never dresses up a simulation as a deployment.",
  },
  {
    icon: ScrollText,
    title: "The audit trail is tamper-evident",
    body:
      "Every security-relevant action is appended to a SHA-256 hash chain. The Chronicle can recompute the chain at any time and points to the first event that fails verification.",
  },
];

const GLOSSARY = [
  { term: "Automation", definition: "A catalogued job with an owner, instructions, a repository path and one or more pipeline versions." },
  { term: "Pipeline", definition: "The ordered stages JUNE executes — for example checkout, install, scan, test, deploy. Published versions are immutable." },
  { term: "Candidate", definition: "The exact published pipeline version plus its content hash that an execution intends to run." },
  { term: "Execution", definition: "One run of a candidate against an environment with a specific parameter set, logs and a result." },
  { term: "Environment", definition: "A target boundary such as Development, UAT or Production. Each declares an execution mode and whether approval is required." },
  { term: "Execution mode", definition: "LOCAL_SANDBOX runs inside an isolated local directory; SIMULATION records a labelled outcome without real access; REMOTE_AGENT requires a configured agent." },
  { term: "Runner", definition: "An allowlisted, typed unit of work (health check, dependency scan, test suite). Runners are not arbitrary scripts." },
  { term: "Security scan", definition: "Evidence recorded against a candidate: built-in scanners inspect dependencies, secrets and the package layout." },
  { term: "Finding", definition: "A specific issue raised by a scan, with severity, location and remediation guidance." },
  { term: "Policy", definition: "A named rule evaluated during a run. BLOCK policies stop a candidate from progressing until the issue is resolved." },
  { term: "Approval", definition: "A governance record allowing one specific production candidate to proceed. It has an expiry and is invalidated by changes." },
  { term: "Candidate hash", definition: "A SHA-256 fingerprint of the pipeline definition. It proves the thing approved is the thing that will run." },
  { term: "Server group", definition: "A set of targets inside an environment that a runner can address, with a declared check protocol." },
  { term: "Agent", definition: "A registered execution worker. Registration returns a one-time token; JUNE stores only its hash." },
  { term: "Chronicle", definition: "JUNE's append-only audit ledger, chained with SHA-256 so tampering is detectable." },
  { term: "Integration", definition: "An external system JUNE can report on or contact. Status is truthful: configured, needs setup or not configured." },
  { term: "Idempotency key", definition: "A client-supplied key that prevents an accidental double submission from starting two executions." },
  { term: "Beginner mode", definition: "A display preference that adds plain-English explanations and hides expert-only detail without changing permissions." },
];

const FAQS = [
  {
    question: "Why is the Approve button disabled?",
    answer:
      "The approval queue only enables a decision when every readiness check passes: the request is still pending, you are not the requester, the automation version is still current, the candidate hash still matches, security scans have passed, and the UAT evidence exists. The backend repeats every check when you submit, so the UI is a guide — never the authority.",
  },
  {
    question: "Why does a production run say 'simulated'?",
    answer:
      "The environment is configured with the simulation adapter. JUNE records realistic states, logs and evidence but contacts no real infrastructure and deploys nothing. The label appears on the environment, the execution and the approval evidence so nobody can mistake it for a real deployment.",
  },
  {
    question: "Can I run any command I want?",
    answer:
      "No. Executions are composed from allowlisted runners with typed parameter schemas validated by the backend. There is no arbitrary shell, script path or free-form command field, and the production approval gate cannot be bypassed by changing a parameter.",
  },
  {
    question: "Where do credentials live?",
    answer:
      "JUNE stores secrets-provider references, not plaintext secrets. User passwords are hashed with scrypt and a per-user salt. Access tokens are httpOnly cookies with CSRF protection, and integration secrets are supplied through configuration rather than typed into the UI.",
  },
  {
    question: "How do I know the audit history was not edited?",
    answer:
      "Each audit event stores the previous event's hash and its own SHA-256 hash. The Chronicle's Verify action recomputes the entire chain and reports the first invalid event if anything was altered, deleted or reordered.",
  },
  {
    question: "Why was I signed out unexpectedly?",
    answer:
      "An administrator changed your role, deactivated your account or reset your password. Those actions bump your token version, which revokes existing sessions immediately. Sign in again with your current credentials.",
  },
  {
    question: "What happens when a run fails?",
    answer:
      "The execution stops at the failed stage with a terminal status, a failure code and an explanation. Stage logs remain attached to the run. Fix the cause, publish a new pipeline version and request a fresh run — there is no silent retry that hides a failure.",
  },
  {
    question: "Can I edit a published pipeline?",
    answer:
      "Published versions are immutable. Editing creates a draft version; publishing it supersedes the previous published version. Any pending approval tied to the old candidate hash is invalidated, so what gets approved is always what will run.",
  },
  {
    question: "Who can change my role?",
    answer:
      "Only someone with admin:users. Administrators cannot change their own role or deactivate themselves, and JUNE refuses to remove the last active Super Administrator. Every change is written to the Chronicle with the actor and the new role.",
  },
  {
    question: "Does JUNE execute on remote servers?",
    answer:
      "Not in this build unless a remote agent is registered and the remote execution path is configured. Agent registration issues a one-time token and heartbeat, but JUNE does not claim remote dispatch is available when it is not — the Infrastructure screen says so explicitly.",
  },
];

function roleTone(key: string): Tone {
  switch (key) {
    case "SUPER_ADMIN":
      return "lime";
    case "PLATFORM_ADMIN":
      return "cyan";
    case "AUTOMATION_DEVELOPER":
      return "violet";
    case "OPERATIONS_ENGINEER":
      return "amber";
    case "SECURITY_REVIEWER":
      return "red";
    case "APPROVER":
      return "green";
    default:
      return "slate";
  }
}

export default function HelpPage() {
  const me = useMe();
  const beginner = useBeginner();
  const user = me.data?.user;
  const permissions = user?.permissions ?? [];
  const canAudit = can(permissions, "audit:read");
  const [glossaryQuery, setGlossaryQuery] = useState("");
  const [activeSection, setActiveSection] = useState("start");

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target.id) setActiveSection(visible.target.id);
      },
      { rootMargin: "-120px 0px -68% 0px", threshold: 0 },
    );
    SECTIONS.forEach(({ id }) => {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    });
    return () => observer.disconnect();
  }, []);

  const filteredGlossary = useMemo(() => {
    const query = glossaryQuery.trim().toLowerCase();
    if (!query) return GLOSSARY;
    return GLOSSARY.filter(
      (entry) => entry.term.toLowerCase().includes(query) || entry.definition.toLowerCase().includes(query),
    );
  }, [glossaryQuery]);

  const grantedCount = PERMISSION_GROUPS.flatMap((group) => group.permissions).filter((permission) =>
    permissions.includes(permission.key),
  ).length;

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 pb-16 pt-7 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Guide"
        title="Help Center"
        description="Everything JUNE does, in plain English — the journey of a run, the safety model, your permissions, and honest answers about what is simulated."
        meta={
          <>
            <Badge tone="lime" dot>
              Plain English, no Jenkins required
            </Badge>
            {user ? <Badge tone={roleTone(user.role.key)}>{user.role.name}</Badge> : null}
            {user ? <Badge tone="slate">{grantedCount} permissions granted</Badge> : null}
          </>
        }
      />

      <div className="mt-6 flex flex-wrap gap-1.5 lg:hidden">
        {SECTIONS.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            className={cn(
              "rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11.5px] text-ink-muted transition hover:bg-white/[0.06] hover:text-ink",
              activeSection === section.id && "border-lime/30 bg-lime/10 text-lime",
            )}
          >
            {section.label}
          </a>
        ))}
      </div>

      <div className="mt-5 grid gap-8 lg:grid-cols-[228px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <div className="sticky top-24 space-y-4">
            <Panel className="p-2.5">
              <p className="px-2.5 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">On this page</p>
              <nav className="space-y-0.5">
                {SECTIONS.map((section) => {
                  const Icon = section.icon;
                  const active = activeSection === section.id;
                  return (
                    <a
                      key={section.id}
                      href={`#${section.id}`}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] font-medium transition",
                        active ? "bg-white/[0.06] text-ink" : "text-ink-muted hover:bg-white/[0.03] hover:text-ink",
                      )}
                    >
                      <Icon className={cn("h-3.5 w-3.5", active ? "text-lime" : "text-ink-faint")} />
                      {section.label}
                    </a>
                  );
                })}
              </nav>
            </Panel>

            <Panel className="p-4">
              {me.isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
              ) : user ? (
                <>
                  <div className="flex items-center gap-2.5">
                    <Avatar name={user.full_name} size={34} />
                    <div className="min-w-0">
                      <p className="truncate text-[12.5px] font-medium text-ink">{user.full_name}</p>
                      <p className="truncate text-[10.5px] text-ink-faint">{user.role.name}</p>
                    </div>
                  </div>
                  <a
                    href="#permissions"
                    className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-medium text-cyan transition hover:text-lime"
                  >
                    See what you can do
                    <ArrowRight className="h-3 w-3" />
                  </a>
                </>
              ) : null}
            </Panel>
          </div>
        </aside>

        <div className="min-w-0 space-y-12">
          <section id="start" className="scroll-mt-28">
            <SectionHeading
              eyebrow="Start here"
              title="The 90-second version"
              description="JUNE is the front door for automation: discover what exists, understand it, run it safely and govern anything that touches production."
              className="mb-4"
            />
            <Panel className="relative overflow-hidden p-6 sm:p-7" glow>
              <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-lime/[0.06] blur-3xl" />
              <div className="relative">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-lime">The one rule</p>
                <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-ink">
                  Every action in JUNE either works end to end or tells you exactly which integration is not configured. There is no
                  pretend success.
                </p>
                {beginner ? (
                  <p className="mt-2 max-w-2xl text-[12.5px] leading-relaxed text-ink-muted">
                    Beginner mode is on, so screens include extra guidance. It changes wording only — never permissions or behaviour.
                  </p>
                ) : null}
                <div className="mt-5 flex flex-wrap gap-2">
                  <Link href="/automations" className="inline-flex">
                    <Button variant="primary" size="sm" icon={<Compass className="h-4 w-4" />}>
                      Browse automations
                    </Button>
                  </Link>
                  <Link href="/executions" className="inline-flex">
                    <Button variant="secondary" size="sm" icon={<PlayCircle className="h-4 w-4" />}>
                      View recent runs
                    </Button>
                  </Link>
                </div>
              </div>
            </Panel>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                {
                  step: "01",
                  title: "Discover",
                  body: "Open an automation and read its instructions, owner and published version.",
                  href: "/automations",
                  icon: Workflow,
                },
                {
                  step: "02",
                  title: "Run in UAT",
                  body: "Choose an environment, fill typed parameters and start a governed execution.",
                  href: "/automations",
                  icon: PlayCircle,
                },
                {
                  step: "03",
                  title: "Watch live",
                  body: "Stage-by-stage logs stream in real time. Failures are explicit, never hidden.",
                  href: "/executions",
                  icon: Layers,
                },
                {
                  step: "04",
                  title: "Approve safely",
                  body: "Production candidates wait for a human decision backed by immutable evidence.",
                  href: "/approvals",
                  icon: ShieldCheck,
                },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <Link key={item.step} href={item.href} className="panel panel-hover group flex flex-col p-5">
                    <div className="flex items-center justify-between">
                      <span className="mono text-[10px] font-semibold text-ink-faint">{item.step}</span>
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/8 bg-white/[0.03] text-ink-muted transition group-hover:border-lime/25 group-hover:text-lime">
                        <Icon className="h-4 w-4" />
                      </span>
                    </div>
                    <p className="mt-4 text-[13.5px] font-semibold text-ink">{item.title}</p>
                    <p className="mt-1 flex-1 text-[12px] leading-relaxed text-ink-muted">{item.body}</p>
                    <span className="mt-4 inline-flex items-center gap-1 text-[11px] font-medium text-ink-faint transition group-hover:text-lime">
                      Open
                      <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>

          <section id="journey" className="scroll-mt-28">
            <SectionHeading
              eyebrow="Execution"
              title="What happens when you press Run"
              description="The same path for every environment. Production adds a human approval gate, not a different set of rules."
              className="mb-4"
            />
            <Panel className="overflow-hidden">
              <ol className="divide-y divide-white/[0.05]">
                {[
                  {
                    title: "Permission and environment checks",
                    body:
                      "The backend verifies that your role may execute in the chosen environment, that the environment exists and that the runner is allowlisted.",
                  },
                  {
                    title: "Typed parameters, never free-form commands",
                    body:
                      "Parameters are validated against the runner's schema. Unknown fields are rejected, and there is no shell-command input to abuse.",
                  },
                  {
                    title: "Idempotency protection",
                    body:
                      "A client key prevents a double click or network retry from starting two identical executions.",
                  },
                  {
                    title: "Approval gate for production",
                    body:
                      "If the environment requires approval, the run waits with status WAITING_FOR_APPROVAL. Nothing executes until an eligible approver decides.",
                  },
                  {
                    title: "Isolated stages with live logs",
                    body:
                      "The executor works inside an isolated sandbox directory. Each stage emits logs over a real server-sent event stream, so you see progress as it happens.",
                  },
                  {
                    title: "Evidence is recorded",
                    body:
                      "Candidate hash, scans, UAT results, risk notes and systems affected are attached to the run and to any approval request.",
                  },
                  {
                    title: "An honest terminal result",
                    body:
                      "Runs end as SUCCEEDED, FAILED, CANCELLED, TIMED_OUT or BLOCKED with a reason. Simulated environments are labelled as simulated throughout.",
                  },
                ].map((step, index) => (
                  <li key={step.title} className="flex gap-4 px-5 py-4">
                    <span className="mono mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/8 bg-white/[0.03] text-[10.5px] font-semibold text-ink-muted">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <p className="text-[13px] font-medium text-ink">{step.title}</p>
                      <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-ink-muted">{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] bg-white/[0.015] px-5 py-3">
                <span className="text-[11px] text-ink-faint">Want the operational view?</span>
                <Link href="/executions" className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-cyan transition hover:text-lime">
                  Open executions
                  <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </Panel>
          </section>

          <section id="permissions" className="scroll-mt-28">
            <SectionHeading
              eyebrow="Access"
              title="Roles and your permissions"
              description="Roles are fixed blueprints. JUNE checks permissions on the backend for every request, and the interface hides actions you cannot take."
              className="mb-4"
            />

            <Panel className="mb-4 overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
                <div className="flex items-center gap-3">
                  {user ? <Avatar name={user.full_name} size={40} /> : <Skeleton className="h-10 w-10 rounded-full" />}
                  <div>
                    {me.isLoading ? (
                      <>
                        <Skeleton className="h-3.5 w-36" />
                        <Skeleton className="mt-1.5 h-3 w-52" />
                      </>
                    ) : user ? (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[13.5px] font-semibold text-ink">{user.full_name}</p>
                          <Badge tone={roleTone(user.role.key)}>{user.role.name}</Badge>
                          {user.team ? <Badge tone="slate">{user.team.name}</Badge> : null}
                        </div>
                        <p className="mt-0.5 text-[11.5px] text-ink-faint">
                          {grantedCount} of {PERMISSION_GROUPS.flatMap((group) => group.permissions).length} platform
                          permissions granted
                        </p>
                      </>
                    ) : (
                      <p className="text-[13px] text-ink-muted">Sign in to see your permissions.</p>
                    )}
                  </div>
                </div>
                <InfoTip content="Permissions are delivered by /auth/me from the backend role matrix. This page never grants access; it only explains it.">
                  <span className="chip text-ink-faint">
                    <KeyRound className="h-3 w-3" />
                    backend-enforced
                  </span>
                </InfoTip>
              </div>

              <div className="divide-y divide-white/[0.05]">
                {PERMISSION_GROUPS.map((group) => {
                  const grantedInGroup = group.permissions.filter((permission) => permissions.includes(permission.key)).length;
                  return (
                    <div key={group.label} className="px-5 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-[12.5px] font-semibold text-ink">{group.label}</p>
                          <p className="text-[11px] text-ink-faint">{group.description}</p>
                        </div>
                        <Badge tone={grantedInGroup ? "lime" : "slate"}>
                          {grantedInGroup}/{group.permissions.length}
                        </Badge>
                      </div>
                      <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
                        {group.permissions.map((permission) => {
                          const granted = permissions.includes(permission.key);
                          return (
                            <div
                              key={permission.key}
                              className={cn(
                                "flex items-start gap-2 rounded-lg border px-2.5 py-2 transition",
                                granted
                                  ? "border-lime/15 bg-lime/[0.04]"
                                  : "border-white/[0.05] bg-white/[0.01] opacity-55",
                              )}
                            >
                              <CheckCircle2
                                className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", granted ? "text-lime" : "text-ink-faint")}
                              />
                              <div className="min-w-0">
                                <p className={cn("text-[11.5px]", granted ? "text-ink" : "text-ink-muted")}>{permission.label}</p>
                                <p className="mono mt-0.5 truncate text-[9.5px] text-ink-faint">{permission.key}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>

            <Panel className="overflow-hidden">
              <div className="border-b border-white/[0.06] px-5 py-3.5">
                <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                  <Users className="h-4 w-4 text-ink-faint" />
                  The seven roles
                </h3>
                <p className="mt-0.5 text-[11.5px] text-ink-faint">
                  Assigning a different role is the only way to change someone&apos;s access.
                </p>
              </div>
              <div className="divide-y divide-white/[0.05]">
                {ROLE_GUIDE.map((role) => (
                  <div key={role.key} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={roleTone(role.key)}>{role.name}</Badge>
                        {user?.role.key === role.key ? <span className="text-[10px] font-semibold uppercase tracking-wide text-lime">your role</span> : null}
                      </div>
                      <p className="mt-1 max-w-2xl text-[11.5px] leading-relaxed text-ink-muted">{role.summary}</p>
                    </div>
                    <span className="mono text-[9.5px] text-ink-faint">{role.key}</span>
                  </div>
                ))}
              </div>
              <p className="flex items-start gap-2 border-t border-white/[0.05] px-5 py-3 text-[11px] leading-relaxed text-ink-faint">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lime" />
                Separation of duties applies on top of roles: whoever requests a production run can never approve it, and approvers
                cannot edit the pipeline they are reviewing.
              </p>
            </Panel>
          </section>

          <section id="safety" className="scroll-mt-28">
            <SectionHeading
              eyebrow="Trust"
              title="The safety model"
              description="These are implementation guarantees, not marketing lines. Each one is enforced by the backend and visible in the interface."
              className="mb-4"
            />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {SAFETY_CARDS.map((card) => {
                const Icon = card.icon;
                return (
                  <Panel key={card.title} className="p-5" hover>
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/8 bg-white/[0.03] text-lime">
                      <Icon className="h-4 w-4" />
                    </span>
                    <p className="mt-3 text-[13px] font-semibold text-ink">{card.title}</p>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-ink-muted">{card.body}</p>
                  </Panel>
                );
              })}
            </div>
          </section>

          <section id="concepts" className="scroll-mt-28">
            <SectionHeading
              eyebrow="Language"
              title="Glossary"
              description="The vocabulary JUNE uses, so a request, a log line and an approval record all mean the same thing."
              className="mb-4"
            />
            <Panel className="overflow-hidden">
              <div className="border-b border-white/[0.06] px-4 py-3">
                <SearchInput
                  value={glossaryQuery}
                  onChange={setGlossaryQuery}
                  placeholder="Search terms or definitions…"
                  className="w-full sm:w-80"
                />
              </div>
              {filteredGlossary.length ? (
                <div className="grid sm:grid-cols-2">
                  {filteredGlossary.map((entry) => (
                    <div key={entry.term} className="border-b border-white/[0.05] px-5 py-3.5 sm:odd:border-r sm:last:border-b-0">
                      <p className="text-[12.5px] font-semibold text-ink">{entry.term}</p>
                      <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">{entry.definition}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={<BookOpen className="h-5 w-5" />}
                  title="No matching terms"
                  description={`Nothing in the glossary matches “${glossaryQuery}”. Try a shorter phrase.`}
                  action={
                    <Button variant="ghost" size="sm" onClick={() => setGlossaryQuery("")}>
                      Clear search
                    </Button>
                  }
                />
              )}
            </Panel>
          </section>

          <section id="faq" className="scroll-mt-28">
            <SectionHeading
              eyebrow="Answers"
              title="Frequently asked questions"
              description="Honest answers to the things people usually ask before their first governed run."
              className="mb-4"
            />
            <Panel className="overflow-hidden">
              {FAQS.map((faq) => (
                <details key={faq.question} className="group border-b border-white/[0.05] last:border-b-0">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-[12.5px] font-medium text-ink transition hover:bg-white/[0.02] [&::-webkit-details-marker]:hidden">
                    {faq.question}
                    <ChevronDown className="h-4 w-4 shrink-0 text-ink-faint transition group-open:rotate-180" />
                  </summary>
                  <div className="px-5 pb-4">
                    <p className="max-w-3xl text-[12.5px] leading-relaxed text-ink-muted">{faq.answer}</p>
                  </div>
                </details>
              ))}
            </Panel>

            <Panel className="mt-4 flex flex-wrap items-center justify-between gap-4 p-5">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan/20 bg-cyan/[0.07] text-cyan">
                  <LifeBuoy className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-[13px] font-semibold text-ink">Still stuck?</p>
                  <p className="mt-0.5 max-w-xl text-[12px] leading-relaxed text-ink-muted">
                    Ask a platform administrator with the request or execution ID. Every action is in the Chronicle, including the
                    actor, outcome and reason.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {canAudit ? (
                  <Link href="/chronicle" className="inline-flex">
                    <Button variant="secondary" size="sm" icon={<ScrollText className="h-4 w-4" />}>
                      Open the Chronicle
                    </Button>
                  </Link>
                ) : null}
                <Link href="/" className="inline-flex">
                  <Button variant="ghost" size="sm" icon={<Compass className="h-4 w-4" />}>
                    Command center
                  </Button>
                </Link>
              </div>
            </Panel>

            <p className="mt-4 flex items-center gap-2 text-[10.5px] text-ink-faint">
              <Fingerprint className="h-3 w-3" />
              JUNE · Job Unification &amp; Network Execution — help content reflects the behaviour enforced by this build.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
