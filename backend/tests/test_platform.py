"""End-to-end backend behaviour: auth, RBAC, CSRF, governed execution and approvals."""

from __future__ import annotations

import asyncio

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from tests.conftest import csrf, login, post


async def _catalog(client: AsyncClient) -> tuple[dict, dict, dict]:
    automations = (await client.get("/api/v1/automations")).json()["items"]
    environments = (await client.get("/api/v1/environments")).json()
    by_slug = {item["slug"]: item for item in automations}
    env_by_key = {item["key"]: item for item in environments}
    return by_slug, env_by_key, {"automations": automations}


async def _submit(client: AsyncClient, automation: dict, environment: dict, reason: str, key: str | None = None):
    payload = {
        "automation_id": automation["id"],
        "environment_id": environment["id"],
        "params": {},
        "reason": reason,
    }
    if key:
        payload["idempotency_key"] = key
    return await post(client, "/api/v1/executions", payload)


async def _wait_for_status(client: AsyncClient, execution_id: str, wanted: set[str], timeout: float = 25.0) -> dict:
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


async def test_login_and_session_identity(client: AsyncClient):
    data = await login(client, "ava.chen@june.dev")
    assert data["user"]["email"] == "ava.chen@june.dev"
    assert data["user"]["role"]["key"] == "SUPER_ADMIN"
    assert data["csrf_token"] == csrf(client)

    me = await client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["user"]["full_name"] == "Ava Chen"


async def test_bad_password_is_rejected(client: AsyncClient):
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": "ava.chen@june.dev", "password": "wrong-password"},
    )
    assert response.status_code == 401, response.text
    assert response.json()["error"]["code"] == "invalid_credentials"


async def test_csrf_required_for_cookie_sessions(client: AsyncClient):
    await login(client, "daniel.okafor@june.dev")
    payload = {"automation_id": "missing", "environment_id": "missing", "params": {}, "reason": "csrf check"}
    response = await client.post("/api/v1/executions/preflight", json=payload)
    assert response.status_code == 403
    assert "csrf" in response.json()["error"]["code"].lower()


async def test_viewer_cannot_use_admin_surface(client: AsyncClient):
    await login(client, "jordan.lee@june.dev")
    response = await client.get("/api/v1/admin/users")
    assert response.status_code == 403


async def test_uat_execution_runs_with_real_evidence(client: AsyncClient):
    await login(client, "daniel.okafor@june.dev")
    automations, environments, _ = await _catalog(client)
    automation = automations["database-integrity-check"]
    uat = environments["uat"]

    preflight = await post(
        client,
        "/api/v1/executions/preflight",
        {"automation_id": automation["id"], "environment_id": uat["id"], "params": {}},
    )
    assert preflight.status_code == 200, preflight.text
    assert preflight.json()["can_submit"] is True

    response = await _submit(client, automation, uat, "Scheduled UAT database integrity rehearsal")
    assert response.status_code == 201, response.text
    execution = response.json()
    assert execution["status"] in {"QUEUED", "RUNNING"}

    finished = await _wait_for_status(client, execution["id"], {"SUCCEEDED"})
    assert finished["result_summary"]
    assert all(stage["status"] == "SUCCEEDED" for stage in finished["stages"])
    assert finished["candidate_hash"]

    logs = (await client.get(f"/api/v1/executions/{execution['id']}/logs")).json()
    assert logs and any("quick_check" in entry["message"].lower() or "Table" in entry["message"] for entry in logs)


async def test_idempotent_submission_returns_same_execution(client: AsyncClient):
    await login(client, "priya.nair@june.dev")
    automations, environments, _ = await _catalog(client)
    automation = automations["release-evidence-bundle"]
    uat = environments["uat"]
    key = "idem-test-release-evidence-001"

    first = await _submit(client, automation, uat, "Release evidence packaging for the sprint", key)
    second = await _submit(client, automation, uat, "Release evidence packaging for the sprint", key)
    assert first.status_code == 201
    assert second.status_code == 200
    assert first.json()["id"] == second.json()["id"]


async def test_production_requires_separation_of_duties_and_simulation(client: AsyncClient):
    await login(client, "ava.chen@june.dev")
    automations, environments, _ = await _catalog(client)
    automation = automations["configuration-rollout"]
    production = environments["production"]

    response = await _submit(client, automation, production, "Apply governed rollout config to production")
    assert response.status_code == 201, response.text
    execution = response.json()
    assert execution["execution_mode"] == "SIMULATION"

    waiting = await _wait_for_status(client, execution["id"], {"WAITING_FOR_APPROVAL"})
    approval = waiting["approval"]
    assert approval and approval["status"] == "PENDING"

    own_decision = await post(
        client,
        f"/api/v1/approvals/{approval['id']}/approve",
        {"comment": "Self approval should be impossible", "reason": "trying to bypass"},
    )
    assert own_decision.status_code == 403
    assert "separation" in own_decision.json()["error"]["message"].lower()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as approver:
        await login(approver, "elena.petrova@june.dev")
        decision = await post(
            approver,
            f"/api/v1/approvals/{approval['id']}/approve",
            {"comment": "Evidence reviewed; simulation adapter confirmed.", "reason": "Rehearsal approved"},
        )
        assert decision.status_code == 200, decision.text
        assert decision.json()["status"] == "APPROVED"

    finished = await _wait_for_status(client, execution["id"], {"SUCCEEDED"})
    assert finished["result_summary"]["simulated"] is True
    deploy = next(stage for stage in finished["stages"] if stage["key"] == "production_deploy")
    assert deploy["status"] == "SUCCEEDED"
    assert deploy["output"]["simulated"] is True


async def test_approval_evidence_and_lists_are_readable(client: AsyncClient):
    await login(client, "elena.petrova@june.dev")
    response = await client.get("/api/v1/approvals?status=ALL&page_size=50")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["total"] >= 1
    sample = payload["items"][0]
    assert sample["execution"]["display_id"].startswith("EXE-")
    assert sample["evidence"]["candidate"]["hash"] == sample["candidate_hash"]


async def test_security_scans_have_findings_loaded(client: AsyncClient):
    await login(client, "sofia.almeida@june.dev")
    response = await client.get("/api/v1/security/scans?page_size=10")
    assert response.status_code == 200, response.text
    scans = response.json()["items"]
    assert scans
    assert all(isinstance(scan["findings"], list) for scan in scans)
    assert all(scan["scanner"] for scan in scans)


async def test_audit_chain_is_intact(client: AsyncClient):
    await login(client, "ava.chen@june.dev")
    response = await client.get("/api/v1/audit-events/integrity")
    assert response.status_code == 200
    report = response.json()
    assert report["valid"] is True
    assert report["checked_events"] >= 5
