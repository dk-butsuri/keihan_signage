import datetime
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from keihan_tracker import ActiveTrainData, TrainData
from keihan_tracker.keihan_train.schemes import TrainType

import main

NOW = datetime.datetime(2026, 11, 6, 12, tzinfo=main.JST)


@pytest.fixture(autouse=True)
def config(monkeypatch):
    monkeypatch.setattr(main, '_cfg', {'trains': {
        'station_id': 18, 'sub_station_id': 17, 'min_minutes_until': 30,
        'max_trains_per_direction': 6, 'map_from_station': 4, 'map_to_station': 24,
    }})


@pytest.mark.parametrize('col,row,expected', [
    (2, 70, 19), (2, 71, 19 - 1/3), (2, 72, 19 - 2/3),
    (1, 65, 21), (1, 118, None), (2, 132, None), (2, 154, None),
    (1, 2, 42), (1, 116, 4), (1, 0, None), (0, 70, None),
])
def test_line_position(col, row, expected):
    actual = main._line_position(col, row)
    assert actual is None if expected is None else actual == pytest.approx(expected)


def test_enter_and_five_minute_recovery():
    state = main.SuspensionState()
    assert not state.update(0.3, False, False, NOW)
    assert state.update(0.3, False, False, NOW + datetime.timedelta(minutes=1))
    assert state.update(0.1, False, False, NOW + datetime.timedelta(minutes=2))
    assert state.update(0.1, False, False, NOW + datetime.timedelta(minutes=6))
    assert not state.update(0.1, False, False, NOW + datetime.timedelta(minutes=7))


def test_official_suspension_prevents_recovery():
    state = main.SuspensionState()
    assert state.update(0, True, False, NOW)
    assert state.update(0, True, False, NOW + datetime.timedelta(minutes=10))
    assert state.update(0, False, False, NOW + datetime.timedelta(minutes=11))
    assert not state.update(0, False, False, NOW + datetime.timedelta(minutes=16))


@pytest.mark.parametrize('suspended', [False, True])
@pytest.mark.parametrize('ratio,official,stale', [(None, False, False), (None, True, False), (0.8, False, True), (0, True, True)])
def test_unknown_data_preserves_state(suspended, ratio, official, stale):
    state = main.SuspensionState()
    state.suspended = suspended
    assert state.update(ratio, official, stale, NOW) is suspended


def test_interrupted_samples_reset_consecutive_periods():
    state = main.SuspensionState()
    assert not state.update(.3, False, False, NOW)
    assert not state.update(.1, False, False, NOW)
    assert not state.update(.3, False, False, NOW)
    assert state.update(.3, False, False, NOW)
    assert state.update(.1, False, False, NOW)
    assert state.update(.15, False, False, NOW + datetime.timedelta(minutes=4))
    assert state.update(.1, False, False, NOW + datetime.timedelta(minutes=5))
    assert state.update(None, False, False, NOW + datetime.timedelta(minutes=9))
    assert state.update(.1, False, False, NOW + datetime.timedelta(minutes=10))
    assert state.update(.1, False, False, NOW + datetime.timedelta(minutes=14))
    assert not state.update(.1, False, False, NOW + datetime.timedelta(minutes=15))


@pytest.mark.parametrize('stays,delay,expected', [
    ([], None, 'none'), ([12, 3], 0, 'many_stopped'), ([12, 3, 1], 6, 'delayed'),
    ([10, 12, 1], 0, 'many_stopped'), ([10, 12, 1], 6, 'many_stopped'),
    ([10, 12], 0, 'stopped'), ([12, 9.9], 0, 'many_stopped'),
    ([0, 0], 0, 'normal'), ([9.9], 0, 'normal'), ([10], 6, 'stopped'),
])
def test_direction_state(stays, delay, expected):
    assert main._direction_state(stays, delay, 10) == expected


def station(number, name):
    return SimpleNamespace(station_number=number, station_name=SimpleNamespace(ja=name), upcoming_trains=[])


def stop(station, time, is_stop=True):
    return SimpleNamespace(station=station, time=time, is_stop=is_stop)


@pytest.mark.parametrize('reverse', [False, True])
def test_sub_station_delayed_time_and_order(reverse):
    sub, here = station(17, '寝屋川市'), station(18, '香里園')
    stops = [stop(sub, NOW.replace(hour=23, minute=58)), stop(here, NOW)]
    if reverse:
        stops.reverse()
    train = SimpleNamespace(stop_stations=stops, delay_minutes=5)
    assert main._sub_station_fields(train, here) == {
        'sub_station_name': '寝屋川市', 'sub_station_time': '00:03', 'sub_station_verb': '着',
    }
    stops[0].is_stop = False
    assert main._sub_station_fields(train, here) == {}


def active(row, direction='up', delay=0, staying=0, at_start=False):
    train = Mock(spec=ActiveTrainData)
    train.location_col, train.location_row = 2, row
    train.line = '京阪本線・鴨東線'
    train.direction, train.delay_minutes = direction, delay
    train.estimated_delay_minutes = delay
    train.staying_time = datetime.timedelta(minutes=staying)
    train.is_at_start_station = at_start
    train.is_delay_growing.return_value = False
    train.position_since = NOW
    train.train_type = TrainType.LOCAL
    train.destination = None
    train.is_stopping = False
    train.next_stop_station = None
    train.train_number = str(row)
    train.cars, train.train_formation, train.has_premiumcar = 7, None, False
    train.stop_stations = []
    return train


@pytest.mark.parametrize('seconds,delay,at_station,visible', [
    (899, 0, False, False), (900, 0, False, True), (901, 0, False, True),
    (0, 120, False, True), (0, 0, True, False),
])
def test_minimum_arrival_keeps_unknown_and_excludes_current_station(monkeypatch, seconds, delay, at_station, visible):
    class Clock(datetime.datetime):
        @classmethod
        def now(cls, tz=None):
            return NOW

    monkeypatch.setattr(datetime, 'datetime', Clock)
    here, previous = station(18, '香里園'), station(19, '光善寺')
    train = active(70, direction='down', delay=delay)
    train.next_station = here if at_station else previous
    train.next_stop_station = here if at_station else previous
    train.is_stopping = at_station
    arrival = NOW + datetime.timedelta(seconds=seconds, minutes=-delay)
    train.stop_stations = [stop(previous, arrival - datetime.timedelta(minutes=3)), stop(here, arrival)]
    here.upcoming_trains = [(train, stop(here, arrival))]
    monkeypatch.setattr(main, 'tracker', SimpleNamespace(stations={18: here, 19: previous}, active_trains={}))
    assert bool(main._ordered_trains(here, 15, 6)[1]) is visible
    assert len(main._ordered_trains(here, 0, 2)[1]) == 1


def test_line_api_counts_next_and_stale(monkeypatch):
    now = datetime.datetime.now(main.JST)
    stations = {n: station(n, str(n)) for n in range(1, 43)}
    here, sub = stations[18], stations[17]
    stations[18].station_name.ja = '香里園'
    stations[17].station_name.ja = '寝屋川市'
    a = active(75, delay=8, staying=16)  # 17と18の間、京都方面
    a.next_station = here
    a.stop_stations = [stop(sub, now), stop(here, now + datetime.timedelta(minutes=5))]
    b = active(70, 'down', delay=6, staying=1)
    b.next_station = stations[19]
    b.stop_stations = [stop(stations[19], now), stop(here, now + datetime.timedelta(minutes=8))]
    kyoto = active(40, staying=18)
    excluded = active(118)
    branch = active(154)
    branch.line = '交野線'
    scheduled = Mock(spec=TrainData)
    scheduled.delay_minutes, scheduled.direction = 0, 'up'
    scheduled.destination, scheduled.train_type = None, TrainType.LOCAL
    scheduled.stop_stations = []
    here.upcoming_trains = [(scheduled, stop(here, now + datetime.timedelta(minutes=20))),
                            (b, stop(here, now + datetime.timedelta(minutes=8))),
                            (a, stop(here, now + datetime.timedelta(minutes=5)))]
    monkeypatch.setattr(main, 'tracker', SimpleNamespace(
        stations=stations, active_trains={i: t for i, t in enumerate([a, b, kyoto, excluded, branch])},
        position_created_at=now))
    monkeypatch.setattr(main, '_last_pos_success', now)
    monkeypatch.setattr(main, '_first_position_time', NOW)
    monkeypatch.setattr(main, '_suspension', main.SuspensionState())
    monkeypatch.setattr(main, 'latest_delay_data', [])
    main._update_suspension(now)
    assert main._suspension.suspended is False
    main._update_suspension(now + datetime.timedelta(seconds=60))
    assert main._suspension.suspended is True
    main._suspension.suspended = False
    main._cfg['trains']['force_suspended'] = True
    client = TestClient(main.app)
    data = client.get('/api/line').json()
    assert data['error'] is None
    assert data['suspended'] is True
    assert data['total'] == 4 and data['stopped'] == 2
    assert len(data['trains']) == 2
    assert data['trains'][0]['stopped_minutes'] == 16
    assert data['trains'][0]['stopped_lower_bound'] is True
    assert data['outside']['up_kyoto'] == 1
    assert data['outside']['up_osaka'] == 0
    assert data['outside_stopped']['up_kyoto'] == 1
    assert data['directions']['up']['state'] == 'stopped'
    assert data['directions']['down']['state'] == 'delayed'
    upcoming = data['directions']['up']['next']
    assert len(upcoming) == 2
    assert upcoming[0]['position_text'] == '寝屋川市 → 香里園 の間'
    assert upcoming[0]['stopped_minutes'] == 16
    assert upcoming[1]['position_text'] is None
    assert upcoming[1]['time'] == (now + datetime.timedelta(minutes=20)).strftime('%H:%M')
    assert upcoming[1]['minutes_remaining'] is None
    assert upcoming[1]['estimate_unreliable']
    assert upcoming[1]['stopped_minutes'] is None
    assert data['compress_ranges'] == []
    main._cfg['trains']['map_compress_ranges'] = [[5, 10], [14, 15]]
    assert client.get('/api/line').json()['compress_ranges'] == [[5, 10], [14, 15]]
    main._cfg['trains']['map_compress_ranges'] = [[10, 5], [14, 15]]
    assert client.get('/api/line').json()['compress_ranges'] == [[14, 15]]
    main._cfg['trains'].pop('map_compress_ranges')
    main._cfg['trains'].update({'map_compress_from': 5, 'map_compress_to': 10})
    assert client.get('/api/line').json()['compress_ranges'] == [[5, 10]]
    assert client.get('/api/trains').json()['down_trains'] == []  # 30分の閾値は /api/line には適用しない
    b.delay_minutes = 120  # 見込み不能でも滞在1分なら停止には数えない
    stopped_short = client.get('/api/line').json()
    down = next(t for t in stopped_short['trains'] if t['direction'] == 'down')
    assert down['stopped_minutes'] is None
    assert stopped_short['stopped'] == 2
    monkeypatch.setattr(main, '_last_pos_success', now - datetime.timedelta(minutes=10))
    stale = client.get('/api/line').json()
    assert stale['error'] and stale['trains'] == []
    client.close()


@pytest.mark.parametrize('is_stop,unreliable,suffix', [(True, False, 'に停車中'), (False, False, 'を通過中'), (False, True, 'で停止')])
def test_position_text_at_station(monkeypatch, is_stop, unreliable, suffix):
    here = station(19, '光善寺')
    monkeypatch.setattr(main, 'tracker', SimpleNamespace(stations={19: here}))
    train = active(70)
    train.stop_stations = [stop(here, NOW, is_stop)]
    assert main._line_train_fields(train, unreliable)['position_text'] == '光善寺' + suffix


@pytest.mark.parametrize('delay,staying,at_start,expected', [
    (120, 4, False, None),
    (120, 5, False, 5),
    (120, 16, False, 16),
    (0, 10, False, None),
    (120, 10, True, None),
])
def test_stopped_minutes_threshold(delay, staying, at_start, expected):
    train = active(70, delay=delay, staying=staying, at_start=at_start)
    assert main._stopped_minutes(train) == expected


def test_stopped_minutes_threshold_config(monkeypatch):
    monkeypatch.setitem(main._cfg['trains'], 'stopped_minutes_threshold', 10)
    assert main._stopped_minutes(active(70, delay=120, staying=9)) is None
    assert main._stopped_minutes(active(70, delay=120, staying=10)) == 10


def test_line_train_fields_stopped_minutes_threshold(monkeypatch):
    here = station(19, '光善寺')
    monkeypatch.setattr(main, 'tracker', SimpleNamespace(stations={19: here}))
    short = active(70, delay=120, staying=1)
    short.stop_stations = [stop(here, NOW, True)]
    assert main._line_train_fields(short, True)['stopped_minutes'] is None
    long = active(70, delay=120, staying=16)
    long.stop_stations = [stop(here, NOW, True)]
    assert main._line_train_fields(long, True)['stopped_minutes'] == 16


@pytest.mark.parametrize('estimate,expected', [(150, '遅れ150分以上'), (120, '遅れ2時間以上')])
def test_lower_bound_preserves_official_delay_and_hides_arrival_forecast(monkeypatch, estimate, expected):
    now = datetime.datetime.now(main.JST)
    here, previous = station(18, '香里園'), station(17, '寝屋川市')
    train = active(75, delay=120)
    train.next_station = here
    train.next_stop_station = here
    train.estimated_delay_minutes = estimate
    train.stop_stations = [stop(previous, now), stop(here, now + datetime.timedelta(minutes=1))]
    here.upcoming_trains = [(train, train.stop_stations[-1])]
    monkeypatch.setattr(main, 'tracker', SimpleNamespace(
        stations={17: previous, 18: here}, active_trains={1: train}, position_created_at=now))
    monkeypatch.setattr(main, '_last_pos_success', now)
    main._cfg['trains']['map_from_station'] = 17
    main._cfg['trains']['map_to_station'] = 18
    client = TestClient(main.app)
    row = client.get('/api/trains').json()['up_trains'][0]
    assert row['delay'] == 120 and row['estimated_delay_minutes'] == estimate
    assert row['status'] == expected
    assert row['minutes_remaining'] is None and row['estimate_unreliable']
    line = client.get('/api/line').json()
    assert line['trains'][0]['delay'] == 120
    assert line['trains'][0]['estimated_delay_minutes'] == estimate
    assert line['directions']['up']['next'][0]['status'] == expected
    client.close()


def test_unavailable_lower_bound_falls_back_to_official_value(monkeypatch):
    from unittest.mock import PropertyMock
    train = active(75, delay=120)
    train.next_stop_station = station(18, '香里園')
    monkeypatch.setattr(type(train), 'estimated_delay_minutes', PropertyMock(side_effect=ValueError('missing schedule')), raising=False)
    assert main._estimated_delay_minutes(train) is None
    assert train.delay_minutes == 120
