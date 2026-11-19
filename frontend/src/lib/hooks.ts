"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, query } from "@/lib/api";
import type {
  AdminUser,
  Agent,
  AnalyticsOverview,
  Approval,
  Artifact,
  AuditEvent,
  AutomationDetail,
  AutomationSummary,
  AutomationVersion,
  DashboardOverview,
  Environment,
  EnvironmentDetail,
  ExecutionDetail,
  ExecutionInsight,
  ExecutionLog,
  ExecutionSummary,
  Finding,
  IntegrityReport,
  Integration,
  Notification,
  Page,
  Policy,
  Preflight,
  PulseSnapshot,
  RoleWithPermissions,
  Scan,
  ServerGroup,
  SessionResponse,
  SystemHealth,
  Team,
  User,
  WorkflowDefinition,
  WorkflowListItem,
  Workflow,
} from "@/lib/types";

const ACTIVE = new Set(["QUEUED", "RUNNING", "WAITING_FOR_APPROVAL"]);

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ user: User }>("/auth/me"),
    staleTime: 60_000,
    retry: false,
  });
}

export function useLogin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: { email: string; password: string }) =>
      api<SessionResponse>("/auth/login", { method: "POST", body: payload }),
    onSuccess: (data) => {
      client.setQueryData(["me"], { user: data.user });
    },
  });
}

export function useLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ message: string }>("/auth/logout", { method: "POST" }),
    onSettled: () => {
      client.clear();
    },
  });
}

export function useUpdatePreferences() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (preferences: User["preferences"]) =>
      api<{ user: User }>("/auth/me/preferences", { method: "PATCH", body: preferences }),
    onSuccess: (data) => client.setQueryData(["me"], data),
  });
}

export function useDashboard(days = 7) {
  return useQuery({
    queryKey: ["dashboard", days],
    queryFn: () => api<DashboardOverview>(`/dashboard/overview${query({ days })}`),
    refetchInterval: 10_000,
  });
}

export function usePulse() {
  return useQuery({
    queryKey: ["pulse"],
    queryFn: () => api<PulseSnapshot>("/pulse"),
    refetchInterval: 12_000,
  });
}

export function useAutomations(params: {
  q?: string;
  category?: string;
  environment?: string;
  status?: string;
  page?: number;
  page_size?: number;
} = {}) {
  return useQuery({
    queryKey: ["automations", params],
    queryFn: () => api<Page<AutomationSummary>>(`/automations${query({ ...params, status: params.status ?? "ACTIVE" })}`),
    placeholderData: (previous) => previous,
  });
}

export function useAllAutomations() {
  return useQuery({
    queryKey: ["automations", "all"],
    queryFn: () => api<Page<AutomationSummary>>("/automations?page_size=100&status=ACTIVE"),
    staleTime: 30_000,
  });
}

export function useAutomation(id: string | null | undefined) {
  return useQuery({
    queryKey: ["automation", id],
    queryFn: () => api<AutomationDetail>(`/automations/${id}`),
    enabled: Boolean(id),
  });
}

export function useRunnerTemplates() {
  return useQuery({
    queryKey: ["runner-templates"],
    queryFn: () =>
      api<{ key: string; name: string; category: string; summary: string; params_schema: Record<string, unknown> }[]>(
        "/automations/runner-templates",
      ),
    staleTime: 300_000,
  });
}

export function usePublishVersion() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ automationId, version, changelog }: { automationId: string; version: string; changelog: string }) =>
      api<AutomationVersion>(`/automations/${automationId}/versions`, {
        method: "POST",
        body: { version, changelog },
      }),
    onSuccess: (_data, variables) => {
      void client.invalidateQueries({ queryKey: ["automation", variables.automationId] });
      void client.invalidateQueries({ queryKey: ["automations"] });
    },
  });
}

export function useCreateAutomation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api<AutomationDetail>("/automations", { method: "POST", body: payload }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["automations"] }),
  });
}

export function useExecutions(params: {
  status?: string;
  environment?: string;
  automation_id?: string;
  q?: string;
  page?: number;
  page_size?: number;
} = {}, enabled = true) {
  return useQuery({
    queryKey: ["executions", params],
    queryFn: () => api<Page<ExecutionSummary>>(`/executions${query(params)}`),
    placeholderData: (previous) => previous,
    refetchInterval: 8_000,
    enabled,
  });
}

export function useExecution(id: string | null | undefined) {
  return useQuery({
    queryKey: ["execution", id],
    queryFn: () => api<ExecutionDetail>(`/executions/${id}`),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && ACTIVE.has(status) ? 4_000 : false;
    },
  });
}

export function useExecutionLogs(id: string | null | undefined) {
  return useQuery({
    queryKey: ["execution-logs", id],
    queryFn: () => api<ExecutionLog[]>(`/executions/${id}/logs?limit=2000`),
    enabled: Boolean(id),
  });
}

export function useExecutionInsight(id: string | null | undefined) {
  return useQuery({
    queryKey: ["execution-insight", id],
    queryFn: () => api<ExecutionInsight>(`/executions/${id}/insight`),
    enabled: Boolean(id),
  });
}

export function useExecutionArtifacts(id: string | null | undefined) {
  return useQuery({
    queryKey: ["execution-artifacts", id],
    queryFn: () => api<Artifact[]>(`/executions/${id}/artifacts`),
    enabled: Boolean(id),
  });
}

export function usePreflight() {
  return useMutation({
    mutationFn: (payload: { automation_id: string; environment_id: string; server_group_id?: string | null; params: Record<string, unknown> }) =>
      api<Preflight>("/executions/preflight", { method: "POST", body: payload }),
  });
}

export function useSubmitExecution() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      automation_id: string;
      environment_id: string;
      server_group_id?: string | null;
      params: Record<string, unknown>;
      reason: string;
      idempotency_key?: string;
    }) => api<ExecutionDetail>("/executions", { method: "POST", body: payload }),
    onSuccess: (data) => {
      client.setQueryData(["execution", data.id], data);
      void client.invalidateQueries({ queryKey: ["executions"] });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useCancelExecution() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api<ExecutionDetail>(`/executions/${id}/cancel`, { method: "POST", body: { reason } }),
    onSuccess: (data) => {
      client.setQueryData(["execution", data.id], data);
      void client.invalidateQueries({ queryKey: ["executions"] });
    },
  });
}

export function useApprovals(status = "PENDING", enabled = true) {
  return useQuery({
    queryKey: ["approvals", status],
    queryFn: () => api<Page<Approval>>(`/approvals${query({ status, page_size: 100 })}`).then((page) => page.items),
    refetchInterval: 10_000,
    enabled,
  });
}

export function useApprovalDecision() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision, comment, reason }: { id: string; decision: "approve" | "reject"; comment: string; reason: string }) =>
      api<Approval>(`/approvals/${id}/${decision}`, { method: "POST", body: { comment, reason } }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["approvals"] });
      void client.invalidateQueries({ queryKey: ["executions"] });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
      void client.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function useSecuritySummary() {
  return useQuery({
    queryKey: ["security-summary"],
    queryFn: () =>
      api<{
        open_findings: Record<string, number>;
        total_open: number;
        scans_total: number;
        scans_failed: number;
        executions_blocked: number;
        scanner_coverage: {
          built_in_secret_rules: boolean;
          built_in_dependency_policy: boolean;
          external_vulnerability_db: boolean;
          note: string;
        };
      }>("/security/summary"),
    refetchInterval: 20_000,
  });
}

export function useScans(limit = 50) {
  return useQuery({
    queryKey: ["scans", limit],
    queryFn: () => api<Page<Scan>>(`/security/scans?page_size=${limit}`),
  });
}

export function useFindings(params: { severity?: string; status?: string } = {}) {
  return useQuery({
    queryKey: ["findings", params],
    queryFn: () => api<Page<Finding>>(`/security/findings${query({ ...params, page_size: 100 })}`),
  });
}

export function usePolicies() {
  return useQuery({
    queryKey: ["policies"],
    queryFn: () => api<Policy[]>("/security/policies"),
  });
}

export function useRunScan() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (automationId: string) =>
      api<Scan[]>("/security/scans", { method: "POST", body: { automation_id: automationId } }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["scans"] });
      void client.invalidateQueries({ queryKey: ["findings"] });
      void client.invalidateQueries({ queryKey: ["security-summary"] });
    },
  });
}

export function useAnalytics(days = 30) {
  return useQuery({
    queryKey: ["analytics", days],
    queryFn: () => api<AnalyticsOverview>(`/analytics/overview${query({ days })}`),
  });
}

export function useAuditEvents(params: {
  action?: string;
  resource_type?: string;
  outcome?: string;
  q?: string;
  page?: number;
  page_size?: number;
} = {}) {
  return useQuery({
    queryKey: ["audit", params],
    queryFn: () => api<Page<AuditEvent>>(`/audit-events${query(params)}`),
    placeholderData: (previous) => previous,
  });
}

export function useAuditActions() {
  return useQuery({
    queryKey: ["audit-actions"],
    queryFn: () => api<{ action: string; resource_type: string; count: number }[]>("/audit-events/actions"),
    staleTime: 120_000,
  });
}

export function useAuditIntegrity() {
  return useQuery({
    queryKey: ["audit-integrity"],
    queryFn: () => api<IntegrityReport>("/audit-events/integrity"),
    staleTime: 30_000,
  });
}

export function useIntegrations() {
  return useQuery({
    queryKey: ["integrations"],
    queryFn: () => api<Integration[]>("/integrations"),
  });
}

export function useTestIntegration() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (key: string) =>
      api<{ key: string; status: string; message: string; checked_at: string; latency_ms: number | null }>(
        `/integrations/${key}/test`,
        { method: "POST" },
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: ["integrations"] }),
  });
}

export function useRefreshIntegrations() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<Integration[]>("/integrations/refresh", { method: "POST" }),
    onSuccess: (data) => client.setQueryData(["integrations"], data),
  });
}

export function useNotifications() {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<Page<Notification>>("/notifications?page_size=30"),
    refetchInterval: 30_000,
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: ["notifications-unread"],
    queryFn: () => api<{ unread: number }>("/notifications/unread-count"),
    refetchInterval: 25_000,
  });
}

export function useMarkNotification() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (action: { id?: string; all?: boolean }): Promise<unknown> =>
      action.all
        ? api<{ message: string }>("/notifications/read-all", { method: "POST" })
        : api<Notification>(`/notifications/${action.id}/read`, { method: "POST" }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["notifications"] });
      void client.invalidateQueries({ queryKey: ["notifications-unread"] });
    },
  });
}

export function useWorkflows() {
  return useQuery({
    queryKey: ["workflows"],
    queryFn: () => api<WorkflowListItem[]>("/workflows"),
  });
}

export function useWorkflow(id: string | null | undefined) {
  return useQuery({
    queryKey: ["workflow", id],
    queryFn: () => api<Workflow>(`/workflows/${id}`),
    enabled: Boolean(id),
  });
}

export function useStageLibrary() {
  return useQuery({
    queryKey: ["stage-library"],
    queryFn: () => api<{ key: string; name: string; description: string }[]>("/workflows/stage-library"),
    staleTime: 300_000,
  });
}

export function useValidateWorkflow() {
  return useMutation({
    mutationFn: ({ id, definition }: { id: string; definition: WorkflowDefinition }) =>
      api<{ valid: boolean; issues: { severity: string; node_id: string | null; message: string }[]; checksum: string }>(
        `/workflows/${id}/validate`,
        { method: "POST", body: { definition } },
      ),
  });
}

export function useSaveWorkflow() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name, definition }: { id: string; name: string; definition: WorkflowDefinition }) =>
      api<Workflow>(`/workflows/${id}`, { method: "PUT", body: { name, definition } }),
    onSuccess: (data) => {
      client.setQueryData(["workflow", data.id], data);
      void client.invalidateQueries({ queryKey: ["workflows"] });
    },
  });
}

export function usePublishWorkflow() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<Workflow>(`/workflows/${id}/publish`, { method: "POST" }),
    onSuccess: (data) => {
      client.setQueryData(["workflow", data.id], data);
      void client.invalidateQueries({ queryKey: ["workflows"] });
    },
  });
}

export function useEnvironments() {
  return useQuery({
    queryKey: ["environments"],
    queryFn: () => api<Environment[]>("/environments"),
  });
}

export function useEnvironment(id: string | null | undefined) {
  return useQuery({
    queryKey: ["environment", id],
    queryFn: () => api<EnvironmentDetail>(`/environments/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateGroup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ environmentId, payload }: { environmentId: string; payload: { name: string; description?: string; check_protocol?: string } }) =>
      api<ServerGroup>(`/environments/${environmentId}/groups`, { method: "POST", body: payload }),
    onSuccess: (_data, variables) => {
      void client.invalidateQueries({ queryKey: ["environment", variables.environmentId] });
      void client.invalidateQueries({ queryKey: ["environments"] });
      void client.invalidateQueries({ queryKey: ["topology"] });
    },
  });
}

export function useCreateServer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      groupId,
      payload,
    }: {
      groupId: string;
      payload: { hostname: string; display_name?: string; address: string; port?: number; role?: string; is_simulated?: boolean };
    }) => api<ServerGroup["servers"][number]>(`/server-groups/${groupId}/servers`, { method: "POST", body: payload }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["environment"] });
      void client.invalidateQueries({ queryKey: ["environments"] });
      void client.invalidateQueries({ queryKey: ["topology"] });
    },
  });
}

export function useRegisterAgent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: { name: string; kind: string; environment_id?: string | null; endpoint?: string; capabilities?: string[]; labels?: Record<string, string> }) =>
      api<{
        agent: { id: string; name: string; kind: string; environment_id: string | null; status: string };
        token: string;
        token_notice: string;
      }>("/infrastructure/agents", { method: "POST", body: payload }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["environment"] });
      void client.invalidateQueries({ queryKey: ["topology"] });
      void client.invalidateQueries({ queryKey: ["system-health"] });
    },
  });
}

export function useTopology() {
  return useQuery({
    queryKey: ["topology"],
    queryFn: () =>
      api<{
        generated_at: string;
        environments: (EnvironmentDetail & {
          servers_total: number;
          servers_reachable: number;
          servers_unreachable: number;
          servers_simulated: number;
        })[];
        agents: Agent[];
        recent_failures: ExecutionSummary[];
      }>("/infrastructure/topology"),
  });
}

export function useAdminUsers(enabled = true) {
  return useQuery({
    queryKey: ["admin-users"],
    queryFn: () => api<AdminUser[]>("/admin/users"),
    enabled,
  });
}

export function useRoles(enabled = true) {
  return useQuery({
    queryKey: ["roles"],
    queryFn: () => api<RoleWithPermissions[]>("/admin/roles"),
    staleTime: 300_000,
    enabled,
  });
}

export function useTeams(enabled = true) {
  return useQuery({
    queryKey: ["teams"],
    queryFn: () => api<Team[]>("/admin/teams"),
    enabled,
  });
}

export function useCreateUser() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: { email: string; full_name: string; title?: string; password: string; role_key: string; team_id?: string | null }) =>
      api<AdminUser>("/admin/users", { method: "POST", body: payload }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["admin-users"] }),
  });
}

export function useUpdateUser() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      api<AdminUser>(`/admin/users/${id}`, { method: "PATCH", body: payload }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["admin-users"] }),
  });
}

export function useCreateTeam() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: { name: string; slug: string; description?: string }) =>
      api<Team>("/admin/teams", { method: "POST", body: payload }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["teams"] }),
  });
}

export function useSystemHealth() {
  return useQuery({
    queryKey: ["system-health"],
    queryFn: () => api<SystemHealth>("/system/health"),
    refetchInterval: 20_000,
  });
}

export function useAdminSummary(enabled = true) {
  return useQuery({
    queryKey: ["admin-summary"],
    queryFn: () => api<Record<string, unknown>>("/admin/summary"),
    enabled,
  });
}

export { ACTIVE };
