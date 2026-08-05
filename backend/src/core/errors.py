"""共通エラークラス — API設計書のエラーレスポンス仕様に対応"""
from typing import Any


class AppError(Exception):
    """アプリケーション共通例外。

    エラーレスポンス形式 (api-design/index.md §3):
        {"error": {"code": ..., "message": ..., "details": [...]}}
    """

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        details: list[dict[str, Any]] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details


class UnauthorizedError(AppError):
    def __init__(self, message: str = "認証が必要です") -> None:
        super().__init__(401, "UNAUTHORIZED", message)


class ForbiddenError(AppError):
    def __init__(self, message: str = "この操作を行う権限がありません") -> None:
        super().__init__(403, "FORBIDDEN", message)


class NotFoundError(AppError):
    def __init__(self, message: str = "リソースが見つかりません") -> None:
        super().__init__(404, "NOT_FOUND", message)


class ConflictError(AppError):
    def __init__(self, message: str) -> None:
        super().__init__(409, "CONFLICT", message)


class ValidationError(AppError):
    """Pydantic では表現できない入力不正 (項目間の整合性など)"""

    def __init__(self, message: str) -> None:
        super().__init__(400, "VALIDATION_ERROR", message)
