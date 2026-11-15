import asyncio
import json
import re

import pytest
from fastapi.testclient import TestClient
from keihan_tracker.bus.tracker import parse_busstate

import main
from demo_scenarios import SCENARIOS, static_scenario


@pytest.mark.parametrize("text,minutes", [
    ("定時運行中", 0), ("約5分遅れ", 5), ("約1時間15分遅れ", 75),
    (None, None), ("到着済", None),
])
def test_bus_delay_reaches_api_without_changing_prediction_or_terminal(monkeypatch, text, minutes):
    header = "定刻： 17:12" + (f" ({text})" if text else "")
    response = parse_busstate(json.dumps({
        "head": {"errorcode": 0, "objid": "test"},
        "body": {"datetimeStr": "2026/11/13 17:10", "busstates": [{
            "html": f'<div class="bsul first">{header}</div>',
            "busstateprms": {
                "order": 1, "lat": 0, "lon": 0, "heading": 0, "guid": "test",
                "stop_id": 1, "platform_index": 1, "route": "[22]",
                "destination": "京阪香里園行", "via": "", "status": "約7分後に到着",
                "timetable": "17:17 到着予定",
            },
        }]},
    }), "同志社香里", 1)

    async def fetch(_stop, _platform):
        return response

    async def stop(_seconds):
        raise asyncio.CancelledError

    monkeypatch.setattr(main, "_cfg", {"buses": {"stop_name": "同志社香里", "stop_numbers": [1]},
                                      "intervals": {"bus_seconds": 60}})
    monkeypatch.setattr(main, "latest_bus_data", [])
    monkeypatch.setattr(main, "latest_bus_error", None)
    monkeypatch.setattr(main, "_last_bus_success", None)
    monkeypatch.setattr(main.bus_client, "get_info", fetch)
    with monkeypatch.context() as loop:
        loop.setattr(main.asyncio, "sleep", stop)
        with pytest.raises(asyncio.CancelledError):
            asyncio.run(main.update_bus_loop())
    client = TestClient(main.app)
    data = client.get("/api/buses").json()
    client.close()
    assert data["error"] is None
    (bus,) = data["buses"]
    assert bus["scheduled_time"] == "17:12"
    assert bus["delay_text"] == text and bus["delay_minutes"] == minutes
    assert bus["arrival_time"] == "17:17 到着予定"
    assert bus["status"] == "約7分後に到着"
    assert bus["terminal_arrival_time"] is None


@pytest.mark.parametrize("scenario_id", [s["id"] for s in SCENARIOS if s["mode"] == "static"])
def test_bus_demos_only_use_status_formats_seen_in_official_responses(scenario_id):
    # 公式応答の保存データ（keihan_tracker/tests/fixtures/bus）と詳細ページで確認した形式。
    # 未受信は status ではなく、定刻の timetable と欠けた delay_text で表す。
    for bus in static_scenario(scenario_id)["buses"]["buses"]:
        assert bus["status"] in ("まもなく到着", "到着済") or re.fullmatch(
            r"約(?:\d+時間)?\d+分後に到着", bus["status"])
