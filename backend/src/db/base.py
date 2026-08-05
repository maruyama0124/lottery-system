"""SQLAlchemy Declarative Base — 全モデルの基底クラス"""
from datetime import datetime

from sqlalchemy import DateTime, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    """全テーブル共通の created_at / updated_at (DB設計書 §1)

    日時は timestamptz で保存する (D-013)。DateTime(timezone=True) を省くと
    timestamp without time zone になり、API レスポンスからオフセットが消える。
    """

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
