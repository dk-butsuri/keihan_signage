from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from controller import main as controller
import seasons


PERIODS = [{"id": "christmas", "from": "12-01", "to": "12-25"}, {"id": "shogatsu", "from": "12-28", "to": "01-03"}]


@pytest.mark.parametrize("day, override, expected", [
    ("2026-11-30", None, None),
    ("2026-12-01", None, "christmas"),
    ("2026-12-25", None, "christmas"),
    ("2026-12-26", None, None),
    ("2026-12-28", None, "shogatsu"),
    ("2027-01-03", None, "shogatsu"),
    ("2027-01-04", None, None),
    ("2026-12-10", "off", None),
    ("2026-07-01", "christmas", "christmas"),
])
def test_active_season_follows_periods_and_override(day, override, expected):
    data = {"override": override, "periods": PERIODS}
    assert controller.active_season(data, datetime.fromisoformat(day)) == expected


def test_season_api_saves_and_reports_to_displays(tmp_path, monkeypatch):
    monkeypatch.setattr(controller, "DATA_DIR", tmp_path)
    monkeypatch.setattr(controller, "SEASON_FILE", tmp_path / "season.json")
    monkeypatch.setattr(controller, "ADMIN_TOKEN", "secret")
    client = TestClient(controller.app)
    assert client.get("/api/season").json()["periods"] == controller.DEFAULT_SEASONS["periods"]
    body = {"override": "christmas", "periods": PERIODS}
    assert client.put("/api/season", json=body).status_code == 401
    saved = client.put("/api/season", json=body, headers={"Authorization": "Bearer secret"})
    assert saved.status_code == 200 and saved.json()["active"] == "christmas"
    assert client.get("/api/mode").json()["season"] == "christmas"
    for bad in ({"override": "../x", "periods": []}, {"override": None, "periods": [{"id": "a", "from": "13-01", "to": "01-01"}]},
                {"override": None, "periods": "x"}):
        assert client.put("/api/season", json=bad, headers={"Authorization": "Bearer secret"}).status_code == 400
    client.close()


def test_season_files_are_served_only_from_existing_folders():
    from fastapi import FastAPI
    app = FastAPI()
    app.include_router(seasons.router)
    client = TestClient(app)
    assert "christmas" in seasons.season_ids()
    for prefix in ("/assets", "/demo/assets"):
        assert client.get(f"{prefix}/seasonal.js").status_code == 200
        assert client.get(f"{prefix}/seasons/christmas/theme.js").headers["content-type"].startswith("text/javascript")
        assert client.get(f"{prefix}/seasons/christmas/theme.css").headers["content-type"].startswith("text/css")
        assert client.get(f"{prefix}/seasons/christmas/seasonal.js").status_code == 404
        assert client.get(f"{prefix}/seasons/nope/theme.js").status_code == 404
    client.close()
