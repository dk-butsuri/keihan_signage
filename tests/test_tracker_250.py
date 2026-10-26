import asyncio
import datetime
from types import SimpleNamespace
from unittest.mock import Mock

import httpx
import pytest
from fastapi.testclient import TestClient
from keihan_tracker import ActiveTrainData, KeihanAPIError
from keihan_tracker.keihan_train.schemes import TrainType

import main


@pytest.fixture
def station_api(monkeypatch):
    monkeypatch.setattr(main, "_cfg", {
        "trains": {
            "station_id": 18, "min_minutes_until": 0,
            "max_trains_per_direction": 6, "leading_delay_threshold": 10,
        },
        "buses": {"stop_name": "テスト停留所", "stop_numbers": [1, 2]},
        "intervals": {"bus_seconds": 60},
    })
    station = SimpleNamespace(station_name=SimpleNamespace(ja="香里園"), upcoming_trains=[])
    monkeypatch.setattr(main, "tracker", SimpleNamespace(stations={18: station}))
    # コンテキストマネージャを使わないため、バックグラウンド取得は開始しない。
    client = TestClient(main.app)
    yield client, station
    client.close()


@pytest.mark.parametrize("stopping", [True, False, None])
def test_unknown_destination_and_three_state_stopping(station_api, stopping):
    client, station = station_api
    train = Mock(spec=ActiveTrainData)
    train.train_type = TrainType.LOCAL
    train.destination = None
    train.delay_minutes = 0
    train.direction = "up"
    train.is_stopping = stopping
    train.next_station = station
    train.next_stop_station = station
    train.train_number = "0500"
    train.cars = 7
    train.train_formation = None
    train.location_col = 1
    train.location_row = 73
    train.has_premiumcar = None
    train.line = "京阪本線・鴨東線"
    station.upcoming_trains = [(
        train, SimpleNamespace(time=datetime.datetime.now(main.JST) + datetime.timedelta(minutes=20)),
    )]

    response = client.get("/api/trains")
    assert response.status_code == 200
    data = response.json()
    assert data["error"] is None
    row = data["up_trains"][0]
    assert row["destination"] == "不明"
    assert row["is_stopping"] is stopping
    assert row["is_this_station"] is (stopping is True)
    assert row["status"] == ("当駅停車中" if stopping is True else "")


async def _stop_after_one_cycle(_seconds):
    raise asyncio.CancelledError


@pytest.mark.parametrize("error", [KeihanAPIError("壊れた応答"), httpx.ConnectError("接続失敗")])
def test_bus_failure_keeps_previous_display(station_api, monkeypatch, error):
    client, _station = station_api
    previous = [main.BusInfo(route_id="22", destination="京阪香里園", status="接近中", arrival_time="17:30")]
    monkeypatch.setattr(main, "latest_bus_data", previous)
    monkeypatch.setattr(main, "latest_bus_error", None)

    async def fetch(_name, stop):
        if stop == 2:
            raise error
        return SimpleNamespace(body=SimpleNamespace(busstates=[]))

    monkeypatch.setattr(main, "get_khbus_info", fetch)
    with monkeypatch.context() as loop_patch:
        loop_patch.setattr(main.asyncio, "sleep", _stop_after_one_cycle)
        with pytest.raises(asyncio.CancelledError):
            asyncio.run(main.update_bus_loop())
    data = client.get("/api/buses").json()
    assert data["buses"] == [b.model_dump() for b in previous]
    assert "のりば2" in data["error"]


def test_successful_empty_bus_response_clears_previous_error(station_api, monkeypatch):
    client, _station = station_api
    monkeypatch.setattr(main, "latest_bus_data", [
        main.BusInfo(route_id="22", destination="京阪香里園", status="接近中", arrival_time="17:30"),
    ])
    monkeypatch.setattr(main, "latest_bus_error", "前回のエラー")

    async def fetch(_name, _stop):
        return SimpleNamespace(body=SimpleNamespace(busstates=[]))

    monkeypatch.setattr(main, "get_khbus_info", fetch)
    with monkeypatch.context() as loop_patch:
        loop_patch.setattr(main.asyncio, "sleep", _stop_after_one_cycle)
        with pytest.raises(asyncio.CancelledError):
            asyncio.run(main.update_bus_loop())
    assert client.get("/api/buses").json() == {"buses": [], "error": None}
