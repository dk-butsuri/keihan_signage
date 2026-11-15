import datetime

import pytest
from fastapi.testclient import TestClient

import demo
import main


def test_playground_routes_and_model_validation(monkeypatch, tmp_path):
    monkeypatch.setattr(demo, "DATA_FILE", tmp_path / "missing.json")
    config = {"features": {"trains": False}}
    monkeypatch.setattr(main, "_cfg", config)
    tracker, suspension = main.tracker, vars(main._suspension).copy()
    client = TestClient(main.app)
    for path in ("/demo/playground", "/demo/playground/", "/demo/playground/preview"):
        response = client.get(path)
        assert response.status_code == 200 and response.headers["cache-control"] == "no-store"
        assert client.head(path).status_code == 200
    for path in ("/demo/playground/player.js", "/demo/playground/preview/player.js"):
        assert client.get(path).status_code == 200
    boot = client.get("/demo/playground/data").json()
    assert boot["mode"] == "playground" and len(boot["routes"]) > 40
    assert main.StationResponse(**boot["frame"]["trains"])
    assert main.LineResponse(**boot["frame"]["line"])
    assert main.DelayResponse(**boot["frame"]["delays"])
    assert main.BusResponse(**boot["frame"]["buses"])
    for state in ({"train_delay": -1}, {"train_count": 100}, {"bus_count": 7}, {"screen": "invalid"},
                  {"routes": {"hanshin:阪神本線": {"status": "invalid"}}}):
        assert client.post("/demo/playground/evaluate", json=state).status_code == 422
    assert client.post("/demo/playground/evaluate", json={"routes": {"fake:line": {}}}).status_code == 400
    assert main._cfg is config and main.tracker is tracker and vars(main._suspension) == suspension
    client.close()


def test_playground_uses_real_unknown_and_severity_rules():
    client = TestClient(main.app)
    def evaluate(routes):
        response = client.post("/demo/playground/evaluate", json={"routes": routes})
        assert response.status_code == 200
        return response.json()["delays"]
    unknown = {"hanshin:阪神本線": {"status": "unknown"}}
    data = evaluate(unknown)
    assert (data["groups"][-1]["mark"], data["groups"][-1]["status"]) == ("！", "状況不明")
    assert not data["delays"]
    data = evaluate({**unknown, "hankyu:京都線": {"status": "suspended", "detail": "架空の発表文", "age": 42}})
    assert data["groups"][-1]["mark"] == "×"
    assert data["groups"][-1]["lines"][0]["detail"] == "架空の発表文"
    announced = datetime.datetime.fromisoformat(data["groups"][-1]["lines"][0]["announced_time"])
    assert announced.strftime("%H:%M") == "14:18"
    for status, mark in (("missing", "−"), ("unknown", "！"), ("normal", "○")):
        data = evaluate({"osaka_monorail:" + name: {"status": status} for name in ("大阪モノレール線", "彩都線")})
        assert data["groups"][3]["mark"] == mark
    client.close()


@pytest.mark.parametrize("state", [
    {"train_delay": 12, "train_remaining": 25, "train_count": 6, "bus_delay": 75, "bus_remaining": 16},
    {"screen": "suspended", "train_delay": 150, "train_stop": 25, "bus_delay": None, "bus_arrived": True},
    {"bus_count": 0, "predictions": False},
])
def test_playground_numeric_controls_keep_display_data_consistent(state):
    client = TestClient(main.app)
    response = client.post("/demo/playground/evaluate", json=state)
    assert response.status_code == 200
    data = response.json()
    assert main.StationResponse(**data["trains"])
    assert main.LineResponse(**data["line"])
    assert main.BusResponse(**data["buses"])
    first = data["trains"]["up_trains"][0]
    assert first["delay"] == min(state.get("train_delay", 0), 120)
    assert len(data["trains"]["up_trains"]) == state.get("train_count", 4)
    assert data["line"]["directions"]["up"]["next"][0] == first
    assert data["line"]["suspended"] == (state.get("screen") == "suspended")
    if state.get("train_stop"):
        assert data["line"]["stopped"] == data["line"]["total"]
        assert first["stopped_minutes"] == 25 and first["minutes_remaining"] is None
        assert first["estimated_delay_minutes"] == 150
    if state.get("bus_delay") == 75:
        assert first["estimated_time"] == "15:25" and first["time"] == "15:13"
        assert data["buses"]["buses"][0]["delay_text"] == "約1時間15分遅れ"
        assert data["buses"]["buses"][0]["arrival_time"] == "15:16 到着予定"
    if state.get("bus_arrived"):
        assert data["buses"]["buses"][0]["delay_text"] == "到着済"
        assert data["buses"]["buses"][1]["delay_minutes"] is None
    client.close()
