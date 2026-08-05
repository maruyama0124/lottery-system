from fastapi.testclient import TestClient

from src.main import create_app

client = TestClient(create_app())


def test_health_returns_ok() -> None:
    res = client.get("/api/v1/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_app_error_format() -> None:
    """AppError がAPI設計書のエラー形式で返ることを確認"""
    from src.core.errors import NotFoundError

    app = create_app()

    @app.get("/api/v1/_test-error")
    def raise_error() -> None:
        raise NotFoundError()

    res = TestClient(app).get("/api/v1/_test-error")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "NOT_FOUND"
