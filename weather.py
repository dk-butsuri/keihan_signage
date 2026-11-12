"""気象庁の防災情報XMLから、表示する警報と予告をまとめる。"""

from __future__ import annotations

import datetime
import re
from dataclasses import dataclass, field
from typing import Iterable, Optional, Sequence

from pyjmaxml.normalize.possibility import Possibility, PossibilityCell
from pyjmaxml.normalize.warning import Element, Stage, WarningKind, rank

JST = datetime.timezone(datetime.timedelta(hours=9), "JST")

DEFAULT_AREAS = [
    "大阪府寝屋川市", "大阪府枚方市", "大阪府交野市", "大阪府守口市",
    "大阪府門真市", "大阪府四條畷市", "大阪府大東市",
]

_LEVELED = {Element.HEAVY_RAIN, Element.LANDSLIDE, Element.STORM_SURGE, Element.FLOOD}
_STAGE_LEVEL = {Stage.WARNING: 3, Stage.DANGER_WARNING: 4, Stage.EMERGENCY: 5}
_LEVEL_PREFIX = re.compile(r"^レベル[0-9０-９]+")

# 時系列（VPWP50）の危険度。コードは「気象警報・注意報時系列情報（Ｒ０６）」別表4
_SERIES = {
    "大雨浸水危険度": ("大雨", Element.HEAVY_RAIN),
    "土砂災害危険度": ("土砂災害", Element.LANDSLIDE),
    "風危険度": ("暴風", Element.STORM),
    "雪危険度": ("大雪", Element.HEAVY_SNOW),
}
_SERIES_STAGE = {
    "30": Stage.WARNING, "31": Stage.WARNING,
    "41": Stage.DANGER_WARNING,
    "50": Stage.EMERGENCY, "51": Stage.EMERGENCY,
}
_STAGE_SUFFIX = {Stage.WARNING: "警報", Stage.DANGER_WARNING: "危険警報", Stage.EMERGENCY: "特別警報"}
# 気象庁が「警報に切り替える可能性が高い」と出すのは、おおむね半日先まで
SOON_WINDOW = datetime.timedelta(hours=12)

_POSSIBILITY = {
    Element.HEAVY_RAIN: "大雨",
    Element.LANDSLIDE: "土砂災害",
    Element.STORM: "暴風",
    Element.HEAVY_SNOW: "大雪",
}
_ELEMENT_ORDER = [
    Element.HEAVY_RAIN, Element.LANDSLIDE, Element.FLOOD, Element.STORM_SURGE,
    Element.STORM, Element.SNOWSTORM, Element.HEAVY_SNOW, Element.HIGH_WAVE,
    Element.OTHER, Element.UNKNOWN,
]


def wanted(kind: WarningKind) -> bool:
    """本校の基準：特別警報、レベル4以上、暴風・暴風雪・大雪警報、レベル3の氾濫・大雨・土砂災害警報。"""
    if kind.stage is None:
        return False
    if kind.stage >= Stage.DANGER_WARNING or (kind.level or 0) >= 4:
        return True
    if kind.stage != Stage.WARNING:
        return False
    # 名前に「レベル３」が無い電文でも、この3つの警報はレベル3として扱う
    return kind.element in {Element.STORM, Element.SNOWSTORM, Element.HEAVY_SNOW,
                            Element.FLOOD, Element.HEAVY_RAIN, Element.LANDSLIDE}


def _level(kind: WarningKind) -> Optional[int]:
    if kind.level is not None:
        return kind.level
    if kind.element in _LEVELED and kind.stage is not None:
        return _STAGE_LEVEL.get(kind.stage)
    return None


def _tone(kind: WarningKind, level: Optional[int]) -> str:
    if kind.stage == Stage.EMERGENCY or level == 5:
        return "l5"
    if kind.stage == Stage.DANGER_WARNING or level == 4:
        return "l4"
    return "l3"


def _short(area: str) -> str:
    return re.sub(r"^.+?[都道府県]", "", area, count=1)


def _same_element(a: Element, b: Element) -> bool:
    storm = {Element.STORM, Element.SNOWSTORM}
    return a == b or (a in storm and b in storm)


@dataclass
class _Group:
    name: str
    level: Optional[int]
    tone: str
    rank: tuple[int, int]
    element: Element
    cities: list[str] = field(default_factory=list)


def _warnings(views: Sequence) -> list[dict]:
    groups: dict[str, _Group] = {}
    for view in views:
        for kind in view.warnings:
            if not wanted(kind):
                continue
            level = _level(kind)
            name = _LEVEL_PREFIX.sub("", kind.name) or kind.name
            group = groups.get(name)
            if group is None:
                group = groups[name] = _Group(name, level, _tone(kind, level), rank(kind), kind.element)
            city = _short(view.name)
            if city not in group.cities:
                group.cities.append(city)
    ordered = sorted(groups.values(), key=lambda g: (
        -g.rank[0], -g.rank[1], _ELEMENT_ORDER.index(g.element) if g.element in _ELEMENT_ORDER else 99))
    return [{"name": g.name, "level": g.level, "tone": g.tone, "cities": g.cities} for g in ordered]


def _active_stage(view, element: Element) -> int:
    stages = [int(k.stage) for k in view.warnings if k.stage is not None and _same_element(k.element, element)]
    return max(stages, default=0)


def _when(start: datetime.datetime, now: datetime.datetime) -> str:
    start, now = start.astimezone(JST), now.astimezone(JST)
    if start <= now:
        return "まもなく"
    day = (start.date() - now.date()).days
    prefix = "" if day == 0 else "明日" if day == 1 else f"{start.day}日"
    return f"{prefix}{start.hour}時ごろから"


def _soon(views: Sequence, now: datetime.datetime) -> list[dict]:
    found: dict[Element, dict] = {}
    for view in views:
        snow_starts = {c.start for c in view.timeseries if c.property == "風" and c.condition == "風雪"}
        for cell in view.timeseries:
            spec = _SERIES.get(cell.property)
            stage = _SERIES_STAGE.get(cell.code or "")
            if spec is None or stage is None or cell.local not in ("", "陸上"):
                continue
            end = cell.start + (cell.duration or datetime.timedelta(hours=3))
            if end <= now or cell.start >= now + SOON_WINDOW:
                continue
            label, element = spec
            if element == Element.STORM and cell.start in snow_starts:
                label, element = "暴風雪", Element.SNOWSTORM
            if _active_stage(view, element) >= int(stage):
                continue
            key = Element.STORM if element == Element.SNOWSTORM else element
            entry = found.get(key)
            better = entry is None or int(stage) > entry["stage"] or (
                int(stage) == entry["stage"] and cell.start < entry["start"])
            if better:
                cities = entry["cities"] if entry and int(stage) == entry["stage"] else []
                entry = found[key] = {"stage": int(stage), "start": cell.start,
                                      "name": label + _STAGE_SUFFIX[stage], "cities": cities}
            if int(stage) == entry["stage"]:
                city = _short(view.name)
                if city not in entry["cities"]:
                    entry["cities"].append(city)
    order = {_short(v.name): i for i, v in enumerate(views)}
    result = []
    for key in _ELEMENT_ORDER:
        entry = found.get(key)
        if entry:
            result.append({"kind": "soon", "when": _when(entry["start"], now), "name": entry["name"],
                           "element": key, "cities": sorted(entry["cities"], key=order.get)})
    return result


def _possibility_when(start: datetime.datetime, now: datetime.datetime) -> str:
    start, now = start.astimezone(JST), now.astimezone(JST)
    day = (start.date() - now.date()).days
    if day <= 0:
        return "今夜" if start.hour >= 18 else "今日"
    return "明日" if day == 1 else f"{start.day}日"


def _possibilities(views: Sequence, now: datetime.datetime, covered: set[Element]) -> list[dict]:
    if not views:
        return []
    # 警報級の可能性は府県（一次細分区域）ごとの発表で、7市とも同じ値になる
    found: dict[Element, PossibilityCell] = {}
    for cell in views[0].possibility:
        if cell.element not in _POSSIBILITY or cell.possibility != Possibility.HIGH:
            continue
        if cell.duration is not None and cell.start + cell.duration <= now:
            continue
        if any(_same_element(cell.element, e) for e in covered):
            continue
        if cell.element not in found or cell.start < found[cell.element].start:
            found[cell.element] = cell
    return [{"kind": "possibility", "when": _possibility_when(found[e].start, now),
             "name": _POSSIBILITY[e], "place": "大阪府"}
            for e in _ELEMENT_ORDER if e in found]



def area_labels(areas: Sequence[str]) -> dict:
    """市名をまとめて書くときの言い方。対象がすべて市なら「7市すべて」「寝屋川市ほか3市」。"""
    names = [_short(a) for a in areas]
    unit = "市" if names and all(n.endswith("市") for n in names) else "か所"
    return {"area_count": len(names), "all_label": f"{len(names)}{unit}すべて", "unit": unit}


def summarize(views: Sequence, now: datetime.datetime) -> dict:
    warnings = _warnings(views)
    soon = _soon(views, now)
    covered: set[Element] = {s["element"] for s in soon}
    for view in views:
        covered.update(k.element for k in view.warnings if wanted(k))
    previews = [{k: v for k, v in s.items() if k != "element"} for s in soon]
    previews += _possibilities(views, now, covered)
    return {"warnings": warnings, "previews": previews}


class WeatherWatcher:
    """pyjmaxml の Tracker を回し、最後にそろった結果を保つ。update() は別スレッドから呼ぶ。"""

    def __init__(self, areas: Iterable[str], user_agent: str):
        from pyjmaxml import Tracker
        self.areas = list(areas)
        self.tracker = Tracker(self.areas, user_agent=user_agent)
        self.summary: Optional[dict] = None
        self.last_success: Optional[datetime.datetime] = None
        self.error: Optional[str] = None

    def update(self) -> None:
        result = self.tracker.update()
        now = datetime.datetime.now(JST)
        if result.errors:
            self.error = " / ".join(str(e) for e in result.errors)[:300]
            return
        self.summary = summarize([self.tracker.area(a) for a in self.areas], now)
        self.last_success = now
        self.error = None
