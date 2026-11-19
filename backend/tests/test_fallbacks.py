"""Regression coverage for fail-closed and recovery behaviour."""

from __future__ import annotations

import asyncio
from datetime import timedelta

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.database import SessionLocal, utcnow
from app.engine.executor import engine
from app.main import app
from app.models import Approval, Execution
from app.services import approval_service, workflow_service
from tests.conftest import login, post


async def _catalog(client: AsyncClient) -> tuple[dict, dict]:
    automations = (await client.get("/api/v1/automations")).json()["items"]
    environments = (await client.get("/api/v1/environments")).json()
    return {item["slug"]: item for item in automations}, {item["key"]: item for item in environments}


async def _submit(client: AsyncClient, automation: dict, environment: dict, key: str | None = None):
    payload = {
        "automation_id": automation["id"],
        "environment_id": environment["id"],
        "params": {},
        "reason": "Fallback regression coverage",
    }
    if key:
        payload["idempotency_key"] = key
    return await post(client, "/api/v1/executions", payload)


async def _wait_for_status(client: AsyncClient, execution_id: str, wanted: set[str], timeout: float = 30.0) -> dict:
    deadline = asyncio.get_event_loop().time() + timeout
    latest: dict = {}
    while asyncio.get_event_loop().time() < deadline:
        response = await client.get(f"/api/v1/executions/{execution_id}")
        assert response.status_code == 200, response.text
        latest = response.json()
        if latest["status"] in wanted:
            return latest
        await asyncio.sleep(0.25)
    pytest.fail(f"Execution never reached {wanted}; last status was {latest.get('status')}")


async def _production_waiting_approval(client: AsyncClient, reason: str) -> dict:
    await login(client, "ava.chen@june.dev")
    automations, environments = await _catalog(client)
    response = await post(
        client,
        "/api/v1/executions",
        {
            "automation_id": automations["configuration-rollout"]["id"],
            "environment_id": environments["production"]["id"],
            "params": {},
            "reason": reason,
        },
    )
    assert response.status_code == 201, response.text
    return await _wait_for_status(client, response.json()["id"], {"WAITING_FOR_APPROVAL"})


async def test_idempotency_key_cannot_be_reused_for_a_different_request(client: AsyncClient):
    await login(client, "priya.nair@june.dev")
    automations, environments = await _catalog(client)
    uat = environments["uat"]
    key = "idem-mismatch-regression-001"

    first = await _submit(client, automations["release-evidence-bundle"], uat, key)
    assert first.status_code == 201, first.text

    second = await _submit(client, automations["database-integrity-check"], uat, key)
    assert second.status_code == 409, second.text
    assert "different" in second.json()["error"]["message"].lower()


async def test_deciding_an_expired_approval_releases_the_waiting_execution(client: AsyncClient):
    waiting = await _production_waiting_approval(client, "Expiry via decision path")
    approval_id = waiting["approval"]["id"]

    async with SessionLocal() as db:
        approval = await db.get(Approval, approval_id)
        approval.expires_at = utcnow() - timedelta(minutes=1)
        await db.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as approver:
        await login(approver, "elena.petrova@june.dev")
        decision = await post(
            approver,
            f"/api/v1/approvals/{approval_id}/approve",
            {"comment": "Too late", "reason": "Window already elapsed"},
        )
        assert decision.status_code == 409, decision.text

    detail = (await client.get(f"/api/v1/executions/{waiting['id']}")).json()
    assert detail["status"] == "FAILED"
    assert detail["error_code"] == "APPROVAL_EXPIRED"
    assert any(stage["status"] == "FAILED" for stage in detail["stages"] if stage["key"] == "approval_gate")

    async with SessionLocal() as db:
        approval = await db.get(Approval, approval_id)
        assert approval.status == "EXPIRED"


async def test_expiry_sweep_self_heals_an_already_expired_approval(client: AsyncClient):
    waiting = await _production_waiting_approval(client, "Expiry via maintenance sweep")
    approval_id = waiting["approval"]["id"]

    async with SessionLocal() as db:
        approval = await db.get(Approval, approval_id)
        approval.status = "EXPIRED"
        approval.decision_reason = "Simulated out-of-band expiry"
        await db.commit()

    async with SessionLocal() as db:
        await approval_service.expire_approvals(db)

    detail = (await client.get(f"/api/v1/executions/{waiting['id']}")).json()
    assert detail["status"] == "FAILED"
    assert detail["error_code"] == "APPROVAL_EXPIRED"


async def test_engine_crash_guard_marks_the_execution_failed(client: AsyncClient):
    waiting = await _production_waiting_approval(client, "Crash guard coverage")
    approval_id = waiting["approval"]["id"]

    await engine._fail_safely(
        waiting["id"],
        "ENGINE_CRASH",
        "The JUNE execution engine hit an unexpected error and stopped this execution.",
    )

    detail = (await client.get(f"/api/v1/executions/{waiting['id']}")).json()
    assert detail["status"] == "FAILED"
    assert detail["error_code"] == "ENGINE_CRASH"
    assert detail["result_summary"]["blocked_reason"] == "ENGINE_CRASH"

    async with SessionLocal() as db:
        approval = await db.get(Approval, approval_id)
        assert approval.status == "INVALIDATED"
        execution = await db.get(Execution, waiting["id"])
        assert execution is not None and execution.status == "FAILED"


def test_malformed_workflow_definitions_are_reported_not_raised():
    issues = workflow_service.validate_definition(
        {"nodes": [{}, {"id": "node-a", "stage_key": "unknown_stage"}], "edges": [{}, {"source": "node-a"}]}
    )
    assert issues
    assert all(issue["severity"] == "error" for issue in issues if "malformed" in issue["message"].lower())
    assert any("missing target" in issue["message"].lower() for issue in issues)
    # Recovery helpers must not explode on the same malformed shape.
    assert workflow_service.topological_order({"nodes": [{}], "edges": [{}]}) == []
