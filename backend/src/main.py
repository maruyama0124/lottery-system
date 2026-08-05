"""FastAPI アプリケーション — エントリーポイント

create_app() を分離してテスタビリティを確保する (backend-init 方針の踏襲)。
"""
from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from src.api import auth, health, lottery, practice_months, settings, users
from src.core.errors import AppError

API_PREFIX = "/api/v1"


def create_app() -> FastAPI:
    app = FastAPI(
        title="サークル練習参加抽選システム API",
        version="1.0.0",
        openapi_url=f"{API_PREFIX}/openapi.json",
        docs_url=f"{API_PREFIX}/docs",
    )

    @app.exception_handler(AppError)
    async def app_error_handler(_request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": {
                    "code": exc.code,
                    "message": exc.message,
                    "details": exc.details,
                }
            },
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(
        _request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        """API設計書 §3 のエラー形式 (400 VALIDATION_ERROR) に変換する"""
        details = [
            {"field": ".".join(str(loc) for loc in e["loc"][1:]), "reason": e["type"]}
            for e in exc.errors()
        ]
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "error": {
                    "code": "VALIDATION_ERROR",
                    "message": "入力内容に誤りがあります",
                    "details": details,
                }
            },
        )

    app.include_router(health.router, prefix=API_PREFIX)
    app.include_router(auth.router, prefix=API_PREFIX)
    app.include_router(users.router, prefix=API_PREFIX)
    app.include_router(practice_months.router, prefix=API_PREFIX)
    app.include_router(lottery.router, prefix=API_PREFIX)
    app.include_router(settings.router, prefix=API_PREFIX)

    return app


app = create_app()
