import datetime
from types import SimpleNamespace

from pyjmaxml.normalize.possibility import Possibility, PossibilityCell
from pyjmaxml.normalize.timeseries import WarningTimeSeriesCell
from pyjmaxml.normalize.warning import Element, classify_flood, classify_mete

import weather

JST = datetime.timezone(datetime.timedelta(hours=9))
NOW = datetime.datetime(2026, 11, 13, 14, 32, tzinfo=JST)
H3 = datetime.timedelta(hours=3)


def _view(city, warnings=(), timeseries=(), possibility=()):
    return SimpleNamespace(name="大阪府" + city, warnings=frozenset(warnings),
                           timeseries=tuple(timeseries), possibility=tuple(possibility))


def _series(prop, start, code, condition="", local=""):
    return WarningTimeSeriesCell(
        area_code="0", area_name="", local=local, element=Element.UNKNOWN, property=prop, label="",
        start=start, duration=H3, period_name="", code=code, text=None, number=None, unit="",
        condition=condition, description="", notes=(),
    )


def _possibility(element, start, value):
    return PossibilityCell("270000", "大阪府", element, "", start, datetime.timedelta(hours=6), "", value, "")


RAIN3 = classify_mete("03", "レベル３大雨警報")
LAND4 = classify_mete("49", "レベル４土砂災害危険警報")
STORM = classify_mete("05", "暴風警報")
WAVE = classify_mete("07", "波浪警報")
RAIN_ADVISORY = classify_mete("10", "レベル２大雨注意報")
RAIN5 = classify_mete("33", "レベル５大雨特別警報")
FLOOD3 = classify_flood("30", "レベル３氾濫警報", "VXKO")


def test_school_criteria():
    assert weather.wanted(RAIN3) and weather.wanted(LAND4) and weather.wanted(STORM)
    assert weather.wanted(FLOOD3) and weather.wanted(RAIN5)
    assert weather.wanted(classify_mete("06", "大雪警報")) and weather.wanted(classify_mete("02", "暴風雪警報"))
    assert weather.wanted(classify_mete("37", "波浪特別警報"))
    assert not weather.wanted(WAVE)
    assert not weather.wanted(RAIN_ADVISORY)
    assert not weather.wanted(classify_mete("08", "レベル３高潮警報"))
    # 名前にレベルが無くても大雨警報はレベル3として出す
    assert weather.wanted(classify_mete("03", "大雨警報"))


def test_warnings_grouped_and_ordered_by_level():
    views = [
        _view("寝屋川市", [RAIN3, STORM, WAVE]),
        _view("枚方市", [RAIN3, LAND4, STORM]),
        _view("交野市", [LAND4, RAIN_ADVISORY]),
    ]
    result = weather.summarize(views, NOW)["warnings"]
    assert [(w["name"], w["level"], w["tone"]) for w in result] == [
        ("土砂災害危険警報", 4, "l4"), ("大雨警報", 3, "l3"), ("暴風警報", None, "l3"),
    ]
    assert result[0]["cities"] == ["枚方市", "交野市"]
    assert result[1]["cities"] == ["寝屋川市", "枚方市"]


def test_special_warning_is_black():
    result = weather.summarize([_view("寝屋川市", [RAIN5])], NOW)["warnings"]
    assert result == [{"name": "大雨特別警報", "level": 5, "tone": "l5", "cities": ["寝屋川市"]}]


def test_soon_from_time_series():
    start = datetime.datetime(2026, 11, 13, 18, tzinfo=JST)
    views = [
        _view("寝屋川市", timeseries=[_series("大雨浸水危険度", start - H3, "20"), _series("大雨浸水危険度", start, "31")]),
        _view("枚方市", timeseries=[_series("大雨浸水危険度", start + H3, "31")]),
        _view("交野市", [RAIN3], timeseries=[_series("大雨浸水危険度", start, "31")]),
    ]
    previews = weather.summarize(views, NOW)["previews"]
    assert previews == [{"kind": "soon", "when": "18時ごろから", "name": "大雨警報", "cities": ["寝屋川市", "枚方市"]}]


def test_soon_upgrade_and_current_block():
    views = [_view("寝屋川市", [RAIN3], timeseries=[
        _series("大雨浸水危険度", datetime.datetime(2026, 11, 13, 12, tzinfo=JST), "41"),
    ])]
    previews = weather.summarize(views, NOW)["previews"]
    assert previews == [{"kind": "soon", "when": "まもなく", "name": "大雨危険警報", "cities": ["寝屋川市"]}]


def test_soon_snowstorm_and_window():
    tomorrow = datetime.datetime(2026, 11, 14, 0, tzinfo=JST)
    views = [_view("寝屋川市", timeseries=[
        _series("風危険度", tomorrow, "30", local="陸上"),
        _series("風", tomorrow, None, condition="風雪"),
        _series("雪危険度", datetime.datetime(2026, 11, 14, 6, tzinfo=JST), "30"),  # 12時間より先
        _series("波危険度", tomorrow, "30"),
    ])]
    previews = weather.summarize(views, NOW)["previews"]
    assert previews == [{"kind": "soon", "when": "明日0時ごろから", "name": "暴風雪警報", "cities": ["寝屋川市"]}]


def test_possibility_high_only_and_not_duplicated():
    tonight = datetime.datetime(2026, 11, 13, 18, tzinfo=JST)
    tomorrow = datetime.datetime(2026, 11, 14, 6, tzinfo=JST)
    views = [_view("寝屋川市", [STORM], possibility=[
        _possibility(Element.HEAVY_RAIN, tomorrow, Possibility.HIGH),
        _possibility(Element.HEAVY_SNOW, tonight, Possibility.MEDIUM),
        _possibility(Element.STORM, tomorrow, Possibility.HIGH),
        _possibility(Element.HIGH_WAVE, tomorrow, Possibility.HIGH),
    ])]
    previews = weather.summarize(views, NOW)["previews"]
    assert previews == [{"kind": "possibility", "when": "明日", "name": "大雨", "place": "大阪府"}]


def test_nothing_to_show():
    assert weather.summarize([_view("寝屋川市", [WAVE, RAIN_ADVISORY])], NOW) == {"warnings": [], "previews": []}
