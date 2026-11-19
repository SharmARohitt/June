"use client";

import Link from "next/link";
import {
  Activity,
  CheckCircle2,
  Clock3,
  Copy,
  Database,
  HardDrive,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
  Users,
  UsersRound,
  XCircle,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";

import { PageHeader } from "@/components/shell/page-header";
import {
  Avatar,
  Badge,
  Button,
  CopyButton,
  EmptyState,
  Field,
  Input,
  Modal,
  Panel,
  SearchInput,
  Select,
  Skeleton,
  StatusPill,
  Tabs,
  Toggle,
  useBeginner,
} from "@/components/ui/primitives";
import { ApiError } from "@/lib/api";
import {
  useAdminSummary,
  useAdminUsers,
  useCreateTeam,
  useCreateUser,
  useMe,
  useRoles,
  useSystemHealth,
  useTeams,
  useUpdateUser,
} from "@/lib/hooks";
import { can } from "@/lib/nav";
import { toast } from "@/lib/stores";
import type { AdminUser, RoleWithPermissions, Team } from "@/lib/types";
import { cn, formatDate, humanize, relative, statusTone, toneClasses, type Tone } from "@/lib/utils";

type RoleOption = { key: string; name: string; description: string };

const ROLE_OPTIONS: RoleOption[] = [
  { key: "SUPER_ADMIN", name: "Super Administrator", description: "Unrestricted platform administration with full audit trail." },
  { key: "PLATFORM_ADMIN", name: "Platform Administrator", description: "Runs the registry, pipelines, environments and integrations." },
  { key: "AUTOMATION_DEVELOPER", name: "Automation Developer", description: "Builds automations and requests governed UAT runs." },
  { key: "OPERATIONS_ENGINEER", name: "Operations Engineer", description: "Operates approved automations and requests production runs." },
  { key: "SECURITY_REVIEWER", name: "Security Reviewer", description: "Reviews scan evidence, policies and security posture." },
  { key: "APPROVER", name: "Approver", description: "Decides production approvals. Cannot approve their own requests." },
  { key: "VIEWER", name: "Viewer", description: "Read-only visibility across the platform." },
];

interface AdminSummary {
  version: string;
  environment: string;
  database: string;
  cache: string;
  storage: string;
  sandboxes: string;
  integrations: { total: number; configured: number };
  counts: {
    automations: number;
    executions: number;
    pending_approvals: number;
    open_findings: number;
    audit_events: number;
  };
}

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

function roleLabel(key: string): string {
  return ROLE_OPTIONS.find((role) => role.key === key)?.name ?? humanize(key);
}

function roleOptionList(roles: RoleWithPermissions[] | undefined): RoleOption[] {
  if (!roles?.length) return ROLE_OPTIONS;
  return roles.map((role) => ({ key: role.key, name: role.name, description: role.description }));
}

function suggestPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
  const values = new Uint32Array(20);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join("");
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 31);
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export default function AdminPage() {
  const me = useMe();
  const beginner = useBeginner();
  const permissions = me.data?.user.permissions ?? [];
  const canUsers = can(permissions, "admin:users");
  const canRoles = can(permissions, "admin:roles");
  const canSettings = can(permissions, "admin:settings");

  const usersQuery = useAdminUsers(canUsers);
  const rolesQuery = useRoles(canRoles);
  const teamsQuery = useTeams(canUsers);
  const health = useSystemHealth();
  const summaryQuery = useAdminSummary(canSettings);

  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const createTeam = useCreateTeam();

  const [tab, setTab] = useState("PEOPLE");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [teamOpen, setTeamOpen] = useState(false);

  const users = usersQuery.data ?? [];
  const teams = teamsQuery.data ?? [];
  const roles = roleOptionList(rolesQuery.data);
  const summary = summaryQuery.data as unknown as AdminSummary | undefined;

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return users.filter((user) => {
      if (roleFilter !== "ALL" && user.role.key !== roleFilter) return false;
      if (statusFilter === "ACTIVE" && !user.is_active) return false;
      if (statusFilter === "INACTIVE" && user.is_active) return false;
      if (!query) return true;
      return (
        user.full_name.toLowerCase().includes(query) ||
        user.email.toLowerCase().includes(query) ||
        user.title.toLowerCase().includes(query) ||
        (user.team?.name.toLowerCase().includes(query) ?? false)
      );
    });
  }, [users, search, roleFilter, statusFilter]);

  const activeCount = users.filter((user) => user.is_active).length;
  const roleCounts = useMemo(
    () => new Map(users.map((user) => [user.role.key, users.filter((row) => row.role.key === user.role.key).length])),
    [users],
  );

  const tabCounts = {
    PEOPLE: users.length,
    ROLES: rolesQuery.data?.length,
    TEAMS: teams.length,
    HEALTH: undefined,
  };

  const isSelf = (user: AdminUser) => user.id === me.data?.user.id;

  async function submitInvite(form: { email: string; full_name: string; title: string; password: string; role_key: string; team_id: string }) {
    try {
      await createUser.mutateAsync({
        email: form.email.trim(),
        full_name: form.full_name.trim(),
        title: form.title.trim(),
        password: form.password,
        role_key: form.role_key,
        team_id: form.team_id || null,
      });
      toast("Account created", "success", `${form.full_name.trim()} can now sign in with the temporary password you set.`);
      setInviteOpen(false);
    } catch (caught) {
      toast("Account not created", "error", (caught as ApiError).message ?? "The account could not be created.");
    }
  }

  async function submitEdit(user: AdminUser, form: { full_name: string; title: string; role_key: string; team_id: string; is_active: boolean; password: string }) {
    const payload: Record<string, unknown> = {};
    if (form.full_name.trim() !== user.full_name) payload.full_name = form.full_name.trim();
    if (form.title.trim() !== user.title) payload.title = form.title.trim();
    if (!isSelf(user) && form.role_key !== user.role.key) payload.role_key = form.role_key;
    if ((user.team?.id ?? "") !== form.team_id) payload.team_id = form.team_id || "";
    if (form.is_active !== user.is_active) payload.is_active = form.is_active;
    if (form.password) payload.password = form.password;

    if (!Object.keys(payload).length) {
      toast("Nothing to save", "info", "No fields have changed.");
      return;
    }
    try {
      await updateUser.mutateAsync({ id: user.id, payload });
      toast("Account updated", "success", `${user.full_name} has been updated.`);
      setEditing(null);
    } catch (caught) {
      toast("Account not updated", "error", (caught as ApiError).message ?? "The account could not be updated.");
    }
  }

  async function submitTeam(form: { name: string; slug: string }) {
    try {
      await createTeam.mutateAsync({ name: form.name.trim(), slug: form.slug.trim() || slugify(form.name) });
      toast("Team created", "success", `${form.name.trim()} is ready to own automations.`);
      setTeamOpen(false);
    } catch (caught) {
      toast("Team not created", "error", (caught as ApiError).message ?? "The team could not be created.");
    }
  }

  if (!canUsers && me.data) {
    return (
      <div className="mx-auto w-full max-w-[1440px] px-4 pb-16 pt-7 sm:px-6 lg:px-8">
        <PageHeader
          eyebrow="Platform"
          title="Administration"
          description="People, roles, teams and platform health live here. This area is restricted to platform administrators."
        />
        <Panel className="mt-6">
          <EmptyState
            icon={<ShieldAlert className="h-5 w-5" />}
            title="Administration is restricted"
            description="Your role does not include customer administration. Ask a platform administrator if you need an account, team or role change."
            action={
              <Button variant="secondary" onClick={() => (window.location.href = "/")}>
                Back to command center
              </Button>
            }
          />
        </Panel>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 pb-16 pt-7 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Platform"
        title="Administration"
        description="Manage who can do what, how teams are organised, and whether the control plane is healthy. Role permissions are enforced by the backend, not by this screen."
        meta={
          <>
            <Badge tone="lime" dot>
              {users.length} {users.length === 1 ? "person" : "people"}
            </Badge>
            <Badge tone="cyan">{activeCount} active</Badge>
            <Badge tone="slate">{teams.length} teams</Badge>
            {health.data ? (
              <Badge tone={statusTone(health.data.status)} dot>
                Control plane {health.data.status.toLowerCase()}
              </Badge>
            ) : null}
          </>
        }
        actions={
          <>
            {canUsers ? (
              <Button variant="primary" icon={<UserPlus className="h-4 w-4" />} onClick={() => setInviteOpen(true)}>
                Invite teammate
              </Button>
            ) : null}
          </>
        }
      />

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <Tabs
          tabs={[
            { key: "PEOPLE", label: "People", count: tabCounts.PEOPLE, icon: <Users className="h-3.5 w-3.5" /> },
            { key: "ROLES", label: "Roles", count: tabCounts.ROLES, icon: <ShieldCheck className="h-3.5 w-3.5" /> },
            { key: "TEAMS", label: "Teams", count: tabCounts.TEAMS, icon: <UsersRound className="h-3.5 w-3.5" /> },
            { key: "HEALTH", label: "System health", icon: <Activity className="h-3.5 w-3.5" /> },
          ]}
          value={tab}
          onChange={setTab}
        />
        {beginner ? (
          <p className="max-w-md text-[11.5px] leading-relaxed text-ink-faint">
            Beginner mode: roles are fixed blueprints. People inherit their role&apos;s permissions — there are no per-person overrides.
          </p>
        ) : null}
      </div>

      {tab === "PEOPLE" ? (
        <div className="mt-4 space-y-4">
          <Panel className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-4 py-3.5 sm:px-5">
              <SearchInput value={search} onChange={setSearch} placeholder="Search people, email or team…" className="w-full sm:w-72" />
              <Select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className="w-full sm:w-52">
                <option value="ALL">All roles</option>
                {roles.map((role) => (
                  <option key={role.key} value={role.key}>
                    {role.name}
                  </option>
                ))}
              </Select>
              <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="w-full sm:w-40">
                <option value="ALL">All statuses</option>
                <option value="ACTIVE">Active only</option>
                <option value="INACTIVE">Deactivated</option>
              </Select>
              <span className="ml-auto text-[11px] tabular-nums text-ink-faint">
                {filtered.length} of {users.length}
              </span>
            </div>

            <div className="hidden grid-cols-[minmax(0,2.4fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_104px] gap-4 border-b border-white/[0.05] px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint lg:grid">
              <span>Person</span>
              <span>Role</span>
              <span>Team</span>
              <span>Last sign-in</span>
              <span className="text-right">Manage</span>
            </div>

            {usersQuery.isLoading ? (
              <div className="divide-y divide-white/[0.05]">
                {[0, 1, 2, 3, 4].map((row) => (
                  <div key={row} className="flex items-center gap-3 px-5 py-3.5">
                    <Skeleton className="h-9 w-9 rounded-full" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3 w-40" />
                      <Skeleton className="h-2.5 w-56" />
                    </div>
                    <Skeleton className="h-5 w-24 rounded-full" />
                  </div>
                ))}
              </div>
            ) : filtered.length ? (
              <div className="divide-y divide-white/[0.05]">
                {filtered.map((user) => (
                  <div
                    key={user.id}
                    className="grid grid-cols-1 gap-3 px-4 py-3.5 transition-colors hover:bg-white/[0.015] sm:px-5 lg:grid-cols-[minmax(0,2.4fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_104px] lg:items-center lg:gap-4"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar name={user.full_name} size={36} />
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 truncate text-[13px] font-medium text-ink">
                          {user.full_name}
                          {isSelf(user) ? (
                            <span className="rounded-full border border-lime/25 bg-lime/10 px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide text-lime">
                              you
                            </span>
                          ) : null}
                        </p>
                        <p className="truncate text-[11.5px] text-ink-faint">{user.email}</p>
                      </div>
                    </div>

                    <div className="flex min-w-0 items-center gap-2 lg:block">
                      <Badge tone={roleTone(user.role.key)}>{user.role.name}</Badge>
                      {user.title ? <p className="mt-1 truncate text-[11px] text-ink-faint">{user.title}</p> : null}
                    </div>

                    <div className="min-w-0">
                      <p className={cn("truncate text-[12px]", user.team ? "text-ink-muted" : "text-ink-faint")}>
                        {user.team?.name ?? "Unassigned"}
                      </p>
                      <p className="mt-1 text-[11px] text-ink-faint lg:hidden">
                        {user.last_login_at ? `Last sign-in ${relative(user.last_login_at)}` : "Never signed in"}
                      </p>
                    </div>

                    <div className="hidden min-w-0 lg:block">
                      <p className="truncate text-[12px] text-ink-muted">
                        {user.last_login_at ? relative(user.last_login_at) : "Never"}
                      </p>
                      <p className="mt-1 text-[10.5px] text-ink-faint">Joined {formatDate(user.created_at, "d MMM yyyy")}</p>
                    </div>

                    <div className="flex items-center justify-between gap-2 lg:justify-end">
                      <Badge tone={user.is_active ? "lime" : "slate"} dot>
                        {user.is_active ? "Active" : "Inactive"}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Pencil className="h-3.5 w-3.5" />}
                        onClick={() => setEditing(user)}
                      >
                        Edit
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<Users className="h-5 w-5" />}
                title="No people match these filters"
                description="Clear the search or widen the role and status filters to see more teammates."
              />
            )}
          </Panel>

          <div className="grid gap-4 md:grid-cols-3">
            <Panel className="p-5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">Separation of duties</p>
              <p className="mt-2 text-[12.5px] leading-relaxed text-ink-muted">
                Requesters cannot approve their own production run, regardless of role. Approvals are bound to the exact candidate
                hash — a new build invalidates every pending approval.
              </p>
            </Panel>
            <Panel className="p-5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">Session revocation</p>
              <p className="mt-2 text-[12.5px] leading-relaxed text-ink-muted">
                Changing a role, deactivating an account or resetting a password bumps the user&apos;s token version, which immediately
                invalidates their existing sessions.
              </p>
            </Panel>
            <Panel className="p-5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">Temporary credentials</p>
              <p className="mt-2 text-[12.5px] leading-relaxed text-ink-muted">
                JUNE stores only a one-way password hash. Share the temporary password you set through a secure channel; it is never
                emailed or displayed again.
              </p>
            </Panel>
          </div>
        </div>
      ) : null}

      {tab === "ROLES" ? (
        <div className="mt-4">
          {!canRoles ? (
            <Panel>
              <EmptyState
                icon={<ShieldAlert className="h-5 w-5" />}
                title="Role definitions are restricted"
                description="Inspecting the permission matrix requires admin:roles. People management remains available on the People tab."
              />
            </Panel>
          ) : rolesQuery.isLoading ? (
            <div className="grid gap-4 md:grid-cols-2">
              {[0, 1, 2, 3].map((card) => (
                <Panel key={card} className="p-5">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="mt-3 h-3 w-full" />
                  <Skeleton className="mt-2 h-3 w-3/4" />
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {[0, 1, 2, 3, 4].map((chip) => (
                      <Skeleton key={chip} className="h-5 w-24 rounded-full" />
                    ))}
                  </div>
                </Panel>
              ))}
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {(rolesQuery.data ?? []).map((role) => (
                <Panel key={role.key} className="p-5" hover>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-[15px] font-semibold text-ink">{role.name}</h3>
                        {roleCounts.get(role.key) ? (
                          <Badge tone="slate">
                            {roleCounts.get(role.key)} {roleCounts.get(role.key) === 1 ? "person" : "people"}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">{role.description}</p>
                    </div>
                    <span className="rounded-lg border border-white/8 bg-white/[0.03] p-2 text-ink-faint">
                      <ShieldCheck className={cn("h-4 w-4", toneClasses[roleTone(role.key)].text)} />
                    </span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {role.permissions.map((permission) => (
                      <span
                        key={permission}
                        className="mono rounded-md border border-white/[0.07] bg-white/[0.025] px-1.5 py-1 text-[9.5px] text-ink-muted"
                        title={humanize(permission)}
                      >
                        {permission}
                      </span>
                    ))}
                  </div>
                  <p className="mono mt-3 border-t border-white/[0.05] pt-3 text-[10px] text-ink-faint">
                    {role.key} · {role.permissions.length} permissions
                  </p>
                </Panel>
              ))}
            </div>
          )}
          <p className="mt-4 flex items-start gap-2 text-[11.5px] leading-relaxed text-ink-faint">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Roles are fixed security blueprints. To change what someone can do, move them to a different role — every change is written
            to the Chronicle audit chain.
          </p>
        </div>
      ) : null}

      {tab === "TEAMS" ? (
        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[12.5px] text-ink-muted">
              Teams group people who own the same automations. Membership is assigned when editing a person.
            </p>
            <Button variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setTeamOpen(true)}>
              New team
            </Button>
          </div>

          {teamsQuery.isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2].map((card) => (
                <Panel key={card} className="p-5">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="mt-2 h-3 w-24" />
                  <Skeleton className="mt-4 h-8 w-32" />
                </Panel>
              ))}
            </div>
          ) : teams.length ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {teams.map((team) => {
                const members = users.filter((user) => user.team?.id === team.id);
                const roleCount = new Set(members.map((member) => member.role.key)).size;
                return (
                  <Panel key={team.id} className="p-5" hover>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-[14.5px] font-semibold text-ink">{team.name}</h3>
                        <p className="mono mt-0.5 text-[10px] text-ink-faint">{team.slug}</p>
                      </div>
                      <span className="rounded-lg border border-white/8 bg-white/[0.03] p-2 text-ink-faint">
                        <UsersRound className="h-4 w-4" />
                      </span>
                    </div>
                    <div className="mt-4 flex items-center gap-2">
                      {members.slice(0, 5).map((member) => (
                        <Avatar key={member.id} name={member.full_name} size={26} />
                      ))}
                      {members.length > 5 ? (
                        <span className="inline-flex h-[26px] min-w-[26px] items-center justify-center rounded-full border border-white/10 bg-white/[0.04] px-1.5 text-[10px] text-ink-muted">
                          +{members.length - 5}
                        </span>
                      ) : null}
                      {!members.length ? <span className="text-[11.5px] text-ink-faint">No members yet</span> : null}
                    </div>
                    <p className="mt-3 border-t border-white/[0.05] pt-3 text-[11px] text-ink-faint">
                      {members.length} {members.length === 1 ? "person" : "people"}
                      {members.length ? ` · ${roleCount} ${roleCount === 1 ? "role" : "roles"} represented` : ""}
                    </p>
                  </Panel>
                );
              })}
            </div>
          ) : (
            <Panel>
              <EmptyState
                icon={<UsersRound className="h-5 w-5" />}
                title="No teams yet"
                description="Create a team to group ownership. You can assign people to it from the People tab."
                action={
                  <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setTeamOpen(true)}>
                    Create the first team
                  </Button>
                }
              />
            </Panel>
          )}
        </div>
      ) : null}

      {tab === "HEALTH" ? (
        <div className="mt-4 space-y-4">
          <Panel className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-xl border",
                    health.data ? toneClasses[statusTone(health.data.status)].border : "border-white/10",
                    health.data ? toneClasses[statusTone(health.data.status)].bg : "bg-white/[0.03]",
                  )}
                >
                  <Activity className={cn("h-5 w-5", health.data ? toneClasses[statusTone(health.data.status)].text : "text-ink-faint")} />
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[14px] font-semibold text-ink">Control plane</p>
                    {health.data ? <StatusPill status={health.data.status} pulse /> : <Skeleton className="h-5 w-20 rounded-full" />}
                  </div>
                  <p className="mt-0.5 text-[11.5px] text-ink-faint">
                    {health.data ? `v${health.data.version} · ${health.data.environment}` : "Checking dependencies…"}
                    {health.data ? ` · checked ${relative(health.data.generated_at)}` : ""}
                  </p>
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                icon={<RefreshCw className={cn("h-3.5 w-3.5", health.isFetching && "animate-spin")} />}
                onClick={() => health.refetch()}
                disabled={health.isFetching}
              >
                Re-check now
              </Button>
            </div>
            {health.isError ? (
              <div className="border-t border-white/[0.06] bg-signal-red/[0.06] px-5 py-3 text-[12px] text-signal-red">
                Health endpoint unreachable. The control plane may be starting up or the API is down.
              </div>
            ) : null}
          </Panel>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {health.isLoading
              ? [0, 1, 2].map((card) => (
                  <Panel key={card} className="p-5">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="mt-3 h-3 w-full" />
                    <Skeleton className="mt-2 h-3 w-2/3" />
                  </Panel>
                ))
              : (health.data?.components ?? []).map((component) => {
                  const tone = statusTone(component.status);
                  const Icon =
                    component.key === "database" ? Database : component.key === "cache" ? Zap : component.key === "storage" ? HardDrive : Activity;
                  return (
                    <Panel key={component.key} className="p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg border", toneClasses[tone].border, toneClasses[tone].bg)}>
                            <Icon className={cn("h-4 w-4", toneClasses[tone].text)} />
                          </span>
                          <div>
                            <p className="text-[13px] font-medium text-ink">{component.name}</p>
                            <p className="mono text-[9.5px] uppercase tracking-wide text-ink-faint">{component.key}</p>
                          </div>
                        </div>
                        <StatusPill status={component.status} />
                      </div>
                      <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">{component.detail}</p>
                      <div className="mt-3 flex items-center justify-between border-t border-white/[0.05] pt-3 text-[10.5px] text-ink-faint">
                        <span className="inline-flex items-center gap-1.5">
                          <Clock3 className="h-3 w-3" />
                          {relative(component.checked_at)}
                        </span>
                        <span className="mono tabular-nums">
                          {component.latency_ms === null ? "no sample" : `${Math.round(component.latency_ms)} ms`}
                        </span>
                      </div>
                    </Panel>
                  );
                })}
          </div>

          {!canSettings ? (
            <Panel>
              <EmptyState
                icon={<ShieldAlert className="h-5 w-5" />}
                title="Platform facts are restricted"
                description="Aggregate counts, storage paths and integration status require admin:settings. Component health remains visible because it powers the sidebar status."
              />
            </Panel>
          ) : summaryQuery.isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              {[0, 1, 2, 3, 4].map((tile) => (
                <Panel key={tile} className="p-4">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="mt-3 h-7 w-16" />
                </Panel>
              ))}
            </div>
          ) : summary ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                {[
                  { key: "automations", label: "Active automations", value: summary.counts.automations, href: "/automations" },
                  { key: "executions", label: "Total executions", value: summary.counts.executions, href: "/executions" },
                  { key: "approvals", label: "Pending approvals", value: summary.counts.pending_approvals, href: "/approvals" },
                  { key: "findings", label: "Open findings", value: summary.counts.open_findings, href: "/security" },
                  { key: "audit", label: "Audit events", value: summary.counts.audit_events, href: "/chronicle" },
                ].map((tile) => (
                  <Link
                    key={tile.key}
                    href={tile.href}
                    className="panel panel-hover group flex items-center justify-between px-4 py-4"
                  >
                    <div>
                      <p className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-ink-faint">{tile.label}</p>
                      <p className="mt-2 text-[26px] font-semibold tabular-nums tracking-[-0.03em] text-ink">{tile.value}</p>
                    </div>
                    <span className="text-ink-faint transition group-hover:text-lime">↗</span>
                  </Link>
                ))}
              </div>

              <Panel className="overflow-hidden">
                <div className="border-b border-white/[0.06] px-5 py-3.5">
                  <h3 className="text-[13px] font-semibold text-ink">Runtime facts</h3>
                  <p className="mt-0.5 text-[11.5px] text-ink-faint">Read directly from the running control plane configuration.</p>
                </div>
                <dl className="divide-y divide-white/[0.05]">
                  {[
                    { label: "Version", value: summary.version, mono: true },
                    { label: "Environment", value: summary.environment, mono: true },
                    { label: "Database engine", value: summary.database, mono: true },
                    { label: "Cache", value: summary.cache, mono: true },
                    { label: "Object storage", value: summary.storage, mono: true },
                    { label: "Sandbox root", value: summary.sandboxes, mono: true },
                    {
                      label: "Integrations configured",
                      value: `${summary.integrations.configured} of ${summary.integrations.total}`,
                      mono: true,
                    },
                  ].map((fact) => (
                    <div key={fact.label} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                      <dt className="text-[12px] text-ink-muted">{fact.label}</dt>
                      <dd className={cn("max-w-full truncate text-[11.5px] text-ink", fact.mono && "mono")} title={fact.value}>
                        {fact.value}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="flex items-start gap-2 border-t border-white/[0.05] px-5 py-3 text-[10.5px] leading-relaxed text-ink-faint">
                  <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-lime" />
                  Counts come from live database queries. JUNE does not cache or estimate platform statistics.
                </p>
              </Panel>
            </>
          ) : (
            <Panel>
              <EmptyState
                icon={<XCircle className="h-5 w-5" />}
                title="Platform summary unavailable"
                description="The summary endpoint returned no data. Component health above is still measured independently."
              />
            </Panel>
          )}
        </div>
      ) : null}

      <InviteModal
        open={inviteOpen}
        roles={roles}
        teams={teams}
        loading={createUser.isPending}
        onClose={() => setInviteOpen(false)}
        onSubmit={submitInvite}
      />

      {editing ? (
        <EditUserModal
          key={editing.id}
          user={editing}
          self={isSelf(editing)}
          roles={roles}
          teams={teams}
          loading={updateUser.isPending}
          onClose={() => setEditing(null)}
          onSubmit={(form) => submitEdit(editing, form)}
        />
      ) : null}

      <TeamModal
        open={teamOpen}
        existing={teams}
        loading={createTeam.isPending}
        onClose={() => setTeamOpen(false)}
        onSubmit={submitTeam}
      />
    </div>
  );
}

function InviteModal({
  open,
  roles,
  teams,
  loading,
  onClose,
  onSubmit,
}: {
  open: boolean;
  roles: RoleOption[];
  teams: Team[];
  loading: boolean;
  onClose: () => void;
  onSubmit: (form: { email: string; full_name: string; title: string; password: string; role_key: string; team_id: string }) => void;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [roleKey, setRoleKey] = useState("VIEWER");
  const [teamId, setTeamId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const valid = fullName.trim().length >= 2 && isEmail(email) && password.length >= 12;

  function submit() {
    if (!valid) {
      setError(
        fullName.trim().length < 2
          ? "Enter the person's full name."
          : !isEmail(email)
            ? "Enter a valid work email address."
            : "The temporary password must be at least 12 characters.",
      );
      return;
    }
    setError("");
    onSubmit({ email, full_name: fullName, title, password, role_key: roleKey, team_id: teamId });
  }

  const selectedRole = roles.find((role) => role.key === roleKey);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Invite a teammate"
      description="Create an account with a role and temporary password. JUNE never emails credentials."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="primary" icon={<UserPlus className="h-4 w-4" />} loading={loading} disabled={!valid} onClick={submit}>
            Create account
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name" required>
            <Input value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Alex Morgan" maxLength={140} autoFocus />
          </Field>
          <Field label="Work email" required>
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="alex.morgan@june.dev"
              autoComplete="off"
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Job title">
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Release Engineer" maxLength={120} />
          </Field>
          <Field label="Role" required hint={selectedRole?.description}>
            <Select value={roleKey} onChange={(event) => setRoleKey(event.target.value)}>
              {roles.map((role) => (
                <option key={role.key} value={role.key}>
                  {role.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Team" hint="Teams are optional; you can assign one later.">
          <Select value={teamId} onChange={(event) => setTeamId(event.target.value)}>
            <option value="">No team</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Temporary password"
          required
          hint="Minimum 12 characters. It is visible while you set it — JUNE stores only a one-way hash."
        >
          <div className="flex gap-2">
            <Input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 12 characters"
              className="mono"
              autoComplete="new-password"
            />
            <Button
              variant="secondary"
              size="sm"
              icon={<KeyRound className="h-3.5 w-3.5" />}
              className="shrink-0"
              onClick={() => setPassword(suggestPassword())}
            >
              Generate
            </Button>
          </div>
        </Field>
        {password ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
            <span className="mono min-w-0 truncate text-[11.5px] text-ink-muted">{password}</span>
            <CopyButton value={password} label="Copy" />
          </div>
        ) : null}

        <div className="flex items-start gap-2 rounded-lg border border-signal-amber/20 bg-signal-amber/[0.05] px-3 py-2.5 text-[11.5px] leading-relaxed text-signal-amber">
          <Copy className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Share this password over a secure channel. The new account can sign in immediately; JUNE records the creation in the audit chain.
        </div>

        {error ? <p className="text-[12px] text-signal-red">{error}</p> : null}
      </div>
    </Modal>
  );
}

function EditUserModal({
  user,
  self,
  roles,
  teams,
  loading,
  onClose,
  onSubmit,
}: {
  user: AdminUser;
  self: boolean;
  roles: RoleOption[];
  teams: Team[];
  loading: boolean;
  onClose: () => void;
  onSubmit: (form: { full_name: string; title: string; role_key: string; team_id: string; is_active: boolean; password: string }) => void;
}) {
  const [fullName, setFullName] = useState(user.full_name);
  const [title, setTitle] = useState(user.title);
  const [roleKey, setRoleKey] = useState(user.role.key);
  const [teamId, setTeamId] = useState(user.team?.id ?? "");
  const [active, setActive] = useState(user.is_active);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const passwordValid = !password || password.length >= 12;
  const nameValid = fullName.trim().length >= 2;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${user.full_name}`}
      description={user.email}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={<Pencil className="h-4 w-4" />}
            loading={loading}
            disabled={!nameValid || !passwordValid}
            onClick={() => {
              if (!nameValid) {
                setError("Full name must be at least 2 characters.");
                return;
              }
              if (!passwordValid) {
                setError("A reset password must be at least 12 characters.");
                return;
              }
              setError("");
              onSubmit({ full_name: fullName, title, role_key: roleKey, team_id: teamId, is_active: active, password });
            }}
          >
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3.5 py-3">
          <Avatar name={user.full_name} size={40} />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-ink">{user.full_name}</p>
            <p className="truncate text-[11.5px] text-ink-faint">
              {user.role.name} · joined {formatDate(user.created_at, "d MMM yyyy")}
            </p>
          </div>
          {self ? <Badge tone="lime" className="ml-auto">This is you</Badge> : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name" required>
            <Input value={fullName} onChange={(event) => setFullName(event.target.value)} maxLength={140} />
          </Field>
          <Field label="Job title">
            <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="No title" />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Role"
            hint={self ? "You cannot change your own role." : "Changing a role revokes the person's active sessions."}
          >
            <Select value={roleKey} onChange={(event) => setRoleKey(event.target.value)} disabled={self}>
              {roles.map((role) => (
                <option key={role.key} value={role.key}>
                  {role.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Team">
            <Select value={teamId} onChange={(event) => setTeamId(event.target.value)}>
              <option value="">No team</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
          <Toggle
            checked={active}
            onChange={setActive}
            disabled={self}
            label="Account active"
            description={
              self
                ? "You cannot deactivate your own account."
                : "Deactivating revokes all sessions immediately. The account stays in the audit history."
            }
          />
        </div>

        <Field
          label="Reset password (optional)"
          hint="Leave blank to keep the current password. A reset revokes active sessions and must be at least 12 characters."
        >
          <Input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="New password"
            className="mono"
            autoComplete="new-password"
          />
        </Field>

        {error ? <p className="text-[12px] text-signal-red">{error}</p> : null}

        <p className="flex items-start gap-2 text-[11px] leading-relaxed text-ink-faint">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          The backend enforces the last-active-Super-Administrator rule and writes each change to the Chronicle.
        </p>
      </div>
    </Modal>
  );
}

function TeamModal({
  open,
  existing,
  loading,
  onClose,
  onSubmit,
}: {
  open: boolean;
  existing: Team[];
  loading: boolean;
  onClose: () => void;
  onSubmit: (form: { name: string; slug: string }) => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState("");

  const resolvedSlug = slugTouched ? slug : slugify(name);
  const duplicate = existing.some((team) => team.slug === resolvedSlug);
  const valid = name.trim().length >= 2 && Boolean(resolvedSlug) && !duplicate;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create a team"
      description="Teams group the people who own the same automations and approvals."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={<Plus className="h-4 w-4" />}
            loading={loading}
            disabled={!valid}
            onClick={() => {
              if (!valid) {
                setError(name.trim().length < 2 ? "Enter a team name." : duplicate ? "That slug is already taken." : "Enter a slug.");
                return;
              }
              setError("");
              onSubmit({ name, slug: resolvedSlug });
            }}
          >
            Create team
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Team name" required>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Payments Platform"
            maxLength={120}
            autoFocus
          />
        </Field>
        <Field label="Slug" hint="Used in URLs and integrations. Lowercase letters, numbers and hyphens.">
          <Input
            value={resolvedSlug}
            onChange={(event) => {
              setSlugTouched(true);
              setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"));
            }}
            className="mono"
            placeholder="payments-platform"
          />
        </Field>
        {duplicate ? <p className="text-[12px] text-signal-red">A team with this slug already exists.</p> : null}
        {error ? <p className="text-[12px] text-signal-red">{error}</p> : null}
      </div>
    </Modal>
  );
}
