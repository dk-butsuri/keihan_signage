import asyncio
import datetime
from types import SimpleNamespace
from unittest.mock import Mock

import httpx
import pytest
from fastapi.testclient import TestClient
from keihan_tracker import ActiveTrainData, KeihanAPIError, TrainData
from keihan_tracker.keihan_train.schemes import TrainType

import main


@pytest.fixture
def station_api(monkeypatch):
    monkeypatch.setattr(main, "_cfg", {
        "trains": {
            "station_id": 18, "min_minutes_until": 0,
            "max_trains_per_direction": 6,
        },
        "buses": {"stop_name": "テスト停留所", "stop_numbers": [1, 2]},
        "intervals": {"bus_seconds": 60},
    })
    station = SimpleNamespace(station_name=SimpleNamespace(ja="香里園"), upcoming_trains=[])
    monkeypatch.setattr(main, "tracker", SimpleNamespace(
        stations={18: station}, position_created_at=datetime.datetime.now(main.JST), active_trains={}))
    monkeypatch.setattr(main, "_last_pos_success", datetime.datetime.now(main.JST))
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
    train.is_delay_growing.return_value = False
    train.staying_time = datetime.timedelta(0)
    train.is_at_start_station = False
    station.upcoming_trains = [(
        train, SimpleNamespace(time=datetime.datetime.now(main.JST) + datetime.timedelta(minutes=20)),
    )]

    response = client.get("/api/trains")
    assert response.status_code == 200
    data = response.json()
    assert data["error"] is None
    row = data["up_trains"][0]
    assert row["destination"] == "不明"
    assert row["is_this_station"] is (stopping is True)
    assert row["status"] == ("当駅停車中" if stopping is True else "")


@pytest.mark.parametrize("stopping", [True, False])
def test_overdue_train_kept_only_while_stopping_here(station_api, stopping):
    client, station = station_api
    train = Mock(spec=ActiveTrainData)
    train.train_type = TrainType.LOCAL
    train.destination = None
    train.delay_minutes = 0
    train.direction = "down"
    train.is_stopping = stopping
    train.next_station = station
    train.next_stop_station = station
    train.train_number = "1503"
    train.cars = 7
    train.train_formation = None
    train.location_col = 1
    train.location_row = 73
    train.has_premiumcar = None
    train.line = "京阪本線・鴨東線"
    train.is_delay_growing.return_value = False
    train.staying_time = datetime.timedelta(minutes=3)
    train.is_at_start_station = False
    station.upcoming_trains = [(
        train, SimpleNamespace(time=datetime.datetime.now(main.JST) - datetime.timedelta(minutes=2)),
    )]

    rows = client.get("/api/trains").json()["down_trains"]
    if stopping:
        assert rows[0]["status"] == "当駅停車中"
        assert rows[0]["is_this_station"] is True
    else:
        assert rows == []


def _active_train(delay, growing):
    train = Mock(spec=ActiveTrainData)
    train.train_type = TrainType.LOCAL
    train.destination = None
    train.delay_minutes = delay
    train.direction = "up"
    train.is_stopping = False
    train.next_station = None
    train.next_stop_station = None
    train.train_number = "0500"
    train.cars = 7
    train.train_formation = None
    train.location_col = 1
    train.location_row = 73
    train.has_premiumcar = None
    train.line = "京阪本線・鴨東線"
    train.is_delay_growing.return_value = growing
    train.staying_time = datetime.timedelta(0)
    train.is_at_start_station = False
    return train


def _scheduled_train():
    train = Mock(spec=TrainData)
    train.train_type = TrainType.LOCAL
    train.destination = None
    train.delay_minutes = 0
    train.direction = "up"
    return train


@pytest.mark.parametrize("seconds,delay,visible", [
    (1500, 60, True), (1501, 60, False), (1500, 61, False),
    (600, 61, False), (600, 119, False), (600, 120, False),
    (1500, 0, True), (1501, 0, True),
    (1501, 10, True), (1501, 11, False),
    (3600, 0, True), (3600, 10, True), (3601, 10, False), (3600, 11, False),
    (3601, 0, True), (6000, 0, True), (3601, 1, False),  # 遅れていない列車は残り時間によらず出す
])
def test_arrival_estimate_window(station_api, monkeypatch, seconds, delay, visible):
    client, station = station_api
    now = datetime.datetime(2026, 11, 10, 12, tzinfo=main.JST)

    class Clock(datetime.datetime):
        @classmethod
        def now(cls, tz=None):
            return now

    monkeypatch.setattr(datetime, "datetime", Clock)
    monkeypatch.setattr(main, "_last_pos_success", now)
    main.tracker.position_created_at = now
    train = _active_train(delay, False)
    departure = now + datetime.timedelta(seconds=seconds, minutes=-delay)
    station.upcoming_trains = [(train, SimpleNamespace(time=departure))]

    row, = client.get("/api/trains").json()["up_trains"]
    assert row["time"] == departure.strftime("%H:%M")
    assert row["delay"] == delay
    assert row["estimate_unreliable"] is not visible
    shift = round(min(delay, seconds / 600)) if delay <= 10 else 0
    estimated = departure + datetime.timedelta(minutes=delay - shift)
    assert row["minutes_remaining"] == (int((estimated - now).total_seconds() / 60) if visible else None)
    assert row["estimated_time"] == (estimated.strftime("%H:%M") if visible else None)
    assert main._is_unreliable(train) is (delay >= 120)


@pytest.mark.parametrize("remaining,delay", [(14, 0), (14, 91), (10, 119)])
def test_estimate_window_preserves_minimum_arrival(station_api, remaining, delay):
    client, station = station_api
    main._cfg["trains"]["min_minutes_until"] = 15
    departure = datetime.datetime.now(main.JST) + datetime.timedelta(minutes=remaining-delay)
    station.upcoming_trains = [(_active_train(delay, False), SimpleNamespace(time=departure))]
    assert client.get("/api/trains").json()["up_trains"] == []


@pytest.mark.parametrize(("delay", "growing", "unreliable"), [
    (15, False, False),
    (3, True, True),      # 遅れが少なくても、増え続けていれば見込みを出さない
    (120, False, True),   # 2時間以上
])
def test_estimate_hidden_while_delay_grows(station_api, delay, growing, unreliable):
    client, station = station_api
    now = datetime.datetime.now(main.JST)
    active = _active_train(delay, growing)
    station.upcoming_trains = [
        (active, SimpleNamespace(time=now + datetime.timedelta(minutes=5))),
        (_scheduled_train(), SimpleNamespace(time=now + datetime.timedelta(minutes=25))),
    ]

    leading, following = client.get("/api/trains").json()["up_trains"]
    if delay < 120:
        active.is_delay_growing.assert_called_once_with(ratio=0.7)
    assert leading["estimate_unreliable"] is unreliable
    assert leading["time"] == (now + datetime.timedelta(minutes=5)).strftime("%H:%M")
    assert following["time"] == (now + datetime.timedelta(minutes=25)).strftime("%H:%M")
    assert following["estimate_unreliable"] is unreliable
    if unreliable:
        assert leading["minutes_remaining"] is None
        assert following["minutes_remaining"] is None
    else:
        assert leading["minutes_remaining"] is not None
        assert following["minutes_remaining"] is not None
    assert leading["status"] == ("遅れ2時間以上" if delay >= 120 else f"遅れ約{delay}分")


def test_following_active_train_keeps_its_own_estimate(station_api):
    client, station = station_api
    now = datetime.datetime.now(main.JST)
    station.upcoming_trains = [
        (_active_train(3, True), SimpleNamespace(time=now + datetime.timedelta(minutes=20))),
        (_active_train(2, False), SimpleNamespace(time=now + datetime.timedelta(minutes=20))),
    ]

    leading, following = client.get("/api/trains").json()["up_trains"]
    assert leading["estimate_unreliable"]
    assert not following["estimate_unreliable"]
    assert following["time"] == (now + datetime.timedelta(minutes=20)).strftime("%H:%M")
    assert following["minutes_remaining"] is not None


@pytest.mark.parametrize(("at_start", "unreliable"), [(False, True), (True, False)])
def test_long_stay_hides_estimate_except_at_start_station(station_api, at_start, unreliable):
    client, station = station_api
    now = datetime.datetime.now(main.JST)
    active = _active_train(3, False)   # 起動直後で、遅れの増え方はまだ判定できない
    active.staying_time = datetime.timedelta(minutes=16)
    active.is_at_start_station = at_start
    station.upcoming_trains = [(active, SimpleNamespace(time=now + datetime.timedelta(minutes=20)))]

    (row,) = client.get("/api/trains").json()["up_trains"]
    assert row["estimate_unreliable"] is unreliable


@pytest.mark.parametrize(("case", "hidden"), [
    ("fetch_failing", True),     # 取得に失敗し続けている
    ("frozen", True),            # 取得はできるが、作成時刻が古いまま列車が走行中で残っている
    ("after_last_train", False), # 終電後: 作成時刻は進まないが、走行中の列車は無い
])
def test_stale_positions(station_api, monkeypatch, case, hidden):
    client, station = station_api
    now = datetime.datetime.now(main.JST)
    old = now - datetime.timedelta(minutes=20)
    main.tracker.position_created_at = old
    if case == "fetch_failing":
        monkeypatch.setattr(main, "_last_pos_success", old)
        main.tracker.active_trains = {1: object()}
    elif case == "frozen":
        main.tracker.active_trains = {1: object()}
    station.upcoming_trains = [
        (_active_train(0, False), SimpleNamespace(time=now + datetime.timedelta(minutes=20))),
    ]

    body = client.get("/api/trains").json()
    if hidden:
        assert body["up_trains"] == [] and "表示を止めています" in body["error"]
        assert old.strftime("%H:%M") in body["error"]
    else:
        assert len(body["up_trains"]) == 1 and body["error"] is None


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


@pytest.mark.parametrize(("direction", "row", "other_direction", "other_row", "growing", "staying", "delay", "blocked"), [
    ("up", 90, "up", 80, True, 0, 0, True),
    ("up", 90, "up", 73, True, 0, 0, True),        # 香里園に止まっている列車は前に数える
    ("up", 90, "up", 90, True, 0, 0, False),       # 同じ位置は前に数えない
    ("up", 90, "up", 70, True, 0, 0, False),       # 香里園を過ぎた列車
    ("up", 90, "up", 95, True, 0, 0, False),       # 後ろの列車
    ("up", 90, "down", 80, True, 0, 0, False),     # 反対方面
    ("up", 90, "up", 80, False, 16, 0, True),      # 15分より長くとどまっている
    ("up", 90, "up", 80, False, 15, 0, False),
    ("up", 90, "up", 80, False, 0, 120, False),    # 2時間以上の遅れだけでは前詰まりにしない
    ("down", 50, "down", 60, True, 0, 0, True),
    ("down", 50, "down", 40, True, 0, 0, False),
    ("down", 50, "down", 76, True, 0, 0, False),
])
def test_blocked_by_train_ahead(station_api, direction, row, other_direction, other_row, growing, staying, delay, blocked):
    client, station = station_api
    now = datetime.datetime.now(main.JST)
    train = _active_train(3, False)
    train.direction = direction
    train.location_row = row
    other = _active_train(delay, growing)
    other.direction = other_direction
    other.location_row = other_row
    other.staying_time = datetime.timedelta(minutes=staying)
    main.tracker.active_trains = {1: train, 2: other}
    station.upcoming_trains = [(train, SimpleNamespace(time=now + datetime.timedelta(minutes=20)))]

    row_data, = client.get("/api/trains").json()[f"{direction}_trains"]
    assert row_data["estimate_unreliable"] is blocked
    assert (row_data["minutes_remaining"] is None) is blocked
