"""プレフィックス付き ULID 生成 (DB設計書 §1: 例 usr_01H...)"""
from ulid import ULID


def generate_id(prefix: str) -> str:
    return f"{prefix}_{ULID()}"
