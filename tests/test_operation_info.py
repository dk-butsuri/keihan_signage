import datetime

import pytest
from train_operation_info.exceptions import FetchError, RefreshError
from train_operation_info.models import (
    AlertEffect, AlertTiming, Line, LineId, LineStatus, Operator, OperatorId, ProviderId, ServiceAlert,
)

import operation_info

JST = datetime.timezone(datetime.timedelta(hours=9))
NOW = datetime.datetime(2026, 11, 4, 8, 0, tzinfo=JST)


def _line(provider, name, status, source_status=None, alerts=()):
    return Line(
        line_id=LineId(f"{provider}:{name}"), name=name,
        operator=Operator(operator_id=OperatorId(provider), name=provider),
        provider_id=ProviderId(provider), source_url="https://example.invalid/",
        status=status, source_status=source_status, alerts=alerts, updated_at=NOW,
    )


def _alert(description):
    return ServiceAlert(
        alert_id="a", title="t", description=description, effect=AlertEffect.DELAYS,
        timing=AlertTiming.ACTIVE, affected_line_ids=(), source_url="https://example.invalid/",
    )


class _FakeTracker:
    def __init__(self, lines, errors=None):
        self.lines = lines
        self.affected_lines = [l for l in lines if l.status not in (LineStatus.NORMAL, LineStatus.UNKNOWN)]
        self._errors = errors

    async def refresh(self):
        if self._errors:
            raise RefreshError(self._errors)


@pytest.mark.anyio
async def test_rows_labels_and_jrw_filter():
    tracker = _FakeTracker([
        _line("keihan", "京阪本線", LineStatus.DELAYED, "遅延", (_alert("人身事故の影響で遅れています"),)),
        _line("jrw", "学研都市線", LineStatus.SUSPENDED, "運転見合わせ"),
        _line("jrw", "因美線", LineStatus.PARTIAL_SUSPENSION, "一部列車運休"),   # 京阪神ではない
        _line("hankyu", "京都線", LineStatus.ALERT, "お知らせあり"),
    ], errors={ProviderId("nankai"): FetchError("503")})

    rows, error = await operation_info.fetch(tracker, {})

    assert [(r["line"], r["status"]) for r in rows] == [
        ("京阪本線", "列車遅延"), ("JR学研都市線", "運転見合わせ"), ("阪急京都線", "お知らせ"),
    ]
    assert rows[0]["detail"] == "人身事故の影響で遅れています"
    assert rows[0]["announced_time"] == NOW
    assert "nankai" in error


@pytest.mark.anyio
async def test_alert_label_and_missing_announced_time():
    line = _line("transilien", "RER D", LineStatus.ALERT, "TRAFIC:UNKNOWN").model_copy(update={"updated_at": None})
    rows, _ = await operation_info.fetch(_FakeTracker([line]), {})
    assert rows[0]["status"] == "お知らせ"
    assert rows[0]["announced_time"] is None


@pytest.mark.anyio
async def test_only_lines_can_be_disabled():
    tracker = _FakeTracker([_line("jrw", "因美線", LineStatus.PARTIAL_SUSPENSION), _line("jrw", "ＪＲ京都線", LineStatus.DELAYED)])
    rows, error = await operation_info.fetch(tracker, {"only_lines": {}})
    assert [r["line"] for r in rows] == ["JR因美線", "ＪＲ京都線"] and error is None


@pytest.mark.parametrize(("provider", "name", "shown"), [
    ("jreast", "山手線", "JR東日本 山手線"),
    ("jrkyushu", "JR九州 福岡・北九州エリア", "JR九州 福岡・北九州エリア"),
    ("tokyo_metro", "東京メトロ銀座線", "東京メトロ銀座線"),
    ("toei", "浅草線", "都営浅草線"),
    ("unknown_provider", "本線", "unknown_provider 本線"),   # 略称が無ければ会社名
])
def test_display_names(provider, name, shown):
    assert operation_info._display_name(_line(provider, name, LineStatus.DELAYED)) == shown


def test_build_tracker_all_uses_library_default():
    ids = {p.provider_id for p in operation_info.build_tracker({"providers": "all"}).providers}
    assert {"jreast", "keihan", "tra"} <= ids
    assert not ids & {"yahoo", "mta_subway", "odakyu", "db"}


def test_build_tracker_yahoo_is_kinki_only():
    tracker = operation_info.build_tracker({"providers": ["yahoo", "keihan"]})
    yahoo = next(p for p in tracker.providers if p.provider_id == "yahoo")
    assert [a.name for a in yahoo.areas] == ["KINKI"]


@pytest.fixture
def anyio_backend():
    return "asyncio"


def test_groups_severity_order_names_and_details():
    tracker = _FakeTracker([
        _line("jrw", "学研都市線", LineStatus.DELAYED),
        _line("jrw", "JR京都線", LineStatus.SUSPENDED, alerts=(_alert("線路確認中"),)),
        _line("jrw", "大阪環状線", LineStatus.SUSPENDED),
        _line("jrw", "因美線", LineStatus.SUSPENDED),
        _line("jrw", "奈良線", LineStatus.PARTIAL_SUSPENSION),
        _line("hankyu", "京都線", LineStatus.DELAYED),
        _line("keihan", "京阪本線", LineStatus.NORMAL),
        _line("keihan", "宇治線", LineStatus.UNKNOWN),
        _line("osaka_metro", "御堂筋線", LineStatus.ALERT),
    ])
    groups = operation_info.groups(tracker, {})
    assert [g["name"] for g in groups] == ["京阪", "大阪メトロ", "JR", "大阪モノレール", "近鉄", "その他の私鉄"]
    assert [(g["mark"], g["status"]) for g in groups] == [
        ("○", "平常運転"), ("○", "平常運転"), ("×", "運転見合わせ"), ("−", "情報なし"), ("−", "情報なし"), ("△", "列車遅延"),
    ]
    assert [line["name"] for line in groups[2]["lines"]] == ["JR京都線", "大阪環状線", "奈良線", "学研都市線"]
    assert groups[2]["lines"][0]["detail"] == "線路確認中"
    assert groups[2]["lines"][0]["announced_time"] == NOW
    assert groups[5]["lines"][0]["name"] == "阪急京都線"
    assert not groups[0]["lines"] and not groups[1]["lines"]


def test_groups_missing_and_unknown_are_not_normal():
    groups = operation_info.groups(_FakeTracker([_line("keihan", "京阪本線", LineStatus.UNKNOWN)]), {})
    assert all(g["mark"] == "−" and g["status"] == "情報なし" and not g["lines"] for g in groups)
    assert operation_info.groups(None, {}) == groups


def test_groups_custom_order_and_only_lines():
    tracker = _FakeTracker([
        _line("jrw", "ＪＲ京都線", LineStatus.DELAYED),
        _line("jrw", "学研都市線", LineStatus.DELAYED),
        _line("jrw", "因美線", LineStatus.DELAYED),
    ])
    cfg = {"only_lines": {}, "groups": [{"name": "JR", "providers": ["jrw"], "lines": ["因美線", "学研都市線", "JR京都線"]}]}
    assert [line["name"] for line in operation_info.groups(tracker, cfg)[0]["lines"]] == ["因美線", "学研都市線", "JR京都線"]
    cfg["only_lines"] = {"jrw": ["JR京都線"]}
    assert [line["name"] for line in operation_info.groups(tracker, cfg)[0]["lines"]] == ["JR京都線"]


@pytest.mark.anyio
async def test_groups_survive_partial_refresh_failure():
    tracker = _FakeTracker([_line("keihan", "京阪本線", LineStatus.NORMAL)],
                           errors={ProviderId("jrw"): FetchError("503")})
    await operation_info.fetch(tracker, {})
    groups = operation_info.groups(tracker, {})
    assert groups[0]["mark"] == "○" and groups[2]["mark"] == "−"


def test_delay_api_keeps_legacy_rows_and_exposes_groups(monkeypatch):
    import main
    from fastapi.testclient import TestClient
    tracker = _FakeTracker([_line("jrw", "ＪＲ京都線", LineStatus.SUSPENDED, alerts=(_alert("線路確認中"),))])
    monkeypatch.setattr(main, "latest_delay_data", [main.DelayInfo(line="ＪＲ京都線", status="運転見合わせ", detail="線路確認中", announced_time=NOW)])
    monkeypatch.setattr(main, "latest_delay_groups", [main.DelayGroup(**group) for group in operation_info.groups(tracker, {})])
    monkeypatch.setattr(main, "latest_delay_error", "nankai: 503")
    client = TestClient(main.app)
    response = client.get('/api/delays')
    assert response.status_code == 200
    data = response.json()
    assert data["delays"][0]["line"] == "ＪＲ京都線"
    assert data["groups"][2]["lines"][0]["ticker_name"] == "JR京都線"
    assert data["groups"][2]["lines"][0]["announced_time"] == NOW.isoformat()
    assert data["error"] == "nankai: 503"
    monkeypatch.setattr(main, "latest_delay_groups", [])
    monkeypatch.setattr(main, "_cfg", {})
    assert all(group["status"] == "情報なし" for group in client.get('/api/delays').json()["groups"])
    client.close()
