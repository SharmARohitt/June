import {
  BarChart3,
  BadgeCheck,
  CircleHelp,
  GitBranch,
  LayoutDashboard,
  Plug,
  ScrollText,
  Server,
  ShieldCheck,
  Users,
  Workflow,
  PlayCircle,
  type LucideIcon,
} from "lucide-react";

export interface NavEntry {
  href: string;
  label: string;
  icon: LucideIcon;
  permission: string;
  description: string;
  badge?: "approvals";
}

export interface NavSection {
  label: string;
  entries: NavEntry[];
}

export const navSections: NavSection[] = [
  {
    label: "Operate",
    entries: [
      {
        href: "/",
        label: "Command Center",
        icon: LayoutDashboard,
        permission: "analytics:read",
        description: "The state of automation, approvals and evidence at a glance.",
      },
      {
        href: "/automations",
        label: "Automations",
        icon: Workflow,
        permission: "automations:read",
        description: "Discover what JUNE can do for you, in plain English.",
      },
      {
        href: "/executions",
        label: "Executions",
        icon: PlayCircle,
        permission: "executions:read",
        description: "Every run, its live logs and its outcome.",
      },
      {
        href: "/approvals",
        label: "Approvals",
        icon: BadgeCheck,
        permission: "approvals:read",
        description: "Decisions bound to an exact candidate and its evidence.",
        badge: "approvals",
      },
    ],
  },
  {
    label: "Build",
    entries: [
      {
        href: "/studio",
        label: "Pipeline Studio",
        icon: GitBranch,
        permission: "pipelines:read",
        description: "Shape the stages a run must pass before it ships.",
      },
    ],
  },
  {
    label: "Govern",
    entries: [
      {
        href: "/security",
        label: "Security",
        icon: ShieldCheck,
        permission: "security:read",
        description: "Scanning findings and the policies that gate every run.",
      },
      {
        href: "/chronicle",
        label: "Chronicle",
        icon: ScrollText,
        permission: "audit:read",
        description: "A tamper-evident record of every action in JUNE.",
      },
      {
        href: "/infrastructure",
        label: "Infrastructure",
        icon: Server,
        permission: "infrastructure:read",
        description: "Environments, server groups, targets and execution agents.",
      },
    ],
  },
  {
    label: "Insight",
    entries: [
      {
        href: "/analytics",
        label: "Analytics",
        icon: BarChart3,
        permission: "analytics:read",
        description: "Measured outcomes, with no vanity metrics.",
      },
    ],
  },
  {
    label: "Platform",
    entries: [
      {
        href: "/integrations",
        label: "Integrations",
        icon: Plug,
        permission: "integrations:read",
        description: "What JUNE is actually connected to — and what is not.",
      },
      {
        href: "/admin",
        label: "Administration",
        icon: Users,
        permission: "admin:users",
        description: "People, roles, teams and platform health.",
      },
      {
        href: "/help",
        label: "Help Center",
        icon: CircleHelp,
        permission: "",
        description: "How JUNE works, in plain English.",
      },
    ],
  },
];

export const allNavEntries: NavEntry[] = navSections.flatMap((section) => section.entries);

export function can(permissions: string[] | undefined, permission: string): boolean {
  if (!permission) return true;
  return Boolean(permissions?.includes(permission));
}

export function activeEntry(pathname: string): NavEntry | undefined {
  const matches = allNavEntries
    .filter((entry) => (entry.href === "/" ? pathname === "/" : pathname.startsWith(entry.href)))
    .sort((a, b) => b.href.length - a.href.length);
  return matches[0];
}
