import asyncio
from datetime import datetime, timedelta, timezone

import httpx

from controller import main as controller
from controller.version import VersionBook, code_hash

JST = timezone(timedelta(hours=9))
T0 = datetime(2026, 11, 15, 23, 50, tzinfo=JST)


def test_version_counts_updates_and_merges_ones_close_together(tmp_path):
    book = VersionBook(tmp_path / 'version.json')
    assert book.version == '—'
    assert book.note('controller', 'c1', T0) is True
    assert book.version == '261115-1'
    first_build = book.build
    # 記録を始めた直後に transit を初めて見ても、同じ1回目
    assert book.note('transit', 't1', T0 + timedelta(seconds=20)) is False
    assert book.version == '261115-1' and book.build != first_build
    # 同じ中身なら何も変わらない
    build = book.build
    assert book.note('transit', 't1', T0 + timedelta(minutes=1)) is False and book.build == build
    # 翌日の更新で2回目。5分以内に続いた controller の変化は同じ回にまとめるが、build は変わる
    later = T0 + timedelta(days=1)
    assert book.note('transit', 't2', later) is True
    assert book.version == '261116-2'
    build = book.build
    assert book.note('controller', 'c2', later + timedelta(minutes=3)) is False
    assert book.version == '261116-2' and book.build != build
    assert book.data['history'][0]['parts'] == ['transit', 'controller']
    # 5分を過ぎたら次の回（まとめる幅は、その回の始まりから数える）
    assert book.note('controller', 'c3', later + timedelta(minutes=6)) is True
    assert book.version == '261116-3'
    # 記録はファイルに残り、読み直しても同じ
    again = VersionBook(tmp_path / 'version.json')
    assert again.version == '261116-3' and again.build == book.build
    assert [h['version'] for h in again.summary()['history']] == ['261116-3', '261116-2', '261115-1']


def test_a_part_seen_for_the_first_time_later_is_not_an_update(tmp_path):
    book = VersionBook(tmp_path / 'version.json')
    book.note('controller', 'c1', T0)
    assert book.note('transit', 't1', T0 + timedelta(hours=1)) is False
    assert book.version == '261115-1'


def test_code_hash_ignores_data_and_settings(tmp_path):
    (tmp_path / 'main.py').write_text('a')
    (tmp_path / 'data').mkdir()
    before = code_hash(tmp_path)
    (tmp_path / 'data' / 'schedule.json').write_text('{}')
    (tmp_path / 'config.yml').write_text('features: {}')
    assert code_hash(tmp_path) == before
    (tmp_path / 'main.py').write_text('b')
    assert code_hash(tmp_path) != before


def test_transit_update_bumps_version_and_tells_displays(tmp_path, monkeypatch):
    book = VersionBook(tmp_path / 'version.json')
    book.note('controller', 'c1', T0 - timedelta(hours=1))
    book.note('transit', 't1', T0 - timedelta(hours=1))
    monkeypatch.setattr(controller, 'versions', book)
    monkeypatch.setattr(controller, 'keihan_suspended', False)
    monkeypatch.setattr(controller, 'CONFIG_FILE', tmp_path / 'config.yml')
    client_type = httpx.AsyncClient
    monkeypatch.setattr(controller.httpx, 'AsyncClient', lambda **kwargs: client_type(transport=httpx.MockTransport(
        lambda request: httpx.Response(200, json={'trains': {'suspended': False}, 'code_hash': 't2'})), **kwargs))
    queue = asyncio.Queue()
    controller.subscribers.append(queue)
    try:
        asyncio.run(controller._refresh_suspension())
        sent = __import__('json').loads(queue.get_nowait())
        assert sent['version'] == book.version and sent['version'].endswith('-2')
        assert sent['build'] == book.build
    finally:
        controller.subscribers.remove(queue)
