export type ExecutionStatus =
  | "QUEUED"
  | "RUNNING"
  | "WAITING_FOR_APPROVAL"
  | "SUCCEEDED"
  | "FAILED"
  | "BLOCKED"
  | "TIMED_OUT"
  | "CANCELLED";

export type StageStatus = "PENDING" | "RUNNING" | "WAITING_FOR_APPROVAL" | "SUCCEEDED" | "FAILED" | "SKIPPED" | "CANCELLED";

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export interface Role {
  id: string;
  key: string;
  name: string;
  description: string;
}

export interface Team {
  id: string;
  name: string;
  slug: string;
}

export interface User {
  id: string;
  email: string;
  full_name: string;
  title: string;
  is_active: boolean;
  preferences: {
    beginner_mode?: boolean;
    reduce_motion?: boolean;
    density?: "comfortable" | "compact";
    timezone?: string;
  };
  last_login_at: string | null;
  created_at: string;
  role: Role;
  team: Team | null;
  permissions: string[];
}

export interface UserTiny {
  id: string;
  full_name: string;
  email: string;
  title: string;
}

export interface SessionResponse {
  user: User;
  csrf_token: string;
  expires_in: number;
}

export interface EnvironmentMini {
  id: string;
  key: string;
  name: string;
  kind: "DEVELOPMENT" | "UAT" | "PRODUCTION";
  execution_mode: "LOCAL_SANDBOX" | "SIMULATION" | "REMOTE_AGENT";
  approval_required: boolean;
  color: string;
}

export interface Environment extends EnvironmentMini {
  description: string;
  sort_order: number;
  is_active: boolean;
  server_count: number;
  group_count: number;
  last_execution_at: string | null;
}

export interface Server {
  id: string;
  hostname: string;
  display_name: string;
  address: string;
  port: number;
  role: string;
  is_simulated: boolean;
  status: string;
  last_checked_at: string | null;
  details: Record<string, unknown>;
}

export interface ServerGroup {
  id: string;
  name: string;
  slug: string;
  description: string;
  check_protocol: string;
  environment_id: string;
  servers: Server[];
}

export interface Agent {
  id: string;
  name: string;
  kind: string;
  environment_id: string | null;
  status: string;
  endpoint: string;
  version: string;
  capabilities: string[];
  labels: Record<string, string>;
  last_heartbeat_at: string | null;
}

export interface EnvironmentDetail extends Environment {
  groups: ServerGroup[];
  agents: Agent[];
}

export interface AutomationSummary {
  id: string;
  slug: string;
  name: string;
  summary: string;
  category: string;
  icon: string;
  risk_level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: string;
  tags: string[];
  supported_environments: string[];
  current_version: string;
  approval_required: boolean;
  timeout_seconds: number;
  is_sample: boolean;
  owner: UserTiny | null;
  team_name: string | null;
  created_at: string;
  updated_at: string;
  execution_count: number;
  success_rate: number | null;
  last_execution_at: string | null;
  last_execution_status: ExecutionStatus | null;
}

export interface AutomationVersion {
  id: string;
  version: string;
  checksum: string;
  changelog: string;
  status: string;
  created_at: string;
  created_by: string | null;
  manifest: Record<string, unknown>;
}

export interface WorkflowVersion {
  id: string;
  version: number;
  checksum: string;
  status: string;
  published_at: string | null;
  definition: WorkflowDefinition;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  status: string;
  is_default: boolean;
  automation_id: string;
  versions: WorkflowVersion[];
}

export interface WorkflowListItem extends Workflow {
  automation_name: string;
  automation_slug: string;
  automation_icon: string;
}

export interface WorkflowNode {
  id: string;
  type: string;
  stage_key: string;
  label: string;
  description: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  condition?: string | null;
}

export interface WorkflowDefinition {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  version: number;
}

export interface AutomationDetail extends AutomationSummary {
  what_it_does: string;
  why_it_exists: string;
  when_to_use: string;
  expected_output: string;
  what_could_go_wrong: string;
  failure_guidance: string;
  systems_affected: string[];
  required_permissions: string[];
  language: string;
  execution_type: string;
  runner_key: string;
  input_schema: JsonSchema;
  output_schema: JsonSchema;
  concurrency_limit: number;
  repository_path: string;
  repository: {
    id: string;
    name: string;
    provider: string;
    url: string;
    default_branch: string;
    status: string;
    last_synced_at: string | null;
  } | null;
  versions: AutomationVersion[];
  workflow: Workflow | null;
}

export interface JsonSchema {
  type?: string;
  title?: string;
  description?: string;
  properties?: Record<
    string,
    {
      type?: string;
      title?: string;
      description?: string;
      default?: unknown;
      enum?: string[];
      minimum?: number;
      maximum?: number;
      maxLength?: number;
      minItems?: number;
      maxItems?: number;
      items?: { type?: string; maxLength?: number };
    }
  >;
  required?: string[];
}

export interface ExecutionSummary {
  id: string;
  display_id: string;
  automation: {
    id: string;
    slug: string;
    name: string;
    icon: string;
    category: string;
    risk_level: string;
    current_version: string;
  };
  automation_version: string;
  requested_by_user: UserTiny;
  environment: EnvironmentMini;
  server_group: { id: string; name: string; slug: string; check_protocol: string } | null;
  status: ExecutionStatus;
  execution_mode: string;
  adapter: string;
  reason: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  current_stage: string | null;
  progress: number;
  error_code: string | null;
  error_message: string | null;
}

export interface ExecutionStage {
  id: string;
  key: string;
  name: string;
  description: string;
  order_index: number;
  status: StageStatus;
  attempt: number;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  output: Record<string, unknown>;
  error_message: string | null;
}

export interface ApprovalMini {
  id: string;
  status: string;
  requested_by: string;
  decided_by: string | null;
  candidate_hash: string;
  comment: string;
  created_at: string;
  decided_at: string | null;
}

export interface ExecutionDetail extends ExecutionSummary {
  workflow_version_id: string;
  params: Record<string, unknown>;
  candidate_hash: string;
  timeout_seconds: number;
  cancel_requested: boolean;
  result_summary: {
    headline?: string;
    details?: string[];
    blocked_reason?: string;
    environment?: string;
    simulated?: boolean;
    [key: string]: unknown;
  };
  stages: ExecutionStage[];
  approval: ApprovalMini | null;
}

export interface ExecutionLog {
  id: number;
  execution_id: string;
  stage_key: string | null;
  level: "INFO" | "SUCCESS" | "WARN" | "ERROR" | "DEBUG";
  source: string;
  message: string;
  created_at: string;
}

export interface Artifact {
  id: string;
  name: string;
  kind: string;
  size_bytes: number;
  checksum: string;
  created_at: string;
}

export interface Preflight {
  checks: {
    key: string;
    name: string;
    status: "PASS" | "WARN" | "FAIL";
    severity: string;
    message: string;
    blocking: boolean;
  }[];
  can_submit: boolean;
  requires_approval: boolean;
  blocking_issues: string[];
  evaluated_by: string;
}

export interface ExecutionInsight {
  execution_id: string;
  status: string;
  insight: {
    category: string;
    title: string;
    explanation: string;
    likely_causes: string[];
    suggested_steps: string[];
    deterministic: boolean;
  } | null;
}

export interface Approval {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "INVALIDATED";
  automation: ExecutionSummary["automation"];
  automation_version: string;
  candidate_hash: string;
  requested_by: string;
  requester: UserTiny;
  decided_by: string | null;
  decider: UserTiny | null;
  environment: EnvironmentMini;
  comment: string;
  decision_reason: string;
  evidence: {
    candidate?: {
      hash?: string;
      automation_version?: string;
      environment?: string;
      server_group?: string | null;
      workflow_version?: number;
      workflow_checksum?: string;
    };
    security?: Array<{ kind: string; status: string; findings: number; severity_counts: Record<string, number> }>;
    uat?: Record<string, unknown>;
    risk_level?: string;
    systems_affected?: string[];
    what_could_go_wrong?: string;
    impact?: string;
  };
  created_at: string;
  decided_at: string | null;
  expires_at: string | null;
  execution: ExecutionSummary | null;
}

export interface Scan {
  id: string;
  automation: ExecutionSummary["automation"];
  automation_version: string;
  kind: string;
  status: string;
  scanner: string;
  summary: Record<string, unknown>;
  artifact_path: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  findings: Finding[];
}

export interface Finding {
  id: string;
  severity: string;
  title: string;
  description: string;
  file_path: string | null;
  line_number: number | null;
  rule_id: string | null;
  remediation: string;
  status: string;
}

export interface Policy {
  id: string;
  key: string;
  name: string;
  description: string;
  severity: string;
  mode: string;
  applies_to: string;
  rules: Record<string, unknown>;
  is_active: boolean;
  version: number;
}

export interface AuditEvent {
  id: number;
  actor_id: string | null;
  actor_label: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  outcome: string;
  details: Record<string, unknown>;
  ip_address: string;
  prev_hash: string;
  hash: string;
  created_at: string;
}

export interface IntegrityReport {
  valid: boolean;
  checked_events: number;
  first_invalid_event_id: number | null;
  message: string;
}

export interface Integration {
  id: string;
  key: string;
  name: string;
  category: string;
  description: string;
  setup_hint: string;
  docs_url: string;
  status: "CONFIGURED" | "NOT_CONFIGURED" | "ERROR" | "DEGRADED";
  config: Record<string, unknown>;
  message: string;
  last_checked_at: string | null;
}

export interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string;
  resource_type: string | null;
  resource_id: string | null;
  read_at: string | null;
  created_at: string;
}

export interface KpiCard {
  key: string;
  label: string;
  value: number;
  unit: string | null;
  delta: number | null;
  trend: string | null;
  help: string;
  href: string;
}

export interface SeriesPoint {
  label: string;
  succeeded: number;
  failed: number;
  blocked: number;
  total: number;
}

export interface EnvironmentHealth {
  id: string;
  key: string;
  name: string;
  kind: string;
  execution_mode: string;
  status: string;
  detail: string;
  success_rate: number | null;
  executions_in_range: number;
  last_execution_at: string | null;
  servers_total: number;
  reachable: number;
  unreachable: number;
  simulated: number;
  unknown: number;
  agents_online: number;
  agents_total: number;
}

export interface ActiveAlert {
  id: string;
  severity: string;
  title: string;
  message: string;
  href: string;
  ts: string;
}

export interface DashboardOverview {
  generated_at: string;
  range_days: number;
  kpis: KpiCard[];
  execution_series: SeriesPoint[];
  environment_health: EnvironmentHealth[];
  recent_executions: ExecutionSummary[];
  recent_failures: ExecutionSummary[];
  pending_approvals: Approval[];
  recent_audit: AuditEvent[];
  active_alerts: ActiveAlert[];
  live_pulse: {
    active?: number;
    running?: number;
    queued?: number;
    utilization?: number;
    capacity?: number;
    agents_online?: number;
    agents_total?: number;
    failure_rate_24h?: number | null;
  };
}

export interface PulseSnapshot {
  generated_at: string;
  active_executions: ExecutionSummary[];
  queue_depth: number;
  runner_utilization: number;
  agents: Agent[];
  failure_rate_24h: number | null;
  recent_events: AuditEvent[];
  environment_health: Record<string, unknown>[];
  stale: boolean;
}

export interface AnalyticsOverview {
  range_days: number;
  total_executions: number;
  success_rate: number | null;
  avg_duration_ms: number | null;
  by_day: SeriesPoint[];
  by_automation: { automation_id: string; name: string; executions: number; success_rate: number | null; avg_duration_ms: number | null }[];
  by_environment: { key: string; name: string; executions: number; succeeded: number; failed: number; color: string }[];
  failures: { code: string; label: string; count: number }[];
  approvals: { pending: number; approved: number; rejected: number; avg_decision_minutes: number | null };
}

export interface HealthComponent {
  key: string;
  name: string;
  status: string;
  detail: string;
  latency_ms: number | null;
  checked_at: string;
}

export interface SystemHealth {
  status: string;
  version: string;
  environment: string;
  generated_at: string;
  components: HealthComponent[];
}

export interface AdminUser {
  id: string;
  email: string;
  full_name: string;
  title: string;
  is_active: boolean;
  preferences: Record<string, unknown>;
  last_login_at: string | null;
  created_at: string;
  role: Role;
  team: Team | null;
}

export interface RoleWithPermissions extends Role {
  permissions: string[];
}
