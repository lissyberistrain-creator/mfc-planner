import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Generator

from fastapi import Depends, FastAPI, Header, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, UniqueConstraint, create_engine, or_, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./mfc_planner.db")
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+psycopg://", 1)
elif DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg://", 1)

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, pool_pre_ping=True, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(120), default="")
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class LoginSession(Base):
    __tablename__ = "login_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(220))
    layout: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class ProjectMember(Base):
    __tablename__ = "project_members"
    __table_args__ = (UniqueConstraint("project_id", "user_id", name="uq_project_member"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(20), default="viewer")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ProjectVersion(Base):
    __tablename__ = "project_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    version_no: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(220))
    layout: Mapped[dict] = mapped_column(JSON, default=dict)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ShareLink(Base):
    __tablename__ = "share_links"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    role: Mapped[str] = mapped_column(String(20), default="viewer")
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


Base.metadata.create_all(bind=engine)

app = FastAPI(title="MFC Planner Cloud API", version="8.5")

origins_raw = os.getenv("CORS_ORIGINS", "*")
origins = [x.strip() for x in origins_raw.split(",") if x.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins or ["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RegisterRequest(BaseModel):
    email: str
    password: str = Field(min_length=8, max_length=200)
    display_name: str = Field(default="", max_length=120)


class LoginRequest(BaseModel):
    email: str
    password: str


class ProjectCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=220)
    layout: dict = Field(default_factory=dict)


class ProjectUpdateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=220)
    layout: dict = Field(default_factory=dict)
    expected_updated_at: str | None = None


class MemberRequest(BaseModel):
    email: str
    role: str = "viewer"


class ShareLinkRequest(BaseModel):
    role: str = "viewer"
    expires_days: int | None = Field(default=30, ge=1, le=365)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def normalize_email(email: str) -> str:
    value = (email or "").strip().lower()
    if "@" not in value or "." not in value.rsplit("@", 1)[-1]:
        raise HTTPException(status_code=422, detail="Некорректный email")
    return value


def normalize_role(role: str, allow_owner: bool = False) -> str:
    allowed = {"viewer", "editor"}
    if allow_owner:
        allowed.add("owner")
    if role not in allowed:
        raise HTTPException(status_code=422, detail="Роль должна быть viewer или editor")
    return role


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 240_000)
    return f"pbkdf2_sha256$240000${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, iterations, salt_hex, expected = stored.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(iterations)
        )
        return secrets.compare_digest(digest.hex(), expected)
    except Exception:
        return False


def public_user(user: User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "display_name": user.display_name,
        "created_at": user.created_at.isoformat(),
    }


def create_login_session(db: Session, user: User) -> str:
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    db.add(
        LoginSession(
            token_hash=token_hash,
            user_id=user.id,
            expires_at=utcnow() + timedelta(days=30),
        )
    )
    db.commit()
    return token


def current_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Требуется вход")
    token = authorization.split(" ", 1)[1].strip()
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    login = db.scalar(select(LoginSession).where(LoginSession.token_hash == token_hash))
    if not login:
        raise HTTPException(status_code=401, detail="Сессия не найдена")
    expires = login.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires <= utcnow():
        db.delete(login)
        db.commit()
        raise HTTPException(status_code=401, detail="Сессия истекла")
    user = db.get(User, login.user_id)
    if not user:
        raise HTTPException(status_code=401, detail="Пользователь не найден")
    return user


ROLE_RANK = {"viewer": 1, "editor": 2, "owner": 3}


def project_role(project: Project, user: User, db: Session) -> str | None:
    if project.owner_id == user.id:
        return "owner"
    member = db.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project.id,
            ProjectMember.user_id == user.id,
        )
    )
    return member.role if member else None


def require_project(project_id: int, user: User, db: Session, minimum: str = "viewer") -> tuple[Project, str]:
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Проект не найден")
    role = project_role(project, user, db)
    if not role or ROLE_RANK[role] < ROLE_RANK[minimum]:
        raise HTTPException(status_code=404, detail="Проект не найден")
    return project, role


def public_project(project: Project, role: str, include_layout: bool = False) -> dict:
    data = {
        "id": project.id,
        "name": project.name,
        "owner_id": project.owner_id,
        "role": role,
        "created_at": project.created_at.isoformat(),
        "updated_at": project.updated_at.isoformat(),
    }
    if include_layout:
        data["layout"] = project.layout or {}
    return data


def next_version_no(project_id: int, db: Session) -> int:
    versions = db.scalars(
        select(ProjectVersion).where(ProjectVersion.project_id == project_id)
    ).all()
    return max([v.version_no for v in versions], default=0) + 1


def create_version(project: Project, user_id: int | None, db: Session) -> ProjectVersion:
    version = ProjectVersion(
        project_id=project.id,
        version_no=next_version_no(project.id, db),
        name=project.name,
        layout=project.layout or {},
        created_by=user_id,
        created_at=utcnow(),
    )
    db.add(version)
    return version


def update_project_internal(
    project: Project,
    name: str,
    layout: dict,
    expected_updated_at: str | None,
    user_id: int | None,
    db: Session,
) -> Project:
    if expected_updated_at and expected_updated_at != project.updated_at.isoformat():
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Проект уже изменён на сервере другим пользователем.",
                "server_updated_at": project.updated_at.isoformat(),
                "project_id": project.id,
            },
        )
    project.name = name.strip()
    project.layout = layout
    project.updated_at = utcnow()
    db.add(project)
    create_version(project, user_id, db)
    db.commit()
    db.refresh(project)
    return project


def share_link_by_token(raw_token: str, db: Session) -> ShareLink:
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    link = db.scalar(select(ShareLink).where(ShareLink.token_hash == token_hash))
    if not link:
        raise HTTPException(status_code=404, detail="Ссылка недействительна")
    if link.expires_at:
        expires = link.expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires <= utcnow():
            raise HTTPException(status_code=410, detail="Срок действия ссылки истёк")
    return link


@app.get("/health")
def health():
    return {"status": "ok", "service": "mfc-planner-cloud", "version": "8.5"}


@app.post("/auth/register")
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    email = normalize_email(payload.email)
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status_code=409, detail="Пользователь с таким email уже существует")
    user = User(
        email=email,
        display_name=(payload.display_name or "").strip(),
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"token": create_login_session(db, user), "user": public_user(user)}


@app.post("/auth/login")
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    email = normalize_email(payload.email)
    user = db.scalar(select(User).where(User.email == email))
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Неверный email или пароль")
    return {"token": create_login_session(db, user), "user": public_user(user)}


@app.get("/auth/me")
def me(user: User = Depends(current_user)):
    return public_user(user)


@app.get("/projects")
def list_projects(user: User = Depends(current_user), db: Session = Depends(get_db)):
    memberships = db.scalars(select(ProjectMember).where(ProjectMember.user_id == user.id)).all()
    member_ids = [m.project_id for m in memberships]
    stmt = select(Project).where(
        or_(Project.owner_id == user.id, Project.id.in_(member_ids) if member_ids else Project.id == -1)
    ).order_by(Project.updated_at.desc())
    projects = db.scalars(stmt).all()
    return [public_project(p, project_role(p, user, db) or "viewer") for p in projects]


@app.post("/projects")
def create_project(
    payload: ProjectCreateRequest,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    project = Project(
        owner_id=user.id,
        name=payload.name.strip(),
        layout=payload.layout,
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db.add(project)
    db.flush()
    create_version(project, user.id, db)
    db.commit()
    db.refresh(project)
    return public_project(project, "owner", include_layout=True)


@app.get("/projects/{project_id}")
def get_project(
    project_id: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    project, role = require_project(project_id, user, db, "viewer")
    return public_project(project, role, include_layout=True)


@app.put("/projects/{project_id}")
def update_project(
    project_id: int,
    payload: ProjectUpdateRequest,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    project, role = require_project(project_id, user, db, "editor")
    project = update_project_internal(
        project, payload.name, payload.layout, payload.expected_updated_at, user.id, db
    )
    return public_project(project, role, include_layout=True)


@app.delete("/projects/{project_id}")
def delete_project(
    project_id: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    project, role = require_project(project_id, user, db, "owner")
    db.delete(project)
    db.commit()
    return {"status": "deleted", "id": project_id}


@app.get("/projects/{project_id}/members")
def list_members(
    project_id: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    project, _ = require_project(project_id, user, db, "viewer")
    owner = db.get(User, project.owner_id)
    out = [{
        "user_id": owner.id,
        "email": owner.email,
        "display_name": owner.display_name,
        "role": "owner",
    }]
    members = db.scalars(select(ProjectMember).where(ProjectMember.project_id == project_id)).all()
    for m in members:
        u = db.get(User, m.user_id)
        if u:
            out.append({
                "user_id": u.id,
                "email": u.email,
                "display_name": u.display_name,
                "role": m.role,
            })
    return out


@app.post("/projects/{project_id}/members")
def add_member(
    project_id: int,
    payload: MemberRequest,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    project, _ = require_project(project_id, user, db, "owner")
    role = normalize_role(payload.role)
    email = normalize_email(payload.email)
    target = db.scalar(select(User).where(User.email == email))
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь с таким email ещё не зарегистрирован")
    if target.id == project.owner_id:
        raise HTTPException(status_code=409, detail="Владелец уже имеет полный доступ")
    member = db.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == target.id,
        )
    )
    if member:
        member.role = role
    else:
        member = ProjectMember(project_id=project_id, user_id=target.id, role=role)
        db.add(member)
    db.commit()
    return {"status": "ok", "user_id": target.id, "email": target.email, "role": role}


@app.delete("/projects/{project_id}/members/{user_id}")
def remove_member(
    project_id: int,
    user_id: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    project, _ = require_project(project_id, user, db, "owner")
    if user_id == project.owner_id:
        raise HTTPException(status_code=409, detail="Нельзя удалить владельца проекта")
    member = db.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user_id,
        )
    )
    if not member:
        raise HTTPException(status_code=404, detail="Участник не найден")
    db.delete(member)
    db.commit()
    return {"status": "deleted"}


@app.get("/projects/{project_id}/versions")
def list_versions(
    project_id: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    require_project(project_id, user, db, "viewer")
    versions = db.scalars(
        select(ProjectVersion)
        .where(ProjectVersion.project_id == project_id)
        .order_by(ProjectVersion.version_no.desc())
    ).all()
    return [{
        "id": v.id,
        "version_no": v.version_no,
        "name": v.name,
        "created_by": v.created_by,
        "created_at": v.created_at.isoformat(),
    } for v in versions]


@app.post("/projects/{project_id}/versions/{version_id}/restore")
def restore_version(
    project_id: int,
    version_id: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    project, role = require_project(project_id, user, db, "editor")
    version = db.get(ProjectVersion, version_id)
    if not version or version.project_id != project_id:
        raise HTTPException(status_code=404, detail="Версия не найдена")
    project.name = version.name
    project.layout = version.layout or {}
    project.updated_at = utcnow()
    create_version(project, user.id, db)
    db.commit()
    db.refresh(project)
    return public_project(project, role, include_layout=True)


@app.post("/projects/{project_id}/share-links")
def create_share_link(
    project_id: int,
    payload: ShareLinkRequest,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    project, _ = require_project(project_id, user, db, "owner")
    role = normalize_role(payload.role)
    raw = secrets.token_urlsafe(32)
    expires_at = utcnow() + timedelta(days=payload.expires_days) if payload.expires_days else None
    link = ShareLink(
        project_id=project.id,
        token_hash=hashlib.sha256(raw.encode("utf-8")).hexdigest(),
        role=role,
        created_by=user.id,
        expires_at=expires_at,
    )
    db.add(link)
    db.commit()
    return {
        "token": raw,
        "role": role,
        "expires_at": expires_at.isoformat() if expires_at else None,
    }


@app.get("/projects/{project_id}/share-links")
def list_share_links(
    project_id: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    require_project(project_id, user, db, "owner")
    links = db.scalars(
        select(ShareLink).where(ShareLink.project_id == project_id).order_by(ShareLink.created_at.desc())
    ).all()
    return [{
        "id": link.id,
        "role": link.role,
        "created_at": link.created_at.isoformat(),
        "expires_at": link.expires_at.isoformat() if link.expires_at else None,
    } for link in links]


@app.delete("/projects/{project_id}/share-links/{link_id}")
def revoke_share_link(
    project_id: int,
    link_id: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    require_project(project_id, user, db, "owner")
    link = db.get(ShareLink, link_id)
    if not link or link.project_id != project_id:
        raise HTTPException(status_code=404, detail="Ссылка не найдена")
    db.delete(link)
    db.commit()
    return {"status": "revoked"}


@app.get("/share/{token}")
def get_shared_project(token: str, db: Session = Depends(get_db)):
    link = share_link_by_token(token, db)
    project = db.get(Project, link.project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Проект не найден")
    return {
        "id": project.id,
        "name": project.name,
        "layout": project.layout or {},
        "role": link.role,
        "updated_at": project.updated_at.isoformat(),
    }


@app.put("/share/{token}")
def update_shared_project(
    token: str,
    payload: ProjectUpdateRequest,
    db: Session = Depends(get_db),
):
    link = share_link_by_token(token, db)
    if link.role != "editor":
        raise HTTPException(status_code=403, detail="Ссылка доступна только для просмотра")
    project = db.get(Project, link.project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Проект не найден")
    project = update_project_internal(
        project, payload.name, payload.layout, payload.expected_updated_at, None, db
    )
    return {
        "id": project.id,
        "name": project.name,
        "layout": project.layout or {},
        "role": "editor",
        "updated_at": project.updated_at.isoformat(),
    }
