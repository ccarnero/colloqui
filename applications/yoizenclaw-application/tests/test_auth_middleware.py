from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api.middleware.auth import ApiKeyAuthMiddleware


def create_test_client() -> TestClient:
    app = FastAPI()
    app.add_middleware(ApiKeyAuthMiddleware, api_key="test-key")

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/logs")
    async def logs() -> dict[str, list[str]]:
        return {"logs": []}

    @app.get("/memories")
    async def memories() -> dict[str, list[str]]:
        return {"items": []}

    @app.get("/protected")
    async def protected() -> dict[str, str]:
        return {"status": "protected"}

    return TestClient(app)


def test_logs_endpoint_is_exempt_from_api_key() -> None:
    client = create_test_client()

    response = client.get("/logs")

    assert response.status_code == 200
    assert response.json() == {"logs": []}


def test_memories_endpoint_is_exempt_from_api_key() -> None:
    client = create_test_client()

    response = client.get("/memories")

    assert response.status_code == 200
    assert response.json() == {"items": []}


def test_protected_endpoint_requires_api_key() -> None:
    client = create_test_client()

    response = client.get("/protected")

    assert response.status_code == 401
    assert response.json() == {"detail": "Missing X-API-Key header"}
