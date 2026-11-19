from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permission
from app.core.constants import ROLE_PERMISSIONS
from app.core.database import get_db
from app.core.errors import invalid
from app.models import Team, User
from app.schemas.auth import (
    RoleWithPermissions,
    TeamOut,
    UserAdminOut,
    UserCreateRequest,
    UserUpdateRequest,
)
from app.schemas.common import SystemHealth
from app.schemas.governance import IntegrationOut
from app.services import auth_service, integration_service, system_service
from app.services.serializers import integration_out

router = APIRouter(prefix="/admin", tags=["Administration"])


def _user_admin_out(user: User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "title": user.title,
        "is_active": user.is_active,
        "preferences": user.preferences or {},
        "last_login_at": user.last_login_at,
        "created_at": user.created_at,
        "role": {
            "id": user.role.id,
            "key": user.role.key,
            "name": user.role.name,
            "description": user.role.description,
        },
        "team": {"id": user.team.id, "name": user.team.name, "slug": user.team.slug} if user.team else None,
    }


@router.get("/users", response_model=list[UserAdminOut])
async def list_users(
    user: User = Depends(require_permission("admin:users")),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    return [_user_admin_out(row) for row in await auth_service.list_users(db)]


@router.post("/users", response_model=UserAdminOut, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreateRequest,
    user: User = Depends(require_permission("admin:users")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    created = await auth_service.create_user(db, user, payload)
    return _user_admin_out(created)


@router.patch("/users/{user_id}", response_model=UserAdminOut)
async def update_user(
    user_id: str,
    payload: UserUpdateRequest,
    user: User = Depends(require_permission("admin:users")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    updated = await auth_service.update_user(db, user, user_id, payload)
    return _user_admin_out(updated)


@router.get("/roles", response_model=list[RoleWithPermissions])
async def list_roles(
    user: User = Depends(require_permission("admin:roles")),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    roles = await auth_service.list_roles(db)
    return [
        {
            "id": role.id,
            "key": role.key,
            "name": role.name,
            "description": role.description,
            "permissions": sorted(ROLE_PERMISSIONS.get(role.key, set())),
        }
        for role in roles
    ]


@router.get("/teams", response_model=list[TeamOut])
async def list_teams(
    user: User = Depends(require_permission("admin:users")),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    teams = await auth_service.list_teams(db)
    return [{"id": team.id, "name": team.name, "slug": team.slug} for team in teams]


@router.post("/teams", response_model=TeamOut, status_code=201)
async def create_team(
    payload: dict,
    user: User = Depends(require_permission("admin:users")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    name = str(payload.get("name", "")).strip()
    if len(name) < 2:
        raise invalid("A team name is required.")
    slug = str(payload.get("slug") or name.lower().replace(" ", "-")).strip().lower()
    if (await db.execute(select(Team).where(Team.slug == slug))).scalar_one_or_none():
        raise invalid("A team with this slug already exists.")
    team = Team(name=name, slug=slug)
    db.add(team)
    await db.commit()
    await db.refresh(team)
    return {"id": team.id, "name": team.name, "slug": team.slug}


@router.get("/integrations", response_model=list[IntegrationOut])
async def admin_integrations(
    user: User = Depends(require_permission("integrations:read")),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    return [integration_out(row) for row in await integration_service.list_integrations(db)]


@router.get("/system-health", response_model=SystemHealth)
async def admin_system_health(
    user: User = Depends(require_permission("admin:settings")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    return await system_service.system_health(db)


@router.get("/summary")
async def admin_summary(
    user: User = Depends(require_permission("admin:settings")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    return await system_service.system_summary(db)
