"use client";

import { motion } from "framer-motion";
import {
  Boxes,
  ChevronDown,
  CircleDot,
  Cpu,
  FlaskConical,
  Globe,
  Network,
  Plus,
  RefreshCw,
  Server as ServerIcon,
  TriangleAlert,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useMemo, useState } from "react";

import { ExecutionRow } from "@/components/domain/execution-row";
import { PageHeader } from "@/components/shell/page-header";
import {
  Badge,
  Button,
  CopyButton,
  EmptyState,
  Field,
  Input,
  Modal,
  Panel,
  Select,
  Skeleton,
  StatusPill,
  Tabs,
  Textarea,
  Toggle,
  useBeginner,
} from "@/components/ui/primitives";
import { ApiError } from "@/lib/api";
import {
  useCreateGroup,
  useCreateServer,
  useMe,
  useRegisterAgent,
  useTopology,
} from "@/lib/hooks";
import { can } from "@/lib/nav";
import { toast } from "@/lib/stores";
import type { Agent, Server, ServerGroup } from "@/lib/types";
import { cn, humanize, relative, statusTone, toneClasses } from "@/lib/utils";

const MODE_COPY: Record<string, string> = {
  LOCAL_SANDBOX: "Runs inside the JUNE execution sandbox on this host.",
  SIMULATION: "Simulation adapter. Outcomes are labelled and no live system is touched.",
  REMOTE_AGENT: "Dispatches to a registered execution agent.",
};

export default function InfrastructurePage() {
  const me = useMe();
  const topology = useTopology();
  const beginner = useBeginner();
  const createGroup = useCreateGroup();
  const createServer = useCreateServer();
  const registerAgent = useRegisterAgent();

  const permissions = me.data?.user.permissions ?? [];
  const canWrite = can(permissions, "infrastructure:write");
  const [tab, setTab] = useState("TOPOLOGY");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [groupModal, setGroupModal] = useState<{ id: string; name: string } | null>(null);
  const [serverModal, setServerModal] = useState<{ id: string; name: string } | null>(null);
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentToken, setAgentToken] = useState<string | null>(null);

  const envs = topology.data?.environments ?? [];
  const agents = topology.data?.agents ?? [];
  const failures = topology.data?.recent_failures ?? [];

  const totals = useMemo(() => {
    return envs.reduce(
      (acc, environment) => ({
        servers: acc.servers + environment.servers_total,
        reachable: acc.reachable + environment.servers_reachable,
        unreachable: acc.unreachable + environment.servers_unreachable,
        simulated: acc.simulated + environment.servers_simulated,
      }),
      { servers: 0, reachable: 0, unreachable: 0, simulated: 0 },
    );
  }, [envs]);

  const onlineAgents = agents.filter((agent) => agent.status === "ONLINE").length;

  async function submitGroup(form: { name: string; description: string; check_protocol: string }) {
    if (!groupModal) return;
    try {
      await createGroup.mutateAsync({ environmentId: groupModal.id, payload: form });
      toast("Server group created", "success", `${form.name} is ready for servers.`);
      setGroupModal(null);
    } catch (caught) {
      toast("Group not created", "error", (caught as ApiError).message ?? "The server group could not be created.");
    }
  }

  async function submitServer(form: {
    hostname: string;
    display_name: string;
    address: string;
    port: number;
    role: string;
    is_simulated: boolean;
  }) {
    if (!serverModal) return;
    try {
      await createServer.mutateAsync({ groupId: serverModal.id, payload: form });
      toast("Server registered", "success", `${form.hostname} was added to ${serverModal.name}.`);
      setServerModal(null);
    } catch (caught) {
      toast("Server not registered", "error", (caught as ApiError).message ?? "The server could not be registered.");
    }
  }

  async function submitAgent(form: {
    name: string;
    kind: string;
    environment_id: string;
    endpoint: string;
  }) {
    try {
      const result = await registerAgent.mutateAsync({
        name: form.name,
        kind: form.kind,
        environment_id: form.environment_id || null,
        endpoint: form.endpoint,
      });
      setAgentToken(result.token);
      toast("Agent registered", "success", "Copy the one-time token now — it cannot be shown again.");
    } catch (caught) {
      toast("Agent not registered", "error", (caught as ApiError).message ?? "The agent could not be registered.");
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 pb-16 pt-7 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Governance"
        title="Infrastructure"
        description="Environments, server groups and execution agents. JUNE shows what is actually reachable, what is simulated, and which execution plane each run uses."
        meta={
          <>
            <Badge tone="cyan">{totals.servers} servers</Badge>
            <Badge tone="lime" dot>
              {totals.reachable} reachable
            </Badge>
            {totals.unreachable ? <Badge tone="red">{totals.unreachable} unreachable</Badge> : null}
            <Badge tone="amber">{totals.simulated} simulated</Badge>
            <Badge tone={onlineAgents ? "lime" : "slate"} dot>
              {onlineAgents}/{agents.length} agents online
            </Badge>
          </>
        }
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={() => void topology.refetch()}
              loading={topology.isFetching}
            >
              Refresh
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<Cpu className="h-3.5 w-3.5" />}
              onClick={() => setAgentOpen(true)}
              disabled={!canWrite}
              title={!canWrite ? "Your role cannot register agents." : undefined}
            >
              Register agent
            </Button>
          </>
        }
      />

      {beginner ? (
        <Panel className="mt-5 border-cyan/20 bg-cyan/[0.04] px-5 py-4">
          <p className="text-[12.5px] leading-relaxed text-ink-muted">
            <span className="font-medium text-ink">How this works: </span>
            An environment is where work happens — development, UAT or production. A server group is the set of targets a
            run talks to. An agent is a worker that can execute remotely. Simulated targets are always labelled.
          </p>
        </Panel>
      ) : null}

      <div className="mt-6">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { key: "TOPOLOGY", label: "Topology", count: envs.length },
            { key: "AGENTS", label: "Execution agents", count: agents.length },
          ]}
        />
      </div>

      {tab === "TOPOLOGY" ? (
        <div className="mt-4 space-y-4">
          {topology.isLoading ? (
            <>
              <Skeleton className="h-[260px] w-full" />
              <Skeleton className="h-[260px] w-full" />
            </>
          ) : !envs.length ? (
            <Panel>
              <EmptyState
                icon={<Network className="h-5 w-5" />}
                title="No environments are configured"
                description="An administrator needs to seed or create environments before runs can target infrastructure."
              />
            </Panel>
          ) : (
            envs.map((environment) => {
              const open = expanded[environment.id] ?? true;
              return (
                <Panel key={environment.id} className="overflow-hidden">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
                    <button
                      onClick={() => setExpanded((current) => ({ ...current, [environment.id]: !open }))}
                      className="flex min-w-0 items-start gap-3 text-left"
                    >
                      <span
                        className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-obsidian-900/60"
                        style={{ color: environment.color }}
                      >
                        <Network className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[13.5px] font-medium text-ink">{environment.name}</p>
                          <EnvironmentKindBadge kind={environment.kind} />
                          {environment.approval_required ? (
                            <Badge tone="amber" dot>
                              approval required
                            </Badge>
                          ) : null}
                          <Badge tone="slate">{humanize(environment.execution_mode)}</Badge>
                        </div>
                        <p className="mt-1 max-w-2xl text-[11.5px] leading-relaxed text-ink-faint">
                          {environment.description || MODE_COPY[environment.execution_mode]}
                        </p>
                      </div>
                    </button>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-3 text-[10.5px] text-ink-faint">
                        <span>{environment.servers_total} servers</span>
                        <span className="text-lime">{environment.servers_reachable} reachable</span>
                        {environment.servers_unreachable ? (
                          <span className="text-signal-red">{environment.servers_unreachable} down</span>
                        ) : null}
                        {environment.servers_simulated ? (
                          <span className="text-signal-amber">{environment.servers_simulated} simulated</span>
                        ) : null}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Plus className="h-3.5 w-3.5" />}
                        onClick={() => setGroupModal({ id: environment.id, name: environment.name })}
                        disabled={!canWrite}
                      >
                        Group
                      </Button>
                      <ChevronDown
                        className={cn("h-4 w-4 cursor-pointer text-ink-faint transition", open && "rotate-180")}
                        onClick={() => setExpanded((current) => ({ ...current, [environment.id]: !open }))}
                      />
                    </div>
                  </div>

                  {open ? (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="divide-y divide-white/[0.05]">
                      {environment.groups.length ? (
                        environment.groups.map((group) => (
                          <GroupBlock
                            key={group.id}
                            group={group}
                            canWrite={canWrite}
                            onAddServer={() => setServerModal({ id: group.id, name: group.name })}
                          />
                        ))
                      ) : (
                        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-5">
                          <p className="text-[11.5px] text-ink-faint">
                            No server groups yet. Groups are the targets a run can select.
                          </p>
                          <Button
                            variant="secondary"
                            size="sm"
                            icon={<Plus className="h-3.5 w-3.5" />}
                            onClick={() => setGroupModal({ id: environment.id, name: environment.name })}
                            disabled={!canWrite}
                          >
                            Create server group
                          </Button>
                        </div>
                      )}
                    </motion.div>
                  ) : null}
                </Panel>
              );
            })
          )}

          <Panel className="overflow-hidden">
            <div className="flex items-center gap-2 border-b border-white/[0.06] px-5 py-3.5">
              <TriangleAlert className="h-4 w-4 text-signal-amber" />
              <p className="text-[12.5px] font-medium text-ink">Recent failed or blocked runs</p>
            </div>
            {failures.length ? (
              <ul className="divide-y divide-white/[0.05]">
                {failures.map((execution) => (
                  <li key={execution.id}>
                    <ExecutionRow execution={execution} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-6 text-center text-[11.5px] text-ink-faint">
                No failed or blocked executions have been recorded.
              </p>
            )}
          </Panel>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <Panel className="border-signal-amber/20 bg-signal-amber/[0.04] px-5 py-4">
            <p className="flex items-center gap-2 text-[12px] font-medium text-signal-amber">
              <FlaskConical className="h-4 w-4" /> Remote dispatch is not configured in this release
            </p>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-muted">
              Registered agents can authenticate and send heartbeats, but executions currently run through the local
              sandbox and the labelled simulation adapter. Registering an agent does not pretend remote execution works.
            </p>
          </Panel>

          {topology.isLoading ? (
            <div className="grid gap-3 md:grid-cols-2">
              <Skeleton className="h-[200px] w-full" />
              <Skeleton className="h-[200px] w-full" />
            </div>
          ) : agents.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {agents.map((agent) => (
                <AgentCard key={agent.id} agent={agent} environments={envs} />
              ))}
            </div>
          ) : (
            <Panel>
              <EmptyState
                icon={<Cpu className="h-5 w-5" />}
                title="No execution agents registered"
                description="Register an agent to issue a one-time token and begin authenticated heartbeats."
                action={
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<Plus className="h-3.5 w-3.5" />}
                    onClick={() => setAgentOpen(true)}
                    disabled={!canWrite}
                  >
                    Register agent
                  </Button>
                }
              />
            </Panel>
          )}
        </div>
      )}

      <CreateGroupModal
        open={groupModal !== null}
        environmentName={groupModal?.name ?? ""}
        loading={createGroup.isPending}
        onClose={() => setGroupModal(null)}
        onSubmit={submitGroup}
      />

      <CreateServerModal
        open={serverModal !== null}
        groupName={serverModal?.name ?? ""}
        loading={createServer.isPending}
        onClose={() => setServerModal(null)}
        onSubmit={submitServer}
      />

      <RegisterAgentModal
        open={agentOpen}
        environments={envs}
        token={agentToken}
        loading={registerAgent.isPending}
        onClose={() => {
          setAgentOpen(false);
          setAgentToken(null);
        }}
        onSubmit={submitAgent}
      />
    </div>
  );
}

function EnvironmentKindBadge({ kind }: { kind: string }) {
  if (kind === "PRODUCTION") return <Badge tone="amber">Production</Badge>;
  if (kind === "UAT") return <Badge tone="violet">UAT</Badge>;
  return <Badge tone="cyan">Development</Badge>;
}

function GroupBlock({
  group,
  canWrite,
  onAddServer,
}: {
  group: ServerGroup;
  canWrite: boolean;
  onAddServer: () => void;
}) {
  return (
    <div className="px-5 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Boxes className="h-3.5 w-3.5 text-ink-faint" />
          <p className="text-[12px] font-medium text-ink">{group.name}</p>
          <Badge tone="slate">{group.check_protocol}</Badge>
          <span className="text-[10.5px] text-ink-faint">
            {group.servers.length} server{group.servers.length === 1 ? "" : "s"}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon={<Plus className="h-3.5 w-3.5" />}
          onClick={onAddServer}
          disabled={!canWrite}
        >
          Add server
        </Button>
      </div>
      {group.description ? (
        <p className="mt-0.5 text-[10.5px] text-ink-faint">{group.description}</p>
      ) : null}
      {group.servers.length ? (
        <div className="mt-2 overflow-hidden rounded-lg border border-white/[0.06]">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-obsidian-900/60 text-[9.5px] uppercase tracking-[0.12em] text-ink-faint">
                <th className="px-3 py-1.5 font-medium">Host</th>
                <th className="px-3 py-1.5 font-medium">Address</th>
                <th className="hidden px-3 py-1.5 font-medium sm:table-cell">Role</th>
                <th className="px-3 py-1.5 font-medium">Status</th>
                <th className="hidden px-3 py-1.5 text-right font-medium md:table-cell">Last check</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {group.servers.map((server) => (
                <ServerRow key={server.id} server={server} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-2 text-[10.5px] text-ink-faint">
          No servers in this group. Runs that target it will fail preflight until a server is added.
        </p>
      )}
    </div>
  );
}

function ServerRow({ server }: { server: Server }) {
  const tone = statusTone(server.status);
  return (
    <tr className="row-hover bg-obsidian-950/20">
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          {server.status === "REACHABLE" ? (
            <Wifi className="h-3 w-3 text-lime" />
          ) : server.status === "UNREACHABLE" ? (
            <WifiOff className="h-3 w-3 text-signal-red" />
          ) : (
            <CircleDot className="h-3 w-3 text-ink-faint" />
          )}
          <div className="min-w-0">
            <p className="truncate text-[11.5px] text-ink">{server.display_name || server.hostname}</p>
            <p className="mono truncate text-[9.5px] text-ink-faint">{server.hostname}</p>
          </div>
        </div>
      </td>
      <td className="mono whitespace-nowrap px-3 py-2 text-[10.5px] text-ink-muted">
        {server.address}:{server.port}
      </td>
      <td className="hidden px-3 py-2 text-[10.5px] capitalize text-ink-faint sm:table-cell">{server.role}</td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill status={server.status} />
          {server.is_simulated ? (
            <span className="rounded-full border border-signal-amber/25 bg-signal-amber/[0.08] px-1.5 py-0.5 text-[9px] text-signal-amber">
              simulated
            </span>
          ) : null}
        </div>
      </td>
      <td className="hidden px-3 py-2 text-right text-[10px] text-ink-faint md:table-cell">
        {relative(server.last_checked_at)}
      </td>
    </tr>
  );
}

function AgentCard({ agent, environments }: { agent: Agent; environments: { id: string; name: string }[] }) {
  const environment = environments.find((entry) => entry.id === agent.environment_id);
  const tone = statusTone(agent.status);
  return (
    <Panel className="px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-lg border",
              toneClasses[tone].border,
              toneClasses[tone].bg,
              toneClasses[tone].text,
            )}
          >
            <Cpu className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[12.5px] font-medium text-ink">{agent.name}</p>
            <p className="mt-0.5 text-[10.5px] text-ink-faint">
              {humanize(agent.kind)} · {environment?.name ?? "Unassigned"}
            </p>
          </div>
        </div>
        <StatusPill status={agent.status} />
      </div>
      <div className="mt-3 space-y-1.5 text-[10.5px]">
        <div className="flex items-center justify-between gap-2">
          <span className="text-ink-faint">Endpoint</span>
          <span className="mono truncate text-ink-muted">{agent.endpoint || "Not configured"}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-ink-faint">Version</span>
          <span className="text-ink-muted">{agent.version || "—"}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-ink-faint">Last heartbeat</span>
          <span className="text-ink-muted">{relative(agent.last_heartbeat_at)}</span>
        </div>
      </div>
      {agent.capabilities.length ? (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {agent.capabilities.map((capability) => (
            <Badge key={capability} tone="slate">
              {capability}
            </Badge>
          ))}
        </div>
      ) : null}
      {Object.keys(agent.labels ?? {}).length ? (
        <p className="mono mt-2 truncate text-[9.5px] text-ink-faint">
          {Object.entries(agent.labels)
            .map(([key, value]) => `${key}=${value}`)
            .join(" · ")}
        </p>
      ) : null}
    </Panel>
  );
}

function CreateGroupModal({
  open,
  environmentName,
  loading,
  onClose,
  onSubmit,
}: {
  open: boolean;
  environmentName: string;
  loading: boolean;
  onClose: () => void;
  onSubmit: (form: { name: string; description: string; check_protocol: string }) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [protocol, setProtocol] = useState("HTTPS");
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create a server group"
      description={`Group the targets a run can select in ${environmentName || "this environment"}.`}
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
            disabled={name.trim().length < 2}
            onClick={() => onSubmit({ name: name.trim(), description: description.trim(), check_protocol: protocol })}
          >
            Create group
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Group name">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. payment-api-uat" maxLength={140} />
        </Field>
        <Field label="Description" hint="What runs against this group?">
          <Textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={2}
            className="resize-none"
            placeholder="Primary payment services in UAT."
            maxLength={400}
          />
        </Field>
        <Field label="Health check protocol">
          <Select value={protocol} onChange={(event) => setProtocol(event.target.value)}>
            <option value="HTTPS">HTTPS</option>
            <option value="HTTP">HTTP</option>
            <option value="TCP">TCP</option>
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

function CreateServerModal({
  open,
  groupName,
  loading,
  onClose,
  onSubmit,
}: {
  open: boolean;
  groupName: string;
  loading: boolean;
  onClose: () => void;
  onSubmit: (form: {
    hostname: string;
    display_name: string;
    address: string;
    port: number;
    role: string;
    is_simulated: boolean;
  }) => void;
}) {
  const [hostname, setHostname] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [address, setAddress] = useState("");
  const [port, setPort] = useState("443");
  const [role, setRole] = useState("application");
  const [simulated, setSimulated] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Register a server"
      description={`Add a target to ${groupName || "this group"}. Status is honest: JUNE checks reachability rather than assuming it.`}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={<ServerIcon className="h-4 w-4" />}
            loading={loading}
            disabled={hostname.trim().length < 2 || address.trim().length < 1}
            onClick={() =>
              onSubmit({
                hostname: hostname.trim(),
                display_name: displayName.trim(),
                address: address.trim(),
                port: Number(port) || 443,
                role: role.trim() || "application",
                is_simulated: simulated,
              })
            }
          >
            Add server
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Hostname">
          <Input value={hostname} onChange={(event) => setHostname(event.target.value)} placeholder="pay-01.internal" />
        </Field>
        <Field label="Display name">
          <Input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Payments 01"
          />
        </Field>
        <Field label="Address">
          <Input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="10.20.4.11" />
        </Field>
        <Field label="Port">
          <Input type="number" min={1} max={65535} value={port} onChange={(event) => setPort(event.target.value)} />
        </Field>
        <Field label="Role">
          <Input value={role} onChange={(event) => setRole(event.target.value)} placeholder="application" />
        </Field>
        <div className="flex items-end pb-1">
          <Toggle
            checked={simulated}
            onChange={setSimulated}
            label="Simulated target"
            description="Labelled in the UI and excluded from real reachability claims."
          />
        </div>
      </div>
    </Modal>
  );
}

function RegisterAgentModal({
  open,
  environments,
  token,
  loading,
  onClose,
  onSubmit,
}: {
  open: boolean;
  environments: { id: string; name: string }[];
  token: string | null;
  loading: boolean;
  onClose: () => void;
  onSubmit: (form: { name: string; kind: string; environment_id: string; endpoint: string }) => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("REMOTE_AGENT");
  const [environmentId, setEnvironmentId] = useState("");
  const [endpoint, setEndpoint] = useState("");

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={token ? "Agent token issued" : "Register an execution agent"}
      description={
        token
          ? "This token is shown once. Store it in the agent's secret configuration."
          : "Registration issues a one-time token. Remote dispatch remains disabled until an agent runtime is configured."
      }
      size="md"
      footer={
        token ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon={<Cpu className="h-4 w-4" />}
              loading={loading}
              disabled={name.trim().length < 2}
              onClick={() => onSubmit({ name: name.trim(), kind, environment_id: environmentId, endpoint: endpoint.trim() })}
            >
              Register agent
            </Button>
          </>
        )
      }
    >
      {token ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-signal-amber/30 bg-signal-amber/[0.06] px-4 py-3">
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-signal-amber">
              <TriangleAlert className="h-3.5 w-3.5" /> Copy this token now
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
              JUNE stores only a SHA-256 hash. This value cannot be retrieved again.
            </p>
            <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-white/10 bg-obsidian-950/70 px-3 py-2">
              <code className="mono min-w-0 flex-1 break-all text-[10.5px] text-lime">{token}</code>
              <CopyButton value={token} />
            </div>
          </div>
          <p className="text-[11px] leading-relaxed text-ink-faint">
            The agent authenticates heartbeats with the <span className="mono">X-Agent-Token</span> header. Until a
            heartbeat arrives it is shown as offline.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <Field label="Agent name">
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="uat-runner-01" maxLength={140} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Kind">
              <Select value={kind} onChange={(event) => setKind(event.target.value)}>
                <option value="REMOTE_AGENT">Remote agent</option>
                <option value="KUBERNETES">Kubernetes runner</option>
                <option value="LOCAL_SANDBOX">Local sandbox</option>
              </Select>
            </Field>
            <Field label="Environment">
              <Select value={environmentId} onChange={(event) => setEnvironmentId(event.target.value)}>
                <option value="">Unassigned</option>
                {environments.map((environment) => (
                  <option key={environment.id} value={environment.id}>
                    {environment.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Endpoint" hint="Optional. The agent's reachable base URL.">
            <Input
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              placeholder="https://runner-01.internal:9100"
            />
          </Field>
          <p className="flex items-start gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-[10.5px] leading-relaxed text-ink-faint">
            <Globe className="mt-0.5 h-3 w-3 shrink-0 text-cyan" />
            Registering does not enable remote execution by itself. This release executes through the local sandbox and
            simulation adapter, and says so plainly.
          </p>
        </div>
      )}
    </Modal>
  );
}
