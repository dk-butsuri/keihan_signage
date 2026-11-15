from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from keihan_tracker import ActiveTrainData

import main


def _wire(train, station):
    """Mock の列車に、estimate_arrival が読む属性を持たせる。値はテストが置いた upcoming_trains と tracker から決める。"""
    stop = next(s for t, s in station.upcoming_trains if t is train)
    train.has_dia = True
    train.get_stop.return_value = stop
    if not isinstance(train, ActiveTrainData):
        return
    train.master = SimpleNamespace(active_trains=main.tracker.active_trains)
    stops = train.stop_stations if isinstance(train.stop_stations, list) else []
    if not any(s.station is station for s in stops):
        train.stop_stations = [*stops, SimpleNamespace(station=station, time=stop.time, is_stop=True)]
    if train.current_or_next_stop is None:
        train.current_or_next_stop = station


@pytest.fixture(autouse=True)
def eta_on_mock_trains(monkeypatch):
    real = main.estimate_arrival

    def wired(train, station, **kwargs):
        if isinstance(train, Mock):
            _wire(train, station)
        return real(train, station, **kwargs)

    monkeypatch.setattr(main, "estimate_arrival", wired)
