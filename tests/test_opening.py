import pytest
from fastapi.testclient import TestClient

import main


@pytest.mark.parametrize('name', ['assembly.js', 'opening.js'])
def test_opening_assets_are_independent_of_live_state(name, monkeypatch):
    config = {}
    monkeypatch.setattr(main, '_cfg', config)
    tracker = main.tracker
    client = TestClient(main.app)
    response = client.get('/assets/' + name)
    assert response.status_code == 200
    assert response.headers['content-type'].startswith('text/javascript')
    assert response.headers['cache-control'] == 'no-store'
    assert client.head('/assets/' + name).status_code == 200
    assert main._cfg is config and main.tracker is tracker
    assert client.get('/assets/config.yml').status_code == 404
    assert client.get('/assets/main.py').status_code == 404
    assert client.post('/assets/' + name).status_code == 405
    client.close()
