"""「気象警報の札のしくみ」デモ：画面で選んだ架空の状況を、本番と同じ weather.summarize にかける。"""

from __future__ import annotations

import datetime
import json
from types import SimpleNamespace

from pyjmaxml.normalize.possibility import Possibility, PossibilityCell
from pyjmaxml.normalize.timeseries import WarningTimeSeriesCell
from pyjmaxml.normalize.warning import Element, classify_flood, classify_mete

import weather

JST = weather.JST
DAY = datetime.date(2026, 11, 13)

# 段階ごとの警報コードと名前（気象庁の警報コード表）
_WARNINGS = {
    "rain": {"advisory": ("10", "レベル２大雨注意報"), "warning": ("03", "レベル３大雨警報"),
             "danger": ("43", "レベル４大雨危険警報"), "emergency": ("33", "レベル５大雨特別警報")},
    "landslide": {"advisory": ("29", "レベル２土砂災害注意報"), "warning": ("09", "レベル３土砂災害警報"),
                  "danger": ("49", "レベル４土砂災害危険警報"), "emergency": ("39", "レベル５土砂災害特別警報")},
    "flood": {"advisory": ("20", "レベル２氾濫注意報"), "warning": ("30", "レベル３氾濫警報"),
              "danger": ("40", "レベル４氾濫危険警報"), "emergency": ("51", "レベル５氾濫特別警報")},
    "storm": {"advisory": ("15", "強風注意報"), "warning": ("05", "暴風警報"), "emergency": ("35", "暴風特別警報")},
    "snowstorm": {"advisory": ("13", "風雪注意報"), "warning": ("02", "暴風雪警報"), "emergency": ("32", "暴風雪特別警報")},
    "snow": {"advisory": ("12", "大雪注意報"), "warning": ("06", "大雪警報"), "emergency": ("36", "大雪特別警報")},
    "wave": {"advisory": ("16", "波浪注意報"), "warning": ("07", "波浪警報"), "emergency": ("37", "波浪特別警報")},
}
_SERIES = {"rain": "大雨浸水危険度", "landslide": "土砂災害危険度", "storm": "風危険度", "snow": "雪危険度"}
# 時系列の危険度コード（別表4）。大雨・土砂災害は警戒レベル相当で表す
_SERIES_CODE = {
    ("rain", "advisory"): "22", ("rain", "warning"): "31", ("rain", "danger"): "41", ("rain", "emergency"): "51",
    ("landslide", "advisory"): "22", ("landslide", "warning"): "31", ("landslide", "danger"): "41",
    ("landslide", "emergency"): "51",
    ("storm", "advisory"): "20", ("storm", "warning"): "30", ("storm", "emergency"): "50",
    ("snow", "advisory"): "20", ("snow", "warning"): "30", ("snow", "emergency"): "50",
}
_POSSIBILITY = {"rain": Element.HEAVY_RAIN, "landslide": Element.LANDSLIDE, "storm": Element.STORM,
                "snow": Element.HEAVY_SNOW}
_PERIODS = {"tonight": (18, 12), "tomorrow": (30, 18)}  # 今日0時からの開始時刻と長さ（時間）
_VALUES = {"high": Possibility.HIGH, "medium": Possibility.MEDIUM}


def _at(hour: int) -> datetime.datetime:
    return datetime.datetime.combine(DAY, datetime.time(), JST) + datetime.timedelta(hours=hour)


def _series_cell(prop: str, hour: int, code: str, condition: str = "") -> WarningTimeSeriesCell:
    return WarningTimeSeriesCell(
        area_code="", area_name="", local="", element=Element.UNKNOWN, property=prop, label="",
        start=_at(hour), duration=datetime.timedelta(hours=3), period_name="", code=code, text=None,
        number=None, unit="", condition=condition, description="", notes=(),
    )


def evaluate(raw: str) -> dict:
    """state（JSON 文字列）を本番の判定にかけ、/api/weather と同じ形で返す。"""
    state = json.loads(raw)
    now = _at(int(state.get("hour", 12)))
    cities = [weather._short(a) for a in weather.DEFAULT_AREAS]
    views = {c: SimpleNamespace(name="大阪府" + c, warnings=set(), timeseries=[], possibility=[]) for c in cities}

    for item in state.get("warnings", []):
        code, name = _WARNINGS[item["element"]][item["stage"]]
        kind = classify_flood(code, name, "VXKO") if item["element"] == "flood" else classify_mete(code, name)
        for city in item.get("cities", []):
            if city in views:
                views[city].warnings.add(kind)

    for item in state.get("series", []):
        prop = _SERIES[item["element"]]
        for block in item.get("blocks", []):
            code = _SERIES_CODE.get((item["element"], block["stage"]))
            if code is None:
                continue
            for city in item.get("cities", []):
                if city not in views:
                    continue
                views[city].timeseries.append(_series_cell(prop, block["hour"], code))
                if item["element"] == "storm" and item.get("snow"):
                    views[city].timeseries.append(_series_cell("風", block["hour"], None, "風雪"))

    cells = []
    for item in state.get("possibility", []):
        start, hours = _PERIODS[item["period"]]
        value = _VALUES.get(item["value"], Possibility.NONE)
        cells.append(PossibilityCell("270000", "大阪府", _POSSIBILITY[item["element"]], "", _at(start),
                                     datetime.timedelta(hours=hours), "", value, ""))
    for view in views.values():
        view.possibility = cells
        view.warnings = frozenset(view.warnings)

    summary = weather.summarize(list(views.values()), now)
    return {"enabled": True, "available": True, "as_of": now.strftime("%H:%M"), **summary,
            **weather.area_labels(weather.DEFAULT_AREAS), "error": None}
