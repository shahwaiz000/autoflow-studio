from datetime import datetime, timezone
from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def iso(dt: datetime | None) -> str | None:
    return dt.isoformat() + "Z" if dt else None


class Workflow(Base):
    __tablename__ = "workflows"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(60), default="General")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    definition: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    executions: Mapped[list["Execution"]] = relationship(back_populates="workflow")

    def to_dict(self, with_definition: bool = False) -> dict:
        d = {
            "id": self.id, "name": self.name, "description": self.description,
            "category": self.category, "enabled": self.enabled,
            "step_count": len(self.definition.get("steps", [])),
            "created_at": iso(self.created_at),
        }
        if with_definition:
            d["definition"] = self.definition
        return d


class Execution(Base):
    __tablename__ = "executions"
    id: Mapped[int] = mapped_column(primary_key=True)
    workflow_id: Mapped[int] = mapped_column(ForeignKey("workflows.id"))
    status: Mapped[str] = mapped_column(String(20), default="running")  # running|success|failed
    trigger_type: Mapped[str] = mapped_column(String(20), default="manual")
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    workflow: Mapped[Workflow] = relationship(back_populates="executions")
    steps: Mapped[list["ExecutionStep"]] = relationship(
        back_populates="execution", order_by="ExecutionStep.position", cascade="all, delete-orphan")

    def to_dict(self, with_steps: bool = False) -> dict:
        d = {
            "id": self.id, "workflow_id": self.workflow_id, "workflow_name": self.workflow.name,
            "status": self.status, "trigger_type": self.trigger_type,
            "started_at": iso(self.started_at), "finished_at": iso(self.finished_at),
            "duration_seconds": self.duration_seconds, "error_message": self.error_message,
            "is_demo": self.is_demo,
        }
        if with_steps:
            d["steps"] = [s.to_dict() for s in self.steps]
        return d


class ExecutionStep(Base):
    __tablename__ = "execution_steps"
    id: Mapped[int] = mapped_column(primary_key=True)
    execution_id: Mapped[int] = mapped_column(ForeignKey("executions.id"))
    position: Mapped[int] = mapped_column(Integer)
    step_id: Mapped[str] = mapped_column(String(40))
    step_type: Mapped[str] = mapped_column(String(30))
    name: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(20))  # success|failed
    attempts: Mapped[int] = mapped_column(Integer, default=1)
    message: Mapped[str] = mapped_column(Text, default="")
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    execution: Mapped[Execution] = relationship(back_populates="steps")

    def to_dict(self) -> dict:
        return {
            "position": self.position, "step_id": self.step_id, "step_type": self.step_type,
            "name": self.name, "status": self.status, "attempts": self.attempts,
            "message": self.message, "duration_ms": self.duration_ms,
        }


class Schedule(Base):
    """Run a workflow automatically. Times are stored in UTC; tz_offset_minutes only
    says which clock the person meant (for example +180 for Jeddah)."""
    __tablename__ = "schedules"
    id: Mapped[int] = mapped_column(primary_key=True)
    workflow_id: Mapped[int] = mapped_column(ForeignKey("workflows.id"))
    kind: Mapped[str] = mapped_column(String(10))  # interval | daily | weekly
    interval_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    time_of_day: Mapped[str | None] = mapped_column(String(5), nullable=True)  # "HH:MM" on the person's clock
    weekday: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 0 = Monday
    tz_offset_minutes: Mapped[int] = mapped_column(Integer, default=0)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_status: Mapped[str | None] = mapped_column(String(200), nullable=True)
    last_execution_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    workflow: Mapped[Workflow] = relationship()

    def to_dict(self) -> dict:
        return {
            "id": self.id, "workflow_id": self.workflow_id, "workflow_name": self.workflow.name,
            "workflow_enabled": self.workflow.enabled, "kind": self.kind,
            "interval_minutes": self.interval_minutes, "time_of_day": self.time_of_day,
            "weekday": self.weekday, "tz_offset_minutes": self.tz_offset_minutes,
            "enabled": self.enabled, "next_run_at": iso(self.next_run_at),
            "last_run_at": iso(self.last_run_at), "last_status": self.last_status,
            "last_execution_id": self.last_execution_id, "created_at": iso(self.created_at),
        }


class DataFile(Base):
    """Remembers the original name of each uploaded CSV (it is stored under a random name)."""
    __tablename__ = "data_files"
    id: Mapped[int] = mapped_column(primary_key=True)
    stored_name: Mapped[str] = mapped_column(String(80), unique=True)
    original_name: Mapped[str] = mapped_column(String(100))
    execution_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
