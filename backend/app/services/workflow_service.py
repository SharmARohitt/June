"""Workflow definition validation, versioning and publishing."""

from __future__ import annotations

import hashlib
import json
from collections import deque

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import STAGE_LIBRARY
from app.core.database import utcnow
from app.core.errors import invalid, not_found
from app.models import Automation, User, Workflow, WorkflowVersion
from app.services import audit_service
from app.services.serializers import workflow_out

REQUIRED_STAGES = {"source_checkout", "input_validation", "security_scan", "verification"}

# Default canvas geometry: compact serpentine rows instead of one very wide row.
LAYOUT_COLUMNS = 4
LAYOUT_COLUMN_STEP = 196
LAYOUT_ROW_STEP = 104
LAYOUT_ORIGIN = 24

# Runners that only observe or package artifacts do not deploy a candidate, so their
# default workflow skips deployment stages. Production requests still pass the gate.
DEPLOYMENT_RUNNERS = {"config_rollout"}


def build_default_definition(include_production: bool = True, runner_key: str | None = None) -> dict:
    if runner_key in DEPLOYMENT_RUNNERS or runner_key is None:
        keys = [
            "source_checkout",
            "input_validation",
            "security_scan",
            "uat_deploy",
            "automated_test",
            "approval_gate",
            "production_deploy",
            "verification",
        ]
    else:
        keys = [
            "source_checkout",
            "input_validation",
            "security_scan",
            "automated_test",
            "approval_gate",
            "verification",
        ]
    if not include_production:
        keys = [key for key in keys if key not in {"approval_gate", "production_deploy"}]
    nodes = []
    for index, key in enumerate(keys):
        meta = STAGE_LIBRARY[key]
        row, column = divmod(index, LAYOUT_COLUMNS)
        nodes.append(
            {
                "id": f"node-{key}",
                "type": "stage",
                "stage_key": key,
                "label": meta["name"],
                "description": meta["description"],
                "position": {"x": LAYOUT_ORIGIN + column * LAYOUT_COLUMN_STEP, "y": LAYOUT_ORIGIN + row * LAYOUT_ROW_STEP},
                "config": {},
            }
        )
    edges = [
        {
            "id": f"edge-{keys[index]}-{keys[index + 1]}",
            "source": f"node-{keys[index]}",
            "target": f"node-{keys[index + 1]}",
            "condition": None,
        }
        for index in range(len(keys) - 1)
    ]
    return {"nodes": nodes, "edges": edges, "version": 1}


def definition_checksum(definition: dict) -> str:
    body = {key: value for key, value in definition.items() if key != "version"}
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def topological_order(definition: dict) -> list[dict]:
    nodes = {
        node["id"]: node
        for node in definition.get("nodes", [])
        if isinstance(node, dict) and isinstance(node.get("id"), str) and node["id"]
    }
    edges = [edge for edge in definition.get("edges", []) if isinstance(edge, dict)]
    incoming = {node_id: 0 for node_id in nodes}
    outgoing: dict[str, list[str]] = {node_id: [] for node_id in nodes}
    for edge in edges:
        if edge.get("source") in nodes and edge.get("target") in nodes:
            incoming[edge["target"]] += 1
            outgoing[edge["source"]].append(edge["target"])
    queue = deque([node_id for node_id, count in incoming.items() if count == 0])
    ordered: list[dict] = []
    while queue:
        node_id = queue.popleft()
        ordered.append(nodes[node_id])
        for target in outgoing[node_id]:
            incoming[target] -= 1
            if incoming[target] == 0:
                queue.append(target)
    return ordered


def validate_definition(definition: dict, *, has_production: bool = True) -> list[dict]:
    issues: list[dict] = []
    nodes = definition.get("nodes", [])
    edges = definition.get("edges", [])
    if not nodes:
        return [{"severity": "error", "node_id": None, "message": "A workflow needs at least one stage."}]

    ids: set[str] = set()
    stage_keys: set[str] = set()
    for index, node in enumerate(nodes):
        if not isinstance(node, dict) or not isinstance(node.get("id"), str) or not node["id"].strip():
            issues.append(
                {
                    "severity": "error",
                    "node_id": None,
                    "message": f"Stage entry {index + 1} is malformed: a stable node identifier is required.",
                }
            )
            continue
        node_id = node["id"]
        if node_id in ids:
            issues.append({"severity": "error", "node_id": node_id, "message": "Duplicate node identifier."})
        ids.add(node_id)
        stage_key = node.get("stage_key")
        if stage_key not in STAGE_LIBRARY:
            issues.append(
                {"severity": "error", "node_id": node_id, "message": f"Unknown stage type '{stage_key}'."}
            )
        elif stage_key in stage_keys:
            issues.append(
                {"severity": "error", "node_id": node_id, "message": f"Stage '{stage_key}' appears more than once."}
            )
        stage_keys.add(stage_key)

    for index, edge in enumerate(edges):
        if not isinstance(edge, dict):
            issues.append(
                {"severity": "error", "node_id": None, "message": f"Connection entry {index + 1} is malformed."}
            )
            continue
        source = edge.get("source")
        target = edge.get("target")
        if source not in ids:
            issues.append({"severity": "error", "node_id": source, "message": "Edge references a missing source node."})
        if target not in ids:
            issues.append({"severity": "error", "node_id": target, "message": "Edge references a missing target node."})

    if not issues:
        indegree = {node_id: 0 for node_id in ids}
        outgoing = {node_id: [] for node_id in ids}
        for edge in edges:
            indegree[edge["target"]] += 1
            outgoing[edge["source"]].append(edge["target"])
        roots = [node_id for node_id, count in indegree.items() if count == 0]
        if len(roots) != 1:
            issues.append({"severity": "error", "node_id": None, "message": "A workflow must have exactly one entry stage."})

        visited: list[str] = []
        queue = deque(roots)
        seen: set[str] = set()
        while queue:
            node_id = queue.popleft()
            if node_id in seen:
                continue
            seen.add(node_id)
            visited.append(node_id)
            queue.extend(outgoing[node_id])
        if len(seen) != len(ids):
            issues.append({"severity": "error", "node_id": None, "message": "Workflow contains unreachable stages or a cycle."})

    missing = REQUIRED_STAGES - stage_keys
    for key in sorted(missing):
        issues.append(
            {
                "severity": "error",
                "node_id": None,
                "message": f"Required stage '{STAGE_LIBRARY[key]['name']}' ({key}) is missing.",
            }
        )

    if "production_deploy" in stage_keys:
        if "approval_gate" not in stage_keys:
            issues.append({"severity": "error", "node_id": None, "message": "Production deployment requires an approval gate."})
        elif not issues:
            order = [node["stage_key"] for node in topological_order(definition)]
            try:
                if order.index("approval_gate") > order.index("production_deploy"):
                    issues.append(
                        {"severity": "error", "node_id": None, "message": "The approval gate must come before production deployment."}
                    )
            except ValueError:
                issues.append({"severity": "error", "node_id": None, "message": "Workflow order cannot be resolved."})

    if "verification" not in stage_keys:
        issues.append({"severity": "warning", "node_id": None, "message": "Consider adding a verification stage after deployment."})
    return issues


async def get_default_workflow(db: AsyncSession, automation_id: str) -> Workflow | None:
    result = await db.execute(
        select(Workflow).where(Workflow.automation_id == automation_id, Workflow.is_default.is_(True))
    )
    return result.scalar_one_or_none()


async def latest_published_version(db: AsyncSession, workflow_id: str) -> WorkflowVersion | None:
    result = await db.execute(
        select(WorkflowVersion)
        .where(WorkflowVersion.workflow_id == workflow_id, WorkflowVersion.status == "PUBLISHED")
        .order_by(WorkflowVersion.version.desc())
    )
    return result.scalars().first()


async def create_default_workflow(
    db: AsyncSession, automation: Automation, actor: User, include_production: bool
) -> tuple[Workflow, WorkflowVersion]:
    definition = build_default_definition(include_production, automation.runner_key)
    workflow = Workflow(
        automation_id=automation.id,
        name="Default workflow",
        description="Standard governed delivery path created with the automation.",
        status="PUBLISHED",
        is_default=True,
    )
    db.add(workflow)
    await db.flush()
    version = WorkflowVersion(
        workflow_id=workflow.id,
        version=1,
        definition=definition,
        checksum=definition_checksum(definition),
        status="PUBLISHED",
        created_by=actor.id,
        published_at=utcnow(),
    )
    db.add(version)
    await db.flush()
    return workflow, version


async def save_draft(
    db: AsyncSession, workflow: Workflow, actor: User, name: str, definition: dict
) -> WorkflowVersion:
    issues = validate_definition(definition, has_production=True)
    errors = [issue for issue in issues if issue["severity"] == "error"]
    if errors:
        raise invalid("The workflow is not valid. Fix the highlighted stages before saving.", errors)
    result = await db.execute(
        select(WorkflowVersion).where(WorkflowVersion.workflow_id == workflow.id).order_by(WorkflowVersion.version.desc())
    )
    latest = result.scalars().first()
    next_version = (latest.version if latest else 0) + 1
    stored_definition = {**definition, "version": next_version}
    version = WorkflowVersion(
        workflow_id=workflow.id,
        version=next_version,
        definition=stored_definition,
        checksum=definition_checksum(stored_definition),
        status="DRAFT",
        created_by=actor.id,
    )
    workflow.name = name
    db.add(version)
    await audit_service.record(
        db,
        actor=actor,
        action="workflow.draft_saved",
        resource_type="workflow",
        resource_id=workflow.id,
        details={"version": next_version, "automation_id": workflow.automation_id},
    )
    await db.commit()
    await db.refresh(version)
    return version


async def publish(db: AsyncSession, workflow: Workflow, actor: User) -> WorkflowVersion:
    result = await db.execute(
        select(WorkflowVersion)
        .where(WorkflowVersion.workflow_id == workflow.id, WorkflowVersion.status == "DRAFT")
        .order_by(WorkflowVersion.version.desc())
    )
    draft = result.scalars().first()
    if not draft:
        raise not_found("Draft workflow version")
    issues = validate_definition(draft.definition, has_production=True)
    errors = [issue for issue in issues if issue["severity"] == "error"]
    if errors:
        raise invalid("The workflow cannot be published until validation passes.", errors)
    now = utcnow()
    for version in workflow.versions:
        if version.status == "PUBLISHED":
            version.status = "SUPERSEDED"
    draft.status = "PUBLISHED"
    draft.published_at = now
    workflow.status = "PUBLISHED"
    workflow.updated_at = now
    await audit_service.record(
        db,
        actor=actor,
        action="workflow.published",
        resource_type="workflow",
        resource_id=workflow.id,
        details={"version": draft.version, "automation_id": workflow.automation_id},
    )
    await db.commit()
    await db.refresh(draft)
    return draft


def workflow_payload(workflow: Workflow) -> dict:
    return workflow_out(workflow)
