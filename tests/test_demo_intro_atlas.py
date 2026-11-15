import json

from fastapi import FastAPI
from fastapi.testclient import TestClient

import demo


def client():
    app = FastAPI()
    app.include_router(demo.router)
    return TestClient(app)


def test_atlas_intro_has_its_own_page_player_and_map():
    with client() as c:
        page = c.get('/demo/startup-intro-atlas')
        assert page.status_code == 200 and 'atlas-intro' in page.text and 'OpenStreetMap' in page.text
        assert 'atlas-intro' in c.get('/demo/startup-intro-atlas/player.js').text
        assert 'tankyu-intro' in c.get('/demo/startup-intro/player.js').text
        data = c.get('/demo/startup-intro-atlas/map.json').json()
        assert data['school']['name'] == '同志社香里' and data['station']['name'] == '香里園'
        assert 'OpenStreetMap' in data['attribution'] and data['buildings'] and len(data['rail']['main']) > 20
        assert c.get('/demo/startup-intro/map.json').status_code == 404
        assert c.get('/demo/startup-intro-atlas/data').status_code == 404


def test_atlas_clock_shares_the_map_and_has_its_own_player():
    with client() as c:
        page = c.get('/demo/clock-atlas')
        assert page.status_code == 200 and 'atlas-clock' in page.text and 'OpenStreetMap' in page.text
        assert 'atlas-clock' in c.get('/demo/clock-atlas/player.js').text
        assert c.get('/demo/clock-atlas/map.json').json()['school']['name'] == '同志社香里'
        assert c.get('/demo/clock-atlas/data').status_code == 404


def test_atlas_map_stays_small_enough_to_draw():
    data = json.loads(demo.ATLAS_MAP_FILE.read_text())
    points = sum(len(b['p']) for b in data['buildings']) // 2
    assert points < 20000 and demo.ATLAS_MAP_FILE.stat().st_size < 600_000
