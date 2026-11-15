import asyncio
from types import SimpleNamespace

import pytest

import main


class FakeTracker:
    rate_limit_interval = 30

    def __init__(self, *runs):
        self.runs = list(runs)
        self.intervals = []
        self.position_created_at = None

    async def watch(self, interval, *, on_error):
        assert on_error == "continue"
        self.intervals.append(interval)
        run = self.runs.pop(0)
        if isinstance(run, Exception):
            raise run
        for _ in range(run):
            yield None


@pytest.fixture
def loop_env(monkeypatch):
    seconds = {"value": 60}
    cfg = lambda: {"intervals": {"train_seconds": seconds["value"]}, "trains": {}}
    monkeypatch.setattr(main, "_cfg", cfg())
    monkeypatch.setattr(main, "_load_config_file", lambda: cfg())
    monkeypatch.setattr(main, "_last_pos_success", None)
    monkeypatch.setattr(main, "_first_position_time", None)
    updates = []
    monkeypatch.setattr(main, "_update_suspension", lambda now: updates.append(now))

    async def stop(_seconds):
        raise asyncio.CancelledError

    monkeypatch.setattr(main.asyncio, "sleep", stop)
    return seconds, updates


def run_loop():
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(main.update_train_loop())


def test_each_fetch_records_success_and_updates_suspension(monkeypatch, loop_env):
    _, updates = loop_env
    monkeypatch.setattr(main, "tracker", FakeTracker(2, RuntimeError("stop")))
    run_loop()
    assert len(updates) == 2
    assert main._last_pos_success is not None


def test_interval_never_goes_below_the_library_rate_limit(monkeypatch, loop_env):
    seconds, _ = loop_env
    seconds["value"] = 10
    main._cfg["intervals"]["train_seconds"] = 10
    tracker = FakeTracker(RuntimeError("stop"))
    monkeypatch.setattr(main, "tracker", tracker)
    run_loop()
    assert tracker.intervals == [30]


def test_watch_restarts_with_new_interval_when_config_changes(monkeypatch, loop_env):
    seconds, updates = loop_env
    seconds["value"] = 90
    tracker = FakeTracker(5, RuntimeError("stop"))
    monkeypatch.setattr(main, "tracker", tracker)
    run_loop()
    assert tracker.intervals == [60, 90]
    assert len(updates) == 1


def test_unexpected_error_ends_watch_but_loop_keeps_going(monkeypatch, loop_env):
    tracker = FakeTracker(ValueError("broken"))
    monkeypatch.setattr(main, "tracker", tracker)
    run_loop()  # 例外の後は待ってから、watch を作り直す（待つところで止める）
    assert tracker.intervals == [60]
