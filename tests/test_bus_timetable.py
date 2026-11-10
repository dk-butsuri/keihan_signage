import asyncio
import datetime
from types import SimpleNamespace

import httpx
import pytest

import bus_timetable


from keihan_tracker.bus.schemes import BusDiagram, BusDiagramStop


DGMPL = "同志社香里:1:1:75120:17:12"


def diagram(dgmpl=DGMPL, departure="17:12", destination="京阪香里園", arrival="17:31", estimated=False):
    return BusDiagram(dgmpl=dgmpl, stops=[
        BusDiagramStop(stop_name="寝屋川市駅［東口］〔京阪バス〕", departure_time="17:02"),
        BusDiagramStop(stop_name="同志社香里〔京阪バス〕", departure_time=departure, arrival_time=departure),
        BusDiagramStop(stop_name=destination+"〔京阪バス〕", arrival_time=arrival, arrival_is_estimated=estimated),
    ])


NOW = datetime.datetime(2026, 11, 7, 17, 12, tzinfo=datetime.timezone(datetime.timedelta(hours=9)))


@pytest.fixture(autouse=True)
def clear_cache():
    bus_timetable._cache.clear()
    yield
    bus_timetable._cache.clear()


def bus(dgmpl=DGMPL, destination="京阪香里園行"):
    return SimpleNamespace(dgmpl=dgmpl, busstateprms=SimpleNamespace(destination=destination))


@pytest.mark.parametrize("schedule,expected", [
    (diagram(), bus_timetable.TerminalArrival("17:31", False)),
    (diagram(destination="寝屋川市駅［東口］"), None),
    (diagram(departure="17:13"), None),
    (diagram(arrival=None), None),
    (diagram(estimated=True), bus_timetable.TerminalArrival("17:31", True)),
    (diagram(dgmpl="同志社香里:1:1:75120:25:12", departure="25:12", arrival="25:31"),
     bus_timetable.TerminalArrival("01:31", False)),
    (BusDiagram(dgmpl=DGMPL, stops=[]), None),
])
def test_terminal_requires_matching_boarding_stop_departure_and_destination(schedule, expected):
    assert bus_timetable._terminal_time(schedule, "同志社香里", "京阪香里園行") == expected


def test_same_trip_uses_library_api_and_reuses_schedule_until_next_day(monkeypatch):
    requests = []

    async def fetch(dgmpl):
        requests.append(dgmpl)
        return diagram(dgmpl=dgmpl)

    monkeypatch.setattr(bus_timetable, "fetch_diagram", fetch)
    for guid in ("first", "second"):
        sample = bus()
        sample.html = "HTML must be handled by keihan_tracker"
        sample.busstateprms.guid = guid
        assert asyncio.run(bus_timetable.terminal_times("同志社香里", [(1, sample)], NOW)) == [
            bus_timetable.TerminalArrival("17:31", False)]
    assert requests == [DGMPL]
    asyncio.run(bus_timetable.terminal_times("同志社香里", [(1, bus())], NOW + datetime.timedelta(days=1)))
    assert requests == [DGMPL, DGMPL]


def test_missing_dgmpl_skips_fetch_and_other_platform_has_own_trip(monkeypatch):
    requests = []
    down = "同志社香里:2:1:75129:17:19"

    async def fetch(dgmpl):
        requests.append(dgmpl)
        return diagram(dgmpl=dgmpl, departure="17:19", destination="寝屋川市駅［東口］")

    monkeypatch.setattr(bus_timetable, "fetch_diagram", fetch)
    samples = [(1, bus(None)), (2, bus(down, "寝屋川市駅行"))]
    assert asyncio.run(bus_timetable.terminal_times("同志社香里", samples, NOW)) == [
        None, bus_timetable.TerminalArrival("17:31", False)]
    assert requests == [down]


@pytest.mark.parametrize("error", [httpx.HTTPError("unavailable"), ValueError("invalid diagram"), TimeoutError()])
def test_failed_optional_timetable_is_cached_briefly_then_retried(monkeypatch, error):
    requests = []
    clock = [100.0]
    monkeypatch.setattr(bus_timetable.time, "monotonic", lambda: clock[0])

    async def fetch(dgmpl):
        requests.append(dgmpl)
        if len(requests) == 1:
            raise error
        return diagram()

    monkeypatch.setattr(bus_timetable, "fetch_diagram", fetch)
    for _ in range(2):
        assert asyncio.run(bus_timetable.terminal_times("同志社香里", [(1, bus())], NOW)) == [None]
    assert len(requests) == 1
    clock[0] += 301
    assert asyncio.run(bus_timetable.terminal_times("同志社香里", [(1, bus())], NOW)) == [
        bus_timetable.TerminalArrival("17:31", False)]


def test_bus_terminal_failure_keeps_stop_predictions_and_marks_schedule_only_times(monkeypatch):
    import main
    from fastapi.testclient import TestClient

    monkeypatch.setattr(main, "_cfg", {"buses": {"stop_name": "テスト停留所", "stop_numbers": [1, 2]},
                                      "intervals": {"bus_seconds": 60}})
    monkeypatch.setattr(main, "latest_bus_data", [])
    monkeypatch.setattr(main, "latest_bus_error", None)

    async def fetch(_name, platform):
        prms = SimpleNamespace(route="[22]", destination="京阪香里園行", status="約3分後に到着",
                               timetable="17:20 到着予定" if platform == 1 else "定刻 17:32")
        return SimpleNamespace(body=SimpleNamespace(busstates=[SimpleNamespace(busstateprms=prms)]))

    async def terminals(name, samples, now):
        assert name == "テスト停留所"
        assert [platform for platform, _ in samples] == [1, 2]
        return [bus_timetable.TerminalArrival("17:39", True), None]

    async def stop(_seconds):
        raise asyncio.CancelledError

    monkeypatch.setattr(main, "get_khbus_info", fetch)
    monkeypatch.setattr(main.bus_timetable, "terminal_times", terminals)
    with monkeypatch.context() as loop_patch:
        loop_patch.setattr(main.asyncio, "sleep", stop)
        with pytest.raises(asyncio.CancelledError):
            asyncio.run(main.update_bus_loop())
    client = TestClient(main.app)
    data = client.get("/api/buses").json()
    client.close()
    assert data["error"] is None
    first, second = data["buses"]
    assert first["arrival_time"] == "17:20 到着予定"
    assert first["terminal_arrival_time"] == "17:39"
    assert first["terminal_arrival_is_estimated"]
    assert first["stop_name"] == "テスト停留所"
    assert not first["stop_arrival_is_scheduled"]
    assert second["terminal_arrival_time"] is None and second["stop_arrival_is_scheduled"]
