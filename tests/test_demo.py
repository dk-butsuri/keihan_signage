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
        assert response.text.count('data-demo-id=') == len(demo.SCENARIOS)
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
    assert client.head(path).status_code == 200
    assert client.get('/demo/startup-intro/player.js').status_code == 200
    assert client.head('/demo/startup-intro/player.js').status_code == 200
    assert client.get('/demo/startup-intro/assembly.js').status_code == 200
    assert client.get('/demo/normal/assembly.js').status_code == 404
    assert client.get('/demo/startup-intro/data').status_code == 404
    assert main._cfg is config and main.tracker is tracker and vars(main._suspension) == state
    client.close()


@pytest.mark.parametrize('path', ['/demo/hourly-honsen', '/demo/hourly-honsen/'])
def test_honsen_chime_demo_needs_no_recording_or_live_state(path, monkeypatch, tmp_path):
    monkeypatch.setattr(demo, 'DATA_FILE', tmp_path / 'missing.json')
    config = {'features': {'trains': False}}
    monkeypatch.setattr(main, '_cfg', config)
    tracker, state = main.tracker, vars(main._suspension).copy()
    client = TestClient(main.app)
    page = client.get(path)
    assert page.status_code == 200 and 'chime-demo' in page.text
    assert page.headers['cache-control'] == 'no-store'
    assert client.head(path).status_code == 200
    player = client.get('/demo/hourly-honsen/player.js')
    assert player.status_code == 200 and '.chime-seconds' in player.text
    assert client.get('/demo/hourly-honsen/data').status_code == 404
    assert client.get('/demo/hourly-honsen/assembly.js').status_code == 404
    assert 'hourly-honsen' in client.get('/demo').text
    client.close()
    assert main._cfg is config and main.tracker is tracker and vars(main._suspension) == state


def test_hourly_chime_scripts_are_served_to_the_screen():
    client = TestClient(main.app)
    chime = client.get('/assets/chime.js')
    assert chime.status_code == 200 and 'startHourlyChime' in chime.text
    assert chime.headers['content-type'].startswith('text/javascript')
    assert 'createChime' in client.get('/assets/chime-core.js').text
    assert 'createChime' in client.get('/demo/hourly-honsen/chime-core.js').text
    assert client.get('/demo/normal/chime-core.js').status_code == 404
    assert client.get('/assets/demo-chime.js').status_code == 404
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


@pytest.mark.parametrize('scenario_id', ['normal', 'bus-delay', 'jr-loop', 'severe-weather', 'all-stopped'])
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
    assert len(data['delays']['groups']) == 6
    for direction in ('up', 'down'):
        incoming = sorted((train for train in data['line']['trains'] if train['direction'] == direction
            and (train['position'] < 18 if direction == 'up' else train['position'] > 18)),
            key=lambda train: abs(train['position'] - 18))
        for marker, train in zip(incoming, data['line']['directions'][direction]['next']):
            assert all(marker[key] == train[key] for key in ('kind', 'delay', 'stopped_minutes'))
    assert data['line']['stopped'] == sum(t['stopped_minutes'] is not None for t in data['line']['trains'])
    if scenario_id in ('normal', 'bus-delay'):
        assert not data['line']['suspended'] and all(g['mark'] == '○' for g in data['delays']['groups'])
    elif scenario_id == 'jr-loop':
        assert not data['line']['suspended']
        assert len(data['delays']['groups'][2]['lines']) == 5
        assert all(g['mark'] == '○' for i,g in enumerate(data['delays']['groups']) if i != 2)
    else:
        assert data['line']['suspended']
        assert all(g['mark'] in ('△','×') and len(g['lines']) >= (2 if g['name'] == '大阪モノレール' else 5) for g in data['delays']['groups'])
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


def test_weather_demo_uses_the_live_rules_without_live_state(monkeypatch):
    monkeypatch.setattr(main, '_cfg', {'features': {'trains': False}})
    monkeypatch.setattr(main, '_weather', None)
    client = TestClient(main.app)
    page = client.get('/demo/weather-cards/')
    assert page.status_code == 200 and 'data-weather="items"' in page.text and '.wx-chip' in page.text
    assert 'renderWeather' in client.get('/demo/weather-cards/weather.js').text
    assert 'PRESETS' in client.get('/demo/weather-cards/player.js').text
    state = {
        'hour': 12,
        'warnings': [{'element': 'storm', 'stage': 'warning', 'cities': ['寝屋川市', '枚方市']},
                     {'element': 'wave', 'stage': 'warning', 'cities': ['寝屋川市']}],
        'series': [{'element': 'rain', 'cities': ['寝屋川市'], 'snow': False, 'blocks': [{'hour': 18, 'stage': 'warning'}]},
                   {'element': 'snow', 'cities': ['寝屋川市'], 'snow': False, 'blocks': [{'hour': 30, 'stage': 'warning'}]}],
        'possibility': [{'element': 'storm', 'period': 'tomorrow', 'value': 'high'},
                        {'element': 'snow', 'period': 'tomorrow', 'value': 'medium'}],
    }
    data = client.get('/demo/weather-cards/weather', params={'state': json.dumps(state)}).json()
    assert [(w['name'], w['cities']) for w in data['warnings']] == [('暴風警報', ['寝屋川市', '枚方市'])]
    assert data['previews'] == [{'kind': 'soon', 'when': '18時ごろから', 'name': '大雨警報', 'cities': ['寝屋川市']}]
    assert client.get('/demo/weather-cards/weather', params={'state': '{"warnings":[{"element":"x"}]}'}).status_code == 400
    assert client.get('/demo/normal/weather').status_code == 404
    assert client.get('/demo/weather-cards/data').status_code == 404


def test_bus_delay_demo_preserves_unknown_and_arrived_states():
    client = TestClient(main.app)
    response = client.get('/demo/bus-delay/data')
    client.close()
    assert response.status_code == 200
    buses = response.json()['buses']['buses']
    assert [bus['delay_minutes'] for bus in buses] == [0, 5, 75, None, None, None]
    assert buses[1]['scheduled_time'] == '15:03'
    assert buses[1]['arrival_time'] == '15:08 到着予定'
    assert buses[1]['terminal_arrival_time'] == '15:15'
    assert buses[3]['delay_text'] is None and buses[3]['stop_arrival_is_scheduled']
    assert buses[4]['delay_text'] == '到着済'
    assert buses[3]['status'] == '約24分後に到着'
    assert buses[5]['status'] == 'まもなく到着'


def test_signage_clock_serves_atlas_clock_without_demo_chrome():
    from fastapi.testclient import TestClient
    from fastapi import FastAPI
    import demo
    app = FastAPI(); app.include_router(demo.router)
    client = TestClient(app)
    page = client.get('/clock/')
    assert page.status_code == 200
    assert 'id="atlas-clock"' in page.text and 'clock-demo' not in page.text and 'デモ一覧' not in page.text
    for name in ('player.js', 'weather.js', 'map.json'):
        assert client.get(f'/clock/{name}').status_code == 200
    assert client.get('/clock/main.py').status_code == 404
    # デモの時計はそのまま
    demo_page = client.get('/demo/clock-atlas')
    assert demo_page.status_code == 200 and 'デモ一覧' in demo_page.text


def test_signage_boards_serve_atlas_with_departures():
    from fastapi.testclient import TestClient
    from fastapi import FastAPI
    import demo
    app = FastAPI(); app.include_router(demo.router)
    client = TestClient(app)
    for kind, name in (('bus', '同志社香里'), ('train', '香里園')):
        page = client.get(f'/board/{kind}/')
        assert page.status_code == 200
        assert f'data-board="{kind}"' in page.text and name in page.text and 'デモ一覧' not in page.text
        # サイネージでは実際の情報を出す
        assert '<option value="live" selected>' in page.text
        for file in ('player.js', 'weather.js', 'map.json'):
            assert client.get(f'/board/{kind}/{file}').status_code == 200
        assert client.get(f'/board/{kind}/main.py').status_code == 404
        demo_page = client.get(f'/demo/{kind}-atlas')
        assert demo_page.status_code == 200 and 'デモ一覧' in demo_page.text and '<option value="normal" selected>' in demo_page.text
    assert client.get('/board/clock/').status_code == 404
    # 時計の画面には発車案内を出さない
    assert 'data-board' not in client.get('/clock/').text


def test_catalog_cards_have_thumbnails_and_short_summaries():
    client = TestClient(main.app)
    page = client.get('/demo').text
    for scenario in demo.SCENARIOS:
        # 一覧は1行の要約だけ。長い説明は各デモのページに出す
        assert scenario['summary'] in page and len(scenario['summary']) <= 30
        response = client.get(f"/demo/{scenario['id']}/thumb.jpg")
        assert response.status_code == 200 and response.headers['content-type'] == 'image/jpeg'
    assert client.get('/demo/missing/thumb.jpg').status_code == 404
    client.close()
