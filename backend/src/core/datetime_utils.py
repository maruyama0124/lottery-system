"""日時ユーティリティ — DB は timestamptz、Python 側は aware な UTC で統一する (D-013)

naive な datetime を DB に渡さないこと。API レスポンスにオフセットが付かず、
フロントエンド (JavaScript の new Date) がローカル時刻として解釈して時差分ずれるため。
"""
from datetime import datetime, timezone


def to_utc(dt: datetime) -> datetime:
    """日時を UTC の aware な datetime に正規化する。

    naive な入力は UTC とみなす（移行前に保存された値との互換のため）。
    """
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
