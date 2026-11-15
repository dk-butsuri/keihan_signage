"""操作デモの入力を、実際の運行情報の集約と表示用データに変換する。外部取得・保存はしない。"""

import datetime
from types import SimpleNamespace
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from train_operation_info.models import Line, LineId, LineStatus, Operator, OperatorId, ProviderId

import operation_info
from demo_scenarios import static_scenario


_ROUTES = (
    ("京阪", "keihan", ("京阪本線", "鴨東線", "中之島線", "交野線", "宇治線")),
    ("大阪メトロ", "osaka_metro", ("御堂筋線", "谷町線", "四つ橋線", "中央線", "千日前線", "堺筋線", "長堀鶴見緑地線", "今里筋線", "ニュートラム")),
    ("JR", "jrw", tuple(operation_info.DEFAULT_ONLY_LINES["jrw"])),
    ("大阪モノレール", "osaka_monorail", ("大阪モノレール線", "彩都線")),
    ("近鉄", "kintetsu", ("奈良線", "大阪線", "京都線", "南大阪線", "けいはんな線")),
    ("その他の私鉄", "hankyu", ("京都線", "神戸線", "宝塚線")),
    ("その他の私鉄", "hanshin", ("阪神本線", "阪神なんば線", "武庫川線")),
    ("その他の私鉄", "nankai", ("南海本線", "高野線")),
)
ROUTES = tuple({"id": f"{provider}:{name}", "name": name, "provider": provider, "group": group,
                "label": name if group != "その他の私鉄" else name if name.startswith(operation_info._PREFIX[provider]) else operation_info._PREFIX[provider] + name}
               for group, provider, names in _ROUTES for name in names)
STATUSES = (("normal", "平常運転"), ("delayed", "列車遅延"), ("suspended", "運転見合わせ"),
            ("partial_suspension", "部分運休"), ("alert", "お知らせ（ALERT）"),
            ("unknown", "状況不明（UNKNOWN）"), ("missing", "未取得"))


class RouteState(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["normal", "delayed", "suspended", "partial_suspension", "alert", "unknown", "missing"] = "normal"
    detail: str = Field(default="架空の想定です。安全確認を行っています。", max_length=1000)
    age: int = Field(default=8, ge=0, le=1440)


class PlaygroundState(BaseModel):
    model_config = ConfigDict(extra="forbid")
    screen: Literal["normal", "suspended"] = "normal"
    train_delay: int = Field(default=0, ge=0, le=240)
    train_stop: int = Field(default=0, ge=0, le=240)
    train_remaining: int = Field(default=18, ge=15, le=180)
    train_count: int = Field(default=4, ge=1, le=6)
    predictions: bool = True
    bus_delay: int | None = Field(default=0, ge=0, le=240)
    bus_remaining: int = Field(default=8, ge=0, le=180)
    bus_count: int = Field(default=4, ge=0, le=6)
    bus_arrived: bool = False
    routes: dict[str, RouteState] = Field(default_factory=dict, max_length=len(ROUTES))


def evaluate(state: PlaygroundState) -> dict:
    unknown_ids = state.routes.keys() - {route["id"] for route in ROUTES}
    if unknown_ids:
        raise ValueError("選択できない路線が含まれています")
    data = static_scenario("normal")
    now = datetime.datetime.fromtimestamp(data["timestamp"], datetime.timezone(datetime.timedelta(hours=9)))
    at = lambda minutes: (now + datetime.timedelta(minutes=minutes)).strftime("%H:%M")

    lines = []
    for route in ROUTES:
        setting = state.routes.get(route["id"], RouteState())
        if setting.status == "missing":
            continue
        lines.append(Line(
            line_id=LineId(route["id"]), name=route["name"], provider_id=ProviderId(route["provider"]),
            operator=Operator(operator_id=OperatorId(route["provider"]), name=route["group"]),
            source_url="https://example.invalid/demo", status=LineStatus(setting.status),
            source_status=setting.detail, fetched_at=now, updated_at=now - datetime.timedelta(minutes=setting.age),
        ))
    groups = operation_info.groups(SimpleNamespace(lines=lines), {})
    data["delays"] = {"groups": groups, "error": None, "delays": [
        {"line": line["ticker_name"], **{key: line[key] for key in ("status", "detail", "announced_time")}}
        for group in groups for line in group["lines"]
    ]}

    reliable = state.predictions and state.train_stop == 0 and state.train_delay < 120
    for direction in ("up", "down"):
        trains = data["trains"][direction + "_trains"][:state.train_count]
        for i, train in enumerate(trains):
            remaining = state.train_remaining + i * 10
            position = ("寝屋川市" if direction == "up" else "光善寺") + "に停車中" if state.train_stop else train["position"]
            train.update({"time": at(remaining - state.train_delay), "estimated_time": at(remaining) if reliable else None,
                          "delay": min(120, state.train_delay), "estimated_delay_minutes": state.train_delay if state.train_delay >= 120 else None,
                          "minutes_remaining": remaining if reliable else None, "estimate_unreliable": not reliable,
                          "stopped_minutes": state.train_stop or None, "position": position, "position_text": position,
                          "sub_station_time": at(remaining + (-3 if direction == "up" else 3))})
        data["trains"][direction + "_trains"] = trains
        data["line"]["directions"][direction] = {
            "state": "stopped" if state.train_stop else "delayed" if state.train_delay else "normal", "next": trains[:2],
        }
    for train in data["line"]["trains"]:
        train.update(delay=min(120, state.train_delay), stopped_minutes=state.train_stop or None)
    data["line"]["suspended"] = state.screen == "suspended"
    data["line"]["stopped"] = data["line"]["total"] if state.train_stop else 0

    buses = data["buses"]["buses"][:state.bus_count]
    for i, bus in enumerate(buses):
        remaining = state.bus_remaining + i * 10
        delay = state.bus_delay
        arrived = state.bus_arrived and i == 0
        text = "到着済" if arrived else None if delay is None else "定時運行中" if delay == 0 else f"約{delay // 60}時間{delay % 60}分遅れ" if delay >= 60 else f"約{delay}分遅れ"
        bus.update({"scheduled_time": at(remaining - (delay or 0)), "arrival_time": at(remaining) + " 到着予定",
                    "delay_minutes": None if arrived else delay, "delay_text": text,
                    "status": "到着済" if arrived else f"約{remaining}分後に到着" if remaining else "まもなく到着",
                    "terminal_arrival_time": at(remaining - (delay or 0) + (19 if i % 2 == 0 else 12))})
    data["buses"]["buses"] = buses
    return data


def bootstrap() -> dict:
    state = PlaygroundState()
    return {"version": 1, "mode": "playground", "routes": ROUTES, "statuses": STATUSES,
            "state": state.model_dump(), "frame": evaluate(state)}
