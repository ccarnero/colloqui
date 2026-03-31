from __future__ import annotations

from src.interfaces.websocket.connection import get_websocket_connect_kwargs


def test_get_websocket_connect_kwargs_supports_additional_headers(
    monkeypatch,
) -> None:
    def fake_connect(url: str, additional_headers=None):
        return url, additional_headers

    monkeypatch.setattr("src.websocket.connection.websockets.connect", fake_connect)

    kwargs = get_websocket_connect_kwargs({"Authorization": "Bearer token"})

    assert kwargs == {
        "additional_headers": {"Authorization": "Bearer token"},
    }


def test_get_websocket_connect_kwargs_supports_extra_headers(
    monkeypatch,
) -> None:
    def fake_connect(url: str, extra_headers=None):
        return url, extra_headers

    monkeypatch.setattr("src.websocket.connection.websockets.connect", fake_connect)

    kwargs = get_websocket_connect_kwargs({"Authorization": "Bearer token"})

    assert kwargs == {
        "extra_headers": {"Authorization": "Bearer token"},
    }
