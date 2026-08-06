"""SQLAlchemy モデル — DB設計書 (database-design/index.md v1.2.0) の8テーブル

設計方針 (DB設計書 §1):
- 主キーは varchar(30)・プレフィックス付き ULID
- 全テーブルに created_at / updated_at (TimestampMixin)
- 論理削除は is_deleted
- JSON型は jsonb
"""
from datetime import date, datetime, time
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Time,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.db.base import Base, TimestampMixin


class User(Base, TimestampMixin):
    """メンバー (usr_)"""

    __tablename__ = "users"

    email_verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    verification_code_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    verification_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    verification_attempts: Mapped[int] = mapped_column(nullable=False, server_default="0")
    id: Mapped[str] = mapped_column(String(30), primary_key=True)
    # LINE ログインで識別するメンバー (D-021)。代表はメール+パスワードのため NULL
    line_user_id: Mapped[str | None] = mapped_column(String(50), unique=True, nullable=True)
    # 代表のみが保持する。LINE ログインのメンバーは持たない (D-021)
    email: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    grade: Mapped[int] = mapped_column(nullable=False)
    gender: Mapped[str] = mapped_column(String(10), nullable=False)
    is_manager: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="member")
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    __table_args__ = (
        CheckConstraint("grade BETWEEN 1 AND 3", name="ck_users_grade"),
        CheckConstraint("gender IN ('male', 'female')", name="ck_users_gender"),
        CheckConstraint("role IN ('member', 'representative')", name="ck_users_role"),
        Index("ix_users_gender_grade", "gender", "grade"),
        Index("ix_users_role", "role"),
    )


class PracticeMonth(Base, TimestampMixin):
    """月別抽選単位 — 月 × 性別 (pmn_)"""

    __tablename__ = "practice_months"

    id: Mapped[str] = mapped_column(String(30), primary_key=True)
    year_month: Mapped[str] = mapped_column(String(7), nullable=False)  # 'YYYY-MM'
    gender: Mapped[str] = mapped_column(String(10), nullable=False)
    vote_starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    vote_ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    grade2_ratio: Mapped[Decimal | None] = mapped_column(Numeric(3, 2), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    __table_args__ = (
        CheckConstraint("gender IN ('male', 'female')", name="ck_practice_months_gender"),
        CheckConstraint(
            "status IN ('draft', 'voting', 'closed', 'drawn', 'published')",
            name="ck_practice_months_status",
        ),
        UniqueConstraint("year_month", "gender", name="uq_practice_months_ym_gender"),
    )


class Practice(Base, TimestampMixin):
    """練習日 (prc_)"""

    __tablename__ = "practices"

    id: Mapped[str] = mapped_column(String(30), primary_key=True)
    practice_month_id: Mapped[str] = mapped_column(
        String(30), ForeignKey("practice_months.id"), nullable=False
    )
    practice_date: Mapped[date] = mapped_column(Date, nullable=False)
    starts_at: Mapped[time] = mapped_column(Time, nullable=False)
    ends_at: Mapped[time] = mapped_column(Time, nullable=False)
    location: Mapped[str] = mapped_column(String(255), nullable=False)
    capacity: Mapped[int] = mapped_column(nullable=False)  # プレイヤー定員 (REQ-005.2)
    # 日別・学年別の参加人数枠 (D-015)。抽選前に代表が設定する。未設定なら NULL
    quota_grade1: Mapped[int | None] = mapped_column(nullable=True)
    quota_grade2: Mapped[int | None] = mapped_column(nullable=True)
    quota_grade3: Mapped[int | None] = mapped_column(nullable=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    __table_args__ = (
        CheckConstraint("capacity > 0", name="ck_practices_capacity"),
        Index("ix_practices_month_date", "practice_month_id", "practice_date"),
    )


class Vote(Base, TimestampMixin):
    """投票 (vot_)"""

    __tablename__ = "votes"

    id: Mapped[str] = mapped_column(String(30), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(30), ForeignKey("users.id"), nullable=False)
    practice_id: Mapped[str] = mapped_column(
        String(30), ForeignKey("practices.id"), nullable=False
    )
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    __table_args__ = (
        UniqueConstraint("user_id", "practice_id", name="uq_votes_user_practice"),
        Index("ix_votes_practice", "practice_id"),
    )


class LotteryExecution(Base, TimestampMixin):
    """抽選実行履歴 (lot_) — REQ-005.11"""

    __tablename__ = "lottery_executions"

    id: Mapped[str] = mapped_column(String(30), primary_key=True)
    practice_month_id: Mapped[str] = mapped_column(
        String(30), ForeignKey("practice_months.id"), nullable=False
    )
    executed_by: Mapped[str] = mapped_column(String(30), ForeignKey("users.id"), nullable=False)
    random_seed: Mapped[int] = mapped_column(BigInteger, nullable=False)
    # D-015 で日別・学年別の枠に置き換わったため未使用。過去の実行履歴のため残す
    grade2_ratio: Mapped[Decimal | None] = mapped_column(Numeric(3, 2), nullable=True)
    settings_snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    __table_args__ = (
        Index("ix_lottery_executions_month_active", "practice_month_id", "is_active"),
    )


class Assignment(Base, TimestampMixin):
    """参加割当 — 抽選結果 (asg_)"""

    __tablename__ = "assignments"

    id: Mapped[str] = mapped_column(String(30), primary_key=True)
    practice_id: Mapped[str] = mapped_column(
        String(30), ForeignKey("practices.id"), nullable=False
    )
    user_id: Mapped[str] = mapped_column(String(30), ForeignKey("users.id"), nullable=False)
    lottery_execution_id: Mapped[str | None] = mapped_column(
        String(30), ForeignKey("lottery_executions.id"), nullable=True  # 手動調整時は NULL
    )
    assigned_via: Mapped[str] = mapped_column(String(20), nullable=False)
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    __table_args__ = (
        CheckConstraint(
            "assigned_via IN ('manager', 'grade3', 'guaranteed', 'distribution', 'overflow', 'manual')",
            name="ck_assignments_via",
        ),
        # is_deleted = false の行に対する部分一意インデックス (DB設計書 §3)
        Index(
            "uq_assignments_practice_user_active",
            "practice_id",
            "user_id",
            unique=True,
            postgresql_where="is_deleted = false",
        ),
        Index("ix_assignments_user", "user_id"),
    )


class MonthlyMemberResult(Base, TimestampMixin):
    """月次メンバー実績 — 落選救済の入力 (mmr_) REQ-005.9"""

    __tablename__ = "monthly_member_results"

    id: Mapped[str] = mapped_column(String(30), primary_key=True)
    practice_month_id: Mapped[str] = mapped_column(
        String(30), ForeignKey("practice_months.id"), nullable=False
    )
    user_id: Mapped[str] = mapped_column(String(30), ForeignKey("users.id"), nullable=False)
    votes_count: Mapped[int] = mapped_column(nullable=False)
    wins_count: Mapped[int] = mapped_column(nullable=False)
    losses_count: Mapped[int] = mapped_column(nullable=False)
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    __table_args__ = (
        UniqueConstraint("practice_month_id", "user_id", name="uq_mmr_month_user"),
    )


class LotterySettings(Base, TimestampMixin):
    """抽選設定 (set_) — NFR-004.1"""

    __tablename__ = "lottery_settings"

    id: Mapped[str] = mapped_column(String(30), primary_key=True)
    gender: Mapped[str] = mapped_column(String(10), unique=True, nullable=False)
    rescue_alpha: Mapped[Decimal] = mapped_column(
        Numeric(3, 2), nullable=False, default=Decimal("0.2")
    )
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    __table_args__ = (
        CheckConstraint("gender IN ('male', 'female')", name="ck_lottery_settings_gender"),
    )
