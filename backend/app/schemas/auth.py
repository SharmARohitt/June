from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.schemas.common import APIModel


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)


class RefreshResponse(BaseModel):
    message: str
    csrf_token: str


class UserTiny(APIModel):
    id: str
    full_name: str
    email: str
    title: str = ""


class TeamOut(APIModel):
    id: str
    name: str
    slug: str


class RoleOut(APIModel):
    id: str
    key: str
    name: str
    description: str


class RoleWithPermissions(RoleOut):
    permissions: list[str]


class UserBase(APIModel):
    id: str
    email: str
    full_name: str
    title: str
    is_active: bool
    preferences: dict
    last_login_at: datetime | None
    created_at: datetime
    role: RoleOut
    team: TeamOut | None


class UserOut(UserBase):
    permissions: list[str]


class SessionResponse(BaseModel):
    user: UserOut
    csrf_token: str
    expires_in: int


class PreferencesUpdate(BaseModel):
    beginner_mode: bool | None = None
    timezone: str | None = Field(default=None, max_length=80)
    reduce_motion: bool | None = None
    density: str | None = Field(default=None, pattern="^(comfortable|compact)$")


class UserAdminOut(UserBase):
    team: TeamOut | None = None


class UserCreateRequest(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=140)
    title: str = Field(default="", max_length=120)
    password: str = Field(min_length=12, max_length=200)
    role_key: str
    team_id: str | None = None


class UserUpdateRequest(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=140)
    title: str | None = Field(default=None, max_length=120)
    role_key: str | None = None
    is_active: bool | None = None
    team_id: str | None = None
    password: str | None = Field(default=None, min_length=12, max_length=200)
