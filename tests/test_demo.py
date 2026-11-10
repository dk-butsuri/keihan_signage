import asyncio
import gzip
import json

import pytest
from fastapi.testclient import TestClient

import demo
import main
from tools.build_demo import ArchiveTracker


@pytest.fixture
def recording(tmp_path, monkeypatch):
    path = tmp_path / 'replay.json'
    payload = {'version': 1, 'recorded_date': '2026-10-30', 'frames': [{'ts': 1793349900}]}
    path.write_text(json.dumps(payload), encoding='utf-8')
    monkeypatch.setattr(demo, 'DATA_FILE', path)
    return payload


@pytest.mark.parametrize('url', ['/demo/power-outage', '/demo/power-outage/'])
def test_demo_works_without_live_configuration_or_state(url, recording, monkeypatch):
    config = {'features': {'trains': False}}
    monkeypatch.setattr(main, '_cfg', config)
    tracker = main.tracker
    state = vars(main._suspension).copy()
    client = TestClient(main.app)
    response = client.get(url)
    assert response.status_code == 200
    assert '"mode": "replay"' in response.text
    assert 'demo-controls' in response.text
    assert response.headers['cache-control'] == 'no-store'
    assert main._cfg is config
    assert main.tracker is tracker
    assert vars(main._suspension) == state
    assert client.head(url).status_code == 200
    assert client.get('/demo/data').json() == recording
    assert 'replay.frames' in client.get('/demo/player.js').text
    assert client.post('/demo').status_code == 405
    assert client.get('/demo/config.yml').status_code == 404
    client.close()


def test_missing_recording_is_explicit(tmp_path, monkeypatch):
    monkeypatch.setattr(demo, 'DATA_FILE', tmp_path / 'missing.json')
    client = TestClient(main.app)
    for path in ['/demo/power-outage', '/demo/power-outage/data', '/demo/data']:
        response = client.get(path)
        assert response.status_code == 503
        assert '記録がまだ用意されていません' in response.json()['detail']
    assert client.get('/demo').status_code == 200
    assert '記録を準備中' in client.get('/demo').text
    assert client.get('/demo/severe-weather').status_code == 200
    assert client.get('/demo/severe-weather/data').status_code == 200
    client.close()


def test_catalog_and_unknown_scenarios(recording):
    client = TestClient(main.app)
    for path in ['/demo', '/demo/']:
        response = client.get(path)
        assert response.status_code == 200
        assert 'デモを選ぶ' in response.text
        assert response.text.count('data-demo-id=') == 7
        assert '架空の想定' in response.text and '実記録' in response.text
    for path in ['/demo/missing', '/demo/missing/data', '/demo/missing/player.js', '/demo/config.yml']:
        assert client.get(path).status_code == 404
    assert client.get('/demo/power-outage/data').json() == recording
    client.close()


@pytest.mark.parametrize('path', ['/demo/startup-intro', '/demo/startup-intro/'])
def test_intro_needs_no_recording_or_live_state(path, monkeypatch, tmp_path):
    monkeypatch.setattr(demo, 'DATA_FILE', tmp_path / 'missing.json')
    config = {'features': {'trains': False}}
    monkeypatch.setattr(main, '_cfg', config)
    tracker, state = main.tracker, vars(main._suspension).copy()
    client = TestClient(main.app)
    page = client.get(path)
    assert page.status_code == 200 and 'tankyu-intro' in page.text
    assert page.headers['cache-control'] == 'no-store'
    assert 'data:font/woff2;base64,' in page.text
    assert client.head(path).status_code == 200
    assert client.get('/demo/startup-intro/player.js').status_code == 200
    assert client.head('/demo/startup-intro/player.js').status_code == 200
    assert client.get('/demo/startup-intro/assembly.js').status_code == 200
    assert client.get('/demo/normal/assembly.js').status_code == 404
    assert client.get('/demo/startup-intro/data').status_code == 404
    assert main._cfg is config and main.tracker is tracker and vars(main._suspension) == state
    client.close()


@pytest.mark.parametrize('path', ['/demo/display-patterns', '/demo/display-patterns/'])
def test_pattern_gallery_is_complete_and_independent_of_live_state(path, monkeypatch, tmp_path):
    monkeypatch.setattr(demo, 'DATA_FILE', tmp_path / 'missing.json')
    config = {'features': {'trains': False}}
    monkeypatch.setattr(main, '_cfg', config)
    tracker, state = main.tracker, vars(main._suspension).copy()
    client = TestClient(main.app)
    page = client.get(path)
    assert page.status_code == 200 and '列車カードの全表示パターン' in page.text
    assert page.headers['cache-control'] == 'no-store'
    payload = client.get('/demo/display-patterns/data').json()
    assert payload['mode'] == 'gallery'
    basic = [case for case in payload['cases'] if not case['extra']]
    assert len(basic) == 8
    assert {(case['predicted'], bool(case['train']['delay']), case['train']['stopped_minutes'] is not None)
            for case in basic} == {(predicted, delayed, stopped) for predicted in (True, False)
                                   for delayed in (True, False) for stopped in (True, False)}
    assert len({case['id'] for case in payload['cases']}) == len(payload['cases'])
    for case in payload['cases']:
        assert main.TrainInfo(**case['train'])
    assert {'over-two-hours', 'long-stop', 'unknown-time', 'without-secondary'} <= {case['id'] for case in payload['cases']}
    assert 'renderTrains' in client.get('/demo/display-patterns/player.js').text
    assert client.head(path).status_code == 200
    assert main._cfg is config and main.tracker is tracker and vars(main._suspension) == state
    client.close()


@pytest.mark.parametrize('scenario_id', ['normal', 'jr-loop', 'severe-weather', 'all-stopped'])
def test_static_scenarios_have_consistent_display_data_and_no_timeline(scenario_id, monkeypatch):
    monkeypatch.setattr(main, '_cfg', {'features': {'trains': False}})
    tracker, state = main.tracker, vars(main._suspension).copy()
    client = TestClient(main.app)
    response = client.get('/demo/' + scenario_id)
    assert response.status_code == 200 and '"mode": "static"' in response.text
    data = client.get('/demo/' + scenario_id + '/data').json()
    assert data['mode'] == 'static' and not {'frames', 'start', 'end'} & data.keys()
    assert main.StationResponse(**data['trains'])
    assert main.LineResponse(**data['line'])
    assert main.BusResponse(**data['buses'])
    assert main.DelayResponse(**data['delays'])
    assert len(data['delays']['groups']) == 4
    for direction in ('up', 'down'):
        incoming = sorted((train for train in data['line']['trains'] if train['direction'] == direction
            and (train['position'] < 18 if direction == 'up' else train['position'] > 18)),
            key=lambda train: abs(train['position'] - 18))
        for marker, train in zip(incoming, data['line']['directions'][direction]['next']):
            assert all(marker[key] == train[key] for key in ('kind', 'delay', 'stopped_minutes'))
    assert data['line']['stopped'] == sum(t['stopped_minutes'] is not None for t in data['line']['trains'])
    if scenario_id == 'normal':
        assert not data['line']['suspended'] and all(g['mark'] == '○' for g in data['delays']['groups'])
    elif scenario_id == 'jr-loop':
        assert not data['line']['suspended']
        assert len(data['delays']['groups'][2]['lines']) == 5
        assert all(g['mark'] == '○' for i,g in enumerate(data['delays']['groups']) if i != 2)
    else:
        assert data['line']['suspended']
        assert all(g['mark'] in ('△','×') and len(g['lines']) >= 5 for g in data['delays']['groups'])
        affected = [line for g in data['delays']['groups'] for line in g['lines']]
        assert len(affected) >= 30
        if scenario_id == 'all-stopped':
            assert data['line']['stopped'] == data['line']['total']
            assert all(d['state'] == 'stopped' for d in data['line']['directions'].values())
        else:
            assert 0 < data['line']['stopped'] < data['line']['total']
    assert main.tracker is tracker and vars(main._suspension) == state
    assert client.get('/demo/' + scenario_id + '/data').json() == data
    assert client.head('/demo/' + scenario_id + '/data').status_code == 200
    assert client.get('/demo/' + scenario_id + '/player.js').status_code == 200
    client.close()


def test_archive_uses_timetable_from_that_time_and_never_network(tmp_path):
    files = []
    for stamp in ['20261030160000', '20261030180000']:
        path = tmp_path / (stamp + '.gz')
        with gzip.open(path, 'wt', encoding='utf-8') as out:
            out.write(stamp)
        files.append((stamp, path))
    tracker = ArchiveTracker({'startTimeList': files})
    url = 'https://unused.invalid/startTimeList.json'
    tracker.at = '20261030170000'
    assert asyncio.run(tracker._get(url)) == '20261030160000'
    tracker.at = '20261030190000'
    assert asyncio.run(tracker._get_if_modified(url)) == '20261030180000'
    tracker.at = '20261030150000'
    with pytest.raises(ValueError, match='Missing archived'):
        asyncio.run(tracker._get(url))
    with pytest.raises(RuntimeError, match='cannot access the network'):
        asyncio.run(tracker._request(url, {}))
