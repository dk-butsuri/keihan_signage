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
    monkeypatch.setattr(controller, "season_catalog", seasons.catalog())
    client = TestClient(controller.app)
    listed = client.get("/api/season").json()["periods"]
    assert [p["id"] for p in listed] == [item["id"] for item in seasons.catalog()]
    assert {p["id"]: p["label"] for p in listed}["valentine"] == "バレンタイン"
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


def test_every_season_folder_has_a_valid_meta():
    # meta.json が無い・壊れている装飾は一覧に載らず、期間どおりに出なくなる
    assert [item["id"] for item in seasons.catalog()] != []
    assert sorted(item["id"] for item in seasons.catalog()) == seasons.season_ids()
    assert controller._valid_catalog(seasons.catalog()) == seasons.catalog()


def test_saved_periods_override_the_catalog(tmp_path, monkeypatch):
    monkeypatch.setattr(controller, "SEASON_FILE", tmp_path / "season.json")
    monkeypatch.setattr(controller, "season_catalog", [
        {"id": "christmas", "label": "クリスマス", "from": "12-01", "to": "12-25"},
        {"id": "valentine", "label": "バレンタイン", "from": "02-07", "to": "02-14"}])
    # 保存が無ければ meta.json の期間
    assert controller.active_season(controller.load_seasons(), datetime.fromisoformat("2027-02-10")) == "valentine"
    # 管理画面で変えた期間が勝ち、一覧に無い装飾（フォルダを消したもの）は出さない
    (tmp_path / "season.json").write_text('{"override": null, "periods": [{"id": "valentine", "from": "02-13", "to": "02-14"},'
                                          ' {"id": "gone", "from": "01-01", "to": "12-31"}]}', encoding="utf-8")
    data = controller.load_seasons()
    assert [p["id"] for p in data["periods"]] == ["christmas", "valentine"]
    assert controller.active_season(data, datetime.fromisoformat("2027-02-10")) is None
    assert controller.active_season(data, datetime.fromisoformat("2027-02-13")) == "valentine"
    # transit から一覧が取れないあいだは、保存した期間だけで決める
    monkeypatch.setattr(controller, "season_catalog", [])
    assert controller.active_season(controller.load_seasons(), datetime.fromisoformat("2027-06-01")) == "gone"


def test_catalog_from_transit_is_validated():
    for bad in (None, "x", [{"id": "../x", "label": "a", "from": "01-01", "to": "01-02"}],
                [{"id": "a", "label": "a", "from": "1-1", "to": "01-02"}], [{"id": "a", "from": "01-01", "to": "01-02"}]):
        with pytest.raises(ValueError):
            controller._valid_catalog(bad)
