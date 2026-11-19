"use client";

import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUpRight,
  CheckCircle2,
  CircleAlert,
  GitBranch,
  Info,
  Lock,
  Maximize2,
  Plus,
  Rocket,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wand2,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  Textarea,
  useBeginner,
} from "@/components/ui/primitives";
import { ApiError } from "@/lib/api";
import {
  useMe,
  usePublishWorkflow,
  useSaveWorkflow,
  useStageLibrary,
  useValidateWorkflow,
  useWorkflow,
  useWorkflows,
} from "@/lib/hooks";
import { can } from "@/lib/nav";
import { toast } from "@/lib/stores";
import type { WorkflowDefinition, WorkflowNode } from "@/lib/types";
import {
  cn,
  formatDate,
  humanize,
  newId,
  shortenHash,
  stageIcon,
} from "@/lib/utils";

const REQUIRED_STAGES = new Set(["source_checkout", "input_validation", "security_scan", "verification"]);
const SPECIAL_STAGES = new Set(["approval_gate", "production_deploy"]);

type StageNodeData = {
  stageKey: string;
  label: string;
  description: string;
};

type StageNode = Node<StageNodeData, "stage">;

type ValidationResult = {
  valid: boolean;
  issues: { severity: string; node_id: string | null; message: string }[];
  checksum: string;
};

function StageNodeCard({ data, selected }: NodeProps<StageNode>) {
  const Icon = stageIcon(data.stageKey);
  const isApproval = data.stageKey === "approval_gate";
  const isProduction = data.stageKey === "production_deploy";
  return (
    <div
      className={cn(
        "w-[176px] rounded-lg border bg-obsidian-800/95 px-2.5 py-2 shadow-[0_14px_40px_-24px_rgba(0,0,0,0.9)] backdrop-blur transition",
        selected
          ? "border-lime/60 shadow-[0_0_0_1px_rgba(214,255,118,0.25),0_18px_50px_-26px_rgba(214,255,118,0.35)]"
          : isApproval
            ? "border-signal-amber/35"
            : isProduction
              ? "border-signal-amber/25"
              : "border-white/[0.12]",
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-2 !border-obsidian-850 !bg-ink-faint transition hover:!bg-lime"
      />
      <div className="flex items-start gap-1.5">
        <span
          className={cn(
            "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border",
            isApproval || isProduction
              ? "border-signal-amber/25 bg-signal-amber/10 text-signal-amber"
              : selected
                ? "border-lime/30 bg-lime/10 text-lime"
                : "border-white/10 bg-white/[0.03] text-ink-muted",
          )}
        >
          <Icon className="h-3 w-3" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[10.5px] font-medium leading-tight text-ink" title={data.label}>{data.label}</p>
          <p className="mono mt-0.5 truncate text-[8.5px] text-ink-faint">{data.stageKey}</p>
        </div>
      </div>
      <div className="mt-1.5 flex items-center gap-1">
        {REQUIRED_STAGES.has(data.stageKey) ? (
          <span className="rounded-full bg-white/[0.05] px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-[0.08em] text-ink-faint">
            required
          </span>
        ) : null}
        {isApproval ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-signal-amber/10 px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-[0.08em] text-signal-amber">
            <Lock className="h-2.5 w-2.5" /> gate
          </span>
        ) : null}
        {isProduction ? (
          <span className="rounded-full bg-signal-amber/10 px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-[0.08em] text-signal-amber">
            production
          </span>
        ) : null}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-2 !border-obsidian-850 !bg-lime transition hover:!bg-lime-soft"
      />
    </div>
  );
}

const nodeTypes = { stage: StageNodeCard };

const COLUMN_STEP = 196;
const ROW_STEP = 104;
const LAYOUT_ORIGIN = 24;

function orderedByFlow(nodes: StageNode[], edges: Edge[]): StageNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, string[]>();
  edges.forEach((edge) => {
    const targets = outgoing.get(edge.source) ?? [];
    targets.push(edge.target);
    outgoing.set(edge.source, targets);
  });
  const hasIncoming = new Set(edges.map((edge) => edge.target));
  const start = nodes.find((node) => !hasIncoming.has(node.id)) ?? nodes[0];
  const seen = new Set<string>();
  const ordered: StageNode[] = [];
  const visit = (id: string) => {
    if (seen.has(id)) return;
    const node = byId.get(id);
    if (!node) return;
    seen.add(id);
    ordered.push(node);
    (outgoing.get(id) ?? []).forEach(visit);
  };
  if (start) visit(start.id);
  nodes.forEach((node) => {
    if (!seen.has(node.id)) ordered.push(node);
  });
  return ordered;
}

function arrange(nodes: StageNode[], edges: Edge[], columns: number): StageNode[] {
  return orderedByFlow(nodes, edges).map((node, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    return {
      ...node,
      position: { x: LAYOUT_ORIGIN + column * COLUMN_STEP, y: LAYOUT_ORIGIN + row * ROW_STEP },
    };
  });
}

function responsiveColumns(): number {
  if (typeof window === "undefined") return 4;
  if (window.innerWidth < 640) return 2;
  if (window.innerWidth < 1280) return 3;
  return 4;
}

export default function StudioPage() {
  return (
    <Suspense fallback={<StudioSkeleton />}>
      <StudioContent />
    </Suspense>
  );
}

function StudioSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 pb-16 pt-7 sm:px-6 lg:px-8">
      <Skeleton className="h-9 w-56" />
      <Skeleton className="mt-4 h-4 w-[420px]" />
      <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Skeleton className="h-[420px] w-full sm:h-[500px] xl:h-[560px]" />
        <Skeleton className="h-[420px] w-full" />
      </div>
    </div>
  );
}

function StudioContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const me = useMe();
  const beginner = useBeginner();
  const workflows = useWorkflows();
  const stageLibrary = useStageLibrary();
  const workflowId = searchParams.get("workflow");
  const list = workflows.data ?? [];
  const fallback = list[0];
  const selectedId = workflowId ?? fallback?.id ?? null;
  const active = list.find((entry) => entry.id === selectedId);
  const workflowQuery = useWorkflow(selectedId);
  const workflow = workflowQuery.data;

  const validateMutation = useValidateWorkflow();
  const saveMutation = useSaveWorkflow();
  const publishMutation = usePublishWorkflow();

  const [nodes, setNodes] = useState<StageNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [baseline, setBaseline] = useState("");
  const [draftSaved, setDraftSaved] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialized = useRef<string | null>(null);
  const flowRef = useRef<ReactFlowInstance<StageNode, Edge> | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const permissions = me.data?.user.permissions ?? [];
  const canWrite = can(permissions, "pipelines:write");
  const latestVersion = workflow?.versions[0] ?? null;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const first = list[0];
    if (!workflowId || !first) return;
    if (!list.some((entry) => entry.id === workflowId)) {
      router.replace(`/studio?workflow=${encodeURIComponent(first.id)}`);
    }
  }, [workflowId, list, router]);

  const fromDefinition = useCallback((definition: WorkflowDefinition) => {
    const nextNodes: StageNode[] = definition.nodes.map((node: WorkflowNode) => ({
      id: node.id,
      type: "stage",
      position: node.position,
      data: { stageKey: node.stage_key, label: node.label, description: node.description ?? "" },
    }));
    const nextEdges: Edge[] = definition.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: "smoothstep",
      label: edge.condition ?? undefined,
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "rgba(140,160,184,0.85)" },
    }));
    return { nextNodes, nextEdges };
  }, []);

  useEffect(() => {
    if (!workflow || !latestVersion) return;
    if (initialized.current === latestVersion.id) return;
    initialized.current = latestVersion.id;
    const { nextNodes, nextEdges } = fromDefinition(latestVersion.definition);
    const horizontalSpan =
      nextNodes.length > 1
        ? Math.max(...nextNodes.map((node) => node.position.x)) -
          Math.min(...nextNodes.map((node) => node.position.x))
        : 0;
    // Wide single-row layouts (the seeded default) are displayed compactly so stages stay legible.
    const laidOut = horizontalSpan > 1000 ? arrange(nextNodes, nextEdges, responsiveColumns()) : nextNodes;
    setNodes(laidOut);
    setEdges(nextEdges);
    setSelectedNodeId(laidOut[0]?.id ?? null);
    setValidation(null);
    setDraftSaved(false);
    setError(null);
    setBaseline(serializeDefinition(laidOut, nextEdges, latestVersion.definition.version));
  }, [workflow, latestVersion, fromDefinition]);

  const buildDefinition = useCallback((): WorkflowDefinition => {
    return {
      nodes: nodes.map((node) => ({
        id: node.id,
        type: "stage",
        stage_key: node.data.stageKey,
        label: node.data.label,
        description: node.data.description,
        position: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
        config: {},
      })),
      edges: edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        condition: typeof edge.label === "string" ? edge.label : null,
      })),
      version: latestVersion?.definition.version ?? 1,
    };
  }, [nodes, edges, latestVersion]);

  const serialized = useMemo(
    () => serializeDefinition(nodes, edges, latestVersion?.definition.version ?? 1),
    [nodes, edges, latestVersion],
  );
  const dirty = Boolean(workflow) && serialized !== baseline;

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null;
  const usedStages = new Set(nodes.map((node) => node.data.stageKey));
  const availableStages = (stageLibrary.data ?? []).filter((stage) => !usedStages.has(stage.key));
  const automationSlug = active?.automation_slug ?? "";

  const onNodesChange = useCallback((changes: NodeChange<StageNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
    if (changes.some((change) => change.type !== "select")) setValidation(null);
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((current) => applyEdgeChanges(changes, current));
    if (changes.some((change) => change.type !== "select")) setValidation(null);
  }, []);

  const onConnect = useCallback((connection: Connection) => {
    setEdges((current) => {
      if (!connection.source || !connection.target) return current;
      if (connection.source === connection.target) return current;
      if (current.some((edge) => edge.source === connection.source && edge.target === connection.target)) {
        return current;
      }
      return addEdge(
        {
          ...connection,
          id: `edge-${newId()}`,
          type: "smoothstep",
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "rgba(140,160,184,0.85)" },
        },
        current,
      );
    });
    setValidation(null);
  }, []);

  function updateNode(id: string, patch: Partial<StageNodeData>) {
    setNodes((current) =>
      current.map((node) => (node.id === id ? { ...node, data: { ...node.data, ...patch } } : node)),
    );
    setValidation(null);
  }

  function removeNode(id: string) {
    setNodes((current) => current.filter((node) => node.id !== id));
    setEdges((current) => current.filter((edge) => edge.source !== id && edge.target !== id));
    setSelectedNodeId((current) => (current === id ? null : current));
    setValidation(null);
  }

  function insertStage(stageKey: string) {
    const stage = (stageLibrary.data ?? []).find((entry) => entry.key === stageKey);
    if (!stage) return;
    const anchor = nodes.find((node) => node.id === selectedNodeId);
    const nodeId = `node-${stageKey}-${newId().slice(0, 6)}`;
    const position = anchor
      ? { x: anchor.position.x + COLUMN_STEP, y: anchor.position.y + 28 }
      : { x: LAYOUT_ORIGIN + nodes.length * COLUMN_STEP, y: 180 };
    const newNode: StageNode = {
      id: nodeId,
      type: "stage",
      position,
      data: { stageKey, label: stage.name, description: stage.description },
    };
    setNodes((current) => [...current, newNode]);

    if (anchor) {
      const outgoing = edges.filter((edge) => edge.source === anchor.id);
      const remaining = edges.filter((edge) => edge.source !== anchor.id);
      const rewired: Edge[] = [
        ...remaining,
        {
          id: `edge-${anchor.id}-${nodeId}`,
          source: anchor.id,
          target: nodeId,
          type: "smoothstep",
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "rgba(140,160,184,0.85)" },
        },
        ...outgoing.map((edge) => ({
          ...edge,
          id: `edge-${nodeId}-${edge.target}`,
          source: nodeId,
        })),
      ];
      setEdges(rewired);
    }
    setSelectedNodeId(nodeId);
    setValidation(null);
  }

  function resetCanvas() {
    if (!latestVersion) return;
    const { nextNodes, nextEdges } = fromDefinition(latestVersion.definition);
    setNodes(nextNodes);
    setEdges(nextEdges);
    setSelectedNodeId(nextNodes[0]?.id ?? null);
    setBaseline(serializeDefinition(nextNodes, nextEdges, latestVersion.definition.version));
    setValidation(null);
    setDraftSaved(false);
    setError(null);
    toast("Canvas restored", "info", "Back to the last published definition.");
  }

  function fitCanvas() {
    flowRef.current?.fitView({ padding: 0.18, maxZoom: 0.9, duration: 280 });
  }

  function autoArrange() {
    if (!nodes.length) return;
    const width = canvasRef.current?.clientWidth ?? 0;
    const measuredColumns = width ? Math.floor((width - 20) / COLUMN_STEP) : responsiveColumns();
    const columns = Math.max(2, Math.min(nodes.length, measuredColumns));
    setNodes(arrange(nodes, edges, columns));
    setValidation(null);
    requestAnimationFrame(() => flowRef.current?.fitView({ padding: 0.18, maxZoom: 0.9, duration: 280 }));
  }

  async function validate() {
    if (!workflow) return;
    setError(null);
    try {
      const result = await validateMutation.mutateAsync({ id: workflow.id, definition: buildDefinition() });
      setValidation(result);
      if (result.valid) {
        toast("Workflow is valid", "success", "The structure can be saved as a draft.");
      } else {
        toast("Validation found problems", "error", "Fix the errors before saving or publishing.");
      }
    } catch (caught) {
      const message = (caught as ApiError).message ?? "Validation could not run.";
      setError(message);
      toast("Validation could not run", "error", message);
    }
  }

  async function saveDraft() {
    if (!workflow) return;
    setError(null);
    try {
      await saveMutation.mutateAsync({ id: workflow.id, name: workflow.name, definition: buildDefinition() });
      setBaseline(serialized);
      setDraftSaved(true);
      toast("Draft saved", "success", "It is not live yet. Publish when you are ready for new runs to use it.");
    } catch (caught) {
      const message = (caught as ApiError).message ?? "The draft could not be saved.";
      setError(issueMessage(caught as ApiError));
      toast("Draft not saved", "error", message);
    }
  }

  async function publish() {
    if (!workflow) return;
    setError(null);
    try {
      await publishMutation.mutateAsync(workflow.id);
      setPublishOpen(false);
      setDraftSaved(false);
      toast(
        "Workflow published",
        "success",
        "New runs will follow this exact definition. Existing approvals remain bound to their candidates.",
      );
    } catch (caught) {
      const message = (caught as ApiError).message ?? "The workflow could not be published.";
      setError(issueMessage(caught as ApiError));
      toast("Publish failed", "error", message);
      setPublishOpen(false);
    }
  }

  const issues = validation?.issues ?? [];
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.length - errors;
  const stageKeyById = useMemo(() => {
    const map = new Map<string, string>();
    nodes.forEach((node) => map.set(node.id, node.data.stageKey));
    return map;
  }, [nodes]);

  const flowEdges = useMemo(
    () =>
      edges.map((edge) => {
        const sourceStage = stageKeyById.get(edge.source);
        const color =
          sourceStage === "approval_gate"
            ? "rgba(255,184,107,0.72)"
            : sourceStage === "production_deploy"
              ? "rgba(214,255,118,0.68)"
              : "rgba(122,143,168,0.5)";
        return {
          ...edge,
          style: { stroke: color, strokeWidth: 1.6 },
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color },
          labelStyle: { fill: "#AAB4C0", fontSize: 9 },
          labelBgStyle: { fill: "#10151D", fillOpacity: 0.9 },
          labelBgPadding: [4, 2] as [number, number],
          labelBgBorderRadius: 4,
        };
      }),
    [edges, stageKeyById],
  );

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 pb-16 pt-7 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Build"
        title="Pipeline Studio"
        description="Shape the stages every run must pass: source, validation, security, UAT, the approval gate, production and verification. JUNE validates the graph before a draft can be saved or published."
        meta={
          <>
            {workflow ? <Badge tone="cyan">{workflow.name}</Badge> : null}
            {latestVersion ? (
              <Badge tone="slate">
                v{latestVersion.version} · {latestVersion.status.toLowerCase()}
              </Badge>
            ) : null}
            {dirty ? <Badge tone="amber" dot>Unsaved changes</Badge> : null}
            {draftSaved && !dirty ? <Badge tone="violet" dot>Draft stored</Badge> : null}
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {automationSlug ? (
              <Link href={`/automations/${automationSlug}`}>
                <Button variant="ghost" size="sm" icon={<ArrowUpRight className="h-3.5 w-3.5" />}>
                  Open guide
                </Button>
              </Link>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              icon={<CheckCircle2 className="h-3.5 w-3.5" />}
              onClick={() => void validate()}
              loading={validateMutation.isPending}
              disabled={!workflow}
            >
              Validate
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<Save className="h-3.5 w-3.5" />}
              onClick={() => void saveDraft()}
              loading={saveMutation.isPending}
              disabled={!workflow || !canWrite || !dirty}
              title={!canWrite ? "Your role cannot save workflow drafts." : undefined}
            >
              Save draft
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<Rocket className="h-3.5 w-3.5" />}
              onClick={() => setPublishOpen(true)}
              disabled={!workflow || !canWrite || dirty}
              title={dirty ? "Save your draft before publishing." : !canWrite ? "Your role cannot publish workflows." : undefined}
            >
              Publish
            </Button>
          </div>
        }
      />

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <div className="min-w-[260px] max-w-[420px] flex-1">
          <Select
            value={selectedId ?? ""}
            onChange={(event) => router.replace(`/studio?workflow=${event.target.value}`)}
            aria-label="Select a workflow"
          >
            {list.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.automation_name} — {entry.name}
              </option>
            ))}
          </Select>
        </div>
        <p className="text-[11px] text-ink-faint">
          {nodes.length} stages · {edges.length} connections
          {latestVersion ? ` · checksum ${shortenHash(latestVersion.checksum, 8)}` : ""}
        </p>
      </div>

      {workflowQuery.isLoading ? (
        <Skeleton className="mt-5 h-[420px] w-full sm:h-[500px] xl:h-[560px]" />
      ) : !workflow ? (
        <Panel className="mt-5">
          <EmptyState
            icon={<GitBranch className="h-5 w-5" />}
            title="No workflow selected"
            description="Choose an automation workflow to edit, or open an automation guide and follow its pipeline link."
          />
        </Panel>
      ) : (
        <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_370px]">
          <Panel className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <GitBranch className="h-3.5 w-3.5 text-lime" />
                <p className="text-[12px] font-medium text-ink">Pipeline canvas</p>
                <span className="hidden text-[10px] text-ink-faint sm:inline">
                  {canWrite ? "drag to arrange · connect handles · select to edit" : "select a stage to inspect"}
                </span>
                {!canWrite ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.1em] text-ink-faint">
                    <Lock className="h-2.5 w-2.5" /> read-only
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" icon={<Maximize2 className="h-3.5 w-3.5" />} onClick={fitCanvas}>
                  Fit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Wand2 className="h-3.5 w-3.5" />}
                  onClick={autoArrange}
                  disabled={!canWrite || nodes.length < 2}
                  title={!canWrite ? "Your role cannot edit workflows." : "Tidy stages into compact rows"}
                >
                  Arrange
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<RotateCcw className="h-3.5 w-3.5" />}
                  onClick={resetCanvas}
                  disabled={!dirty && !draftSaved}
                >
                  Reset
                </Button>
              </div>
            </div>
            <div ref={canvasRef} className="relative h-[420px] bg-obsidian-950/60 sm:h-[500px] xl:h-[560px]">
              {mounted ? (
                <ReactFlow<StageNode, Edge>
                  nodes={nodes}
                  edges={flowEdges}
                  nodeTypes={nodeTypes}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onConnect={onConnect}
                  onInit={(instance) => {
                    flowRef.current = instance;
                  }}
                  onNodeClick={(_, node) => setSelectedNodeId(node.id)}
                  onPaneClick={() => setSelectedNodeId(null)}
                  fitView
                  fitViewOptions={{ padding: 0.18, maxZoom: 0.9 }}
                  minZoom={0.2}
                  maxZoom={1.6}
                  nodesDraggable={canWrite}
                  nodesConnectable={canWrite}
                  deleteKeyCode={canWrite ? ["Backspace", "Delete"] : null}
                  defaultEdgeOptions={{ type: "smoothstep" }}
                >
                  <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="rgba(255,255,255,0.08)" />
                  <Controls showInteractive={false} position="bottom-left" />
                  <MiniMap
                    pannable
                    zoomable
                    position="bottom-right"
                    className="!hidden md:!block"
                    maskColor="rgba(8,11,16,0.8)"
                    style={{
                      width: 150,
                      height: 106,
                      background: "#10151D",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: 10,
                    }}
                    nodeColor={(node) => {
                      const key = (node.data as StageNodeData).stageKey;
                      if (key === "approval_gate") return "#FFB86B";
                      if (key === "production_deploy") return "#D6FF76";
                      return "#3C4B5C";
                    }}
                  />
                </ReactFlow>
              ) : (
                <Skeleton className="absolute inset-4" />
              )}
            </div>
          </Panel>

          <div className="space-y-4">
            <Panel className="overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-3.5 w-3.5 text-cyan" />
                  <p className="text-[12px] font-medium text-ink">Validation</p>
                </div>
                {validation ? (
                  <Badge tone={validation.valid ? "lime" : "red"} dot>
                    {validation.valid ? "Valid" : `${errors} error${errors === 1 ? "" : "s"}`}
                  </Badge>
                ) : (
                  <Badge tone="slate">Not run</Badge>
                )}
              </div>
              <div className="px-4 py-3.5">
                <AnimatePresence mode="wait">
                  {validation ? (
                    <motion.div
                      key="result"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="space-y-2.5"
                    >
                      {issues.length === 0 ? (
                        <p className="flex items-start gap-2 text-[11.5px] leading-relaxed text-ink-muted">
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lime" />
                          Structure, entry point, required stages and gate ordering all pass.
                        </p>
                      ) : (
                        <>
                          {errors ? (
                            <p className="text-[10.5px] text-ink-faint">
                              {errors} blocking · {warnings} warning{warnings === 1 ? "" : "s"}
                            </p>
                          ) : (
                            <p className="text-[10.5px] text-ink-faint">
                              {warnings} warning{warnings === 1 ? "" : "s"} · no blocking errors
                            </p>
                          )}
                          <ul className="space-y-2">
                            {issues.map((issue, index) => (
                              <li key={`${issue.node_id ?? "graph"}-${index}`} className="flex items-start gap-2">
                                {issue.severity === "error" ? (
                                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-signal-red" />
                                ) : (
                                  <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-signal-amber" />
                                )}
                                <div>
                                  <p className="text-[11.5px] leading-relaxed text-ink-muted">{issue.message}</p>
                                  {issue.node_id ? (
                                    <button
                                      onClick={() => setSelectedNodeId(issue.node_id ?? null)}
                                      className="mono mt-0.5 text-[9.5px] text-ink-faint transition hover:text-lime"
                                    >
                                      {issue.node_id}
                                    </button>
                                  ) : null}
                                </div>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                      <div className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-obsidian-900/50 px-2.5 py-2">
                        <span className="text-[9.5px] uppercase tracking-[0.12em] text-ink-faint">Checksum</span>
                        <span className="mono inline-flex items-center gap-1 text-[10.5px] text-ink-muted">
                          {shortenHash(validation.checksum, 10)}
                          <CopyButton value={validation.checksum} />
                        </span>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <p className="text-[11.5px] leading-relaxed text-ink-muted">
                        Validate to check the graph before saving. Publishing is blocked until the exact definition
                        passes.
                      </p>
                      <ul className="mt-2.5 space-y-1.5 text-[10.5px] text-ink-faint">
                        <li>· Exactly one entry stage</li>
                        <li>· No cycles or unreachable stages</li>
                        <li>· Required stages present</li>
                        <li>· Approval gate before production deployment</li>
                      </ul>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="mt-3 w-full"
                        icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                        onClick={() => void validate()}
                        loading={validateMutation.isPending}
                      >
                        Validate workflow
                      </Button>
                    </motion.div>
                  )}
                </AnimatePresence>
                {error ? (
                  <p className="mt-3 rounded-lg border border-signal-red/25 bg-signal-red/[0.08] px-2.5 py-2 text-[11px] leading-relaxed text-signal-red">
                    {error}
                  </p>
                ) : null}
              </div>
            </Panel>

            <Panel className="overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-ink-faint" />
                  <p className="text-[12px] font-medium text-ink">Selected stage</p>
                </div>
                {selectedNode ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Trash2 className="h-3.5 w-3.5" />}
                    onClick={() => removeNode(selectedNode.id)}
                    disabled={!canWrite}
                    title={!canWrite ? "Your role cannot edit workflows." : undefined}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
              {selectedNode ? (
                <div className="space-y-3 px-4 py-3.5">
                  <Field label="Stage label">
                    <Input
                      value={selectedNode.data.label}
                      onChange={(event) => updateNode(selectedNode.id, { label: event.target.value })}
                      disabled={!canWrite}
                      maxLength={120}
                    />
                  </Field>
                  <Field label="Description" hint="Shown in the automation guide and run detail.">
                    <Textarea
                      value={selectedNode.data.description}
                      onChange={(event) => updateNode(selectedNode.id, { description: event.target.value })}
                      rows={2}
                      className="resize-none"
                      disabled={!canWrite}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-2 rounded-lg border border-white/[0.06] bg-obsidian-900/50 px-2.5 py-2">
                    <div>
                      <p className="text-[9px] uppercase tracking-[0.12em] text-ink-faint">Stage type</p>
                      <p className="mono mt-0.5 truncate text-[10.5px] text-ink-muted">{selectedNode.data.stageKey}</p>
                    </div>
                    <div>
                      <p className="text-[9px] uppercase tracking-[0.12em] text-ink-faint">Position</p>
                      <p className="mono mt-0.5 text-[10.5px] text-ink-muted">
                        {Math.round(selectedNode.position.x)}, {Math.round(selectedNode.position.y)}
                      </p>
                    </div>
                  </div>
                  <p className="text-[10px] leading-relaxed text-ink-faint">
                    Stage semantics are enforced by JUNE. You can rename and reposition, but you cannot change what a
                    stage does.
                  </p>
                </div>
              ) : (
                <p className="px-4 py-5 text-[11.5px] text-ink-faint">
                  Select a stage on the canvas to rename it or remove it.
                </p>
              )}
            </Panel>

            <Panel className="overflow-hidden">
              <div className="border-b border-white/[0.06] px-4 py-3">
                <p className="text-[12px] font-medium text-ink">Insert a stage</p>
                <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-faint">
                  Inserts after the selected stage. Connect handles afterwards if you need a different shape.
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5 px-4 py-3.5">
                {availableStages.length ? (
                  availableStages.map((stage) => {
                    const Icon = stageIcon(stage.key);
                    return (
                      <button
                        key={stage.key}
                        onClick={() => insertStage(stage.key)}
                        disabled={!canWrite}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5 text-[10.5px] font-medium text-ink-muted transition hover:border-lime/35 hover:bg-lime/[0.06] hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                        title={stage.description}
                      >
                        <Icon className="h-3 w-3" />
                        {stage.name}
                        <Plus className="h-3 w-3 opacity-50" />
                      </button>
                    );
                  })
                ) : (
                  <p className="text-[11px] text-ink-faint">Every stage type is already in this pipeline.</p>
                )}
              </div>
              {beginner ? (
                <p className="border-t border-white/[0.06] px-4 py-2.5 text-[10px] leading-relaxed text-ink-faint">
                  JUNE only accepts known stage types. This is why you cannot drop an arbitrary script into the path —
                  unsafe steps are rejected by design.
                </p>
              ) : null}
            </Panel>

            <Panel className="overflow-hidden">
              <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
                <Info className="h-3.5 w-3.5 text-ink-faint" />
                <p className="text-[12px] font-medium text-ink">Version facts</p>
              </div>
              <dl className="divide-y divide-white/[0.05] text-[11px]">
                <div className="flex items-center justify-between gap-2 px-4 py-2">
                  <dt className="text-ink-faint">Latest version</dt>
                  <dd className="text-ink-muted">{latestVersion ? `v${latestVersion.version}` : "—"}</dd>
                </div>
                <div className="flex items-center justify-between gap-2 px-4 py-2">
                  <dt className="text-ink-faint">Status</dt>
                  <dd className="text-ink-muted">{latestVersion ? humanize(latestVersion.status) : "—"}</dd>
                </div>
                <div className="flex items-center justify-between gap-2 px-4 py-2">
                  <dt className="text-ink-faint">Published</dt>
                  <dd className="text-ink-muted">{formatDate(latestVersion?.published_at ?? null)}</dd>
                </div>
                <div className="flex items-center justify-between gap-2 px-4 py-2">
                  <dt className="text-ink-faint">Checksum</dt>
                  <dd className="mono text-[10.5px] text-ink-muted">{shortenHash(latestVersion?.checksum, 10)}</dd>
                </div>
              </dl>
              <p className="border-t border-white/[0.06] px-4 py-2.5 text-[10px] leading-relaxed text-ink-faint">
                Publishing creates an immutable version. Existing production approvals stay bound to the candidate
                they were requested against.
              </p>
            </Panel>
          </div>
        </div>
      )}

      <Modal
        open={publishOpen}
        onClose={() => {
          if (!publishMutation.isPending) setPublishOpen(false);
        }}
        title="Publish this workflow?"
        description="New executions will follow this exact definition. This action is recorded in the Chronicle."
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPublishOpen(false)} disabled={publishMutation.isPending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon={<Rocket className="h-4 w-4" />}
              loading={publishMutation.isPending}
              onClick={() => void publish()}
            >
              Publish workflow
            </Button>
          </>
        }
      >
        <div className="rounded-xl border border-white/[0.08] bg-obsidian-900/60 px-4 py-3.5">
          <p className="text-[13px] font-medium text-ink">{workflow?.name}</p>
          <p className="mt-1 text-[11px] text-ink-faint">{active?.automation_name}</p>
          <div className="mt-3 space-y-1.5 text-[11.5px]">
            <div className="flex items-center justify-between gap-3">
              <span className="text-ink-faint">Stages</span>
              <span className="text-ink-muted">{nodes.length}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-ink-faint">Connections</span>
              <span className="text-ink-muted">{edges.length}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-ink-faint">Definition hash</span>
              <span className="mono text-[10.5px] text-ink-muted">{shortenHash(validation?.checksum, 12)}</span>
            </div>
          </div>
        </div>
        <p className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-ink-faint">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan" />
          {draftSaved
            ? "Your saved draft will become the published path for new runs."
            : "Any existing saved draft will become the published path. If none exists the server will refuse, so save a draft first."}
        </p>
      </Modal>
    </div>
  );
}

function serializeDefinition(nodes: StageNode[], edges: Edge[], version: number): string {
  return JSON.stringify({
    version,
    nodes: nodes.map((node) => ({
      id: node.id,
      stage_key: node.data.stageKey,
      label: node.data.label,
      description: node.data.description,
      position: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      condition: typeof edge.label === "string" ? edge.label : null,
    })),
  });
}

function issueMessage(error: ApiError): string {
  const details = error.details;
  if (Array.isArray(details) && details.length) {
    return details
      .map((issue) =>
        typeof issue === "object" && issue && "message" in issue ? String((issue as { message: unknown }).message) : String(issue),
      )
      .join(" ");
  }
  return error.message;
}
