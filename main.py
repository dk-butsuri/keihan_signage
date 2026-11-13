from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request
from pathlib import Path
from fastapi.middleware.cors import CORSMiddleware
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles # type: ignore
from fastapi.responses import FileResponse, HTMLResponse, Response
from pydantic import BaseModel, Field
from typing import List, Optional, Literal
import datetime
import asyncio
import time
import re
import yaml
from keihan_tracker import KHTracker
from keihan_tracker.keihan_train.schemes import TrainType
from keihan_tracker.keihan_train.tracker import ActiveTrainData
from keihan_tracker.keihan_train.position_calculation import calc_position
import operation_info
import bus_timetable
import weather
from demo import router as demo_router
import dotenv
dotenv.load_dotenv()
from os import environ
from keihan_tracker.bus.tracker import get_khbus_info

from zoneinfo import ZoneInfo
JST = ZoneInfo("Asia/Tokyo")

_cfg: dict = {}
_tasks: dict[str, asyncio.Task] = {}

tracker = KHTracker(snapshot_dir="/app/data/snapshots")

# サイネージ起動時に既にいた列車の staying_time は起動時刻から数えられ、実際より短い
_first_position_time: Optional[datetime.datetime] = None
# 最後に fetch_pos が成功した時刻。ライブラリの last_fetch_pos_datetime は失敗しても更新されるので使えない
_last_pos_success: Optional[datetime.datetime] = None


async def _fetch_pos() -> None:
    global _last_pos_success
    await tracker.fetch_pos()
    _last_pos_success = datetime.datetime.now(JST)


def _stale_reason(now: datetime.datetime) -> Optional[str]:
    """列車の表示を止める理由。止めなくてよければ None。

    終電後は公式の位置情報が更新されなくなる（作成時刻が進まない）が、走行中の列車は0本になるので、
    作成時刻が古くても走行中の列車が残っていなければ止めない。
    """
    limit = datetime.timedelta(minutes=_cfg["trains"].get("stale_minutes", 5))
    created = tracker.position_created_at
    when = created.astimezone(JST).strftime("%H:%M") if created else "未取得"
    if _last_pos_success is None or now - _last_pos_success > limit:
        return f"列車位置を取得できていないため表示を止めています（{when}時点の情報）"
    if (created is None or now - created > limit) and tracker.active_trains:
        return f"列車位置の情報が古いため表示を止めています（{when}時点）"
    return None


def _is_barely_moving(train: ActiveTrainData) -> bool:
    cfg = _cfg.get("trains", {})
    return (
        train.is_delay_growing(ratio=cfg.get("delay_growing_ratio", 0.7))
        or (not train.is_at_start_station and train.staying_time > datetime.timedelta(minutes=cfg.get("stuck_minutes", 15)))
    )


def _is_unreliable(train) -> bool:
    return train.delay_minutes >= 120 or (isinstance(train, ActiveTrainData) and _is_barely_moving(train))


_THROUGH_LINES = ("京阪本線・鴨東線", "中之島線")


def _on_through_line(train) -> bool:
    try:
        return isinstance(train, ActiveTrainData) and train.line in _THROUGH_LINES
    except ValueError:
        return False


def _station_row(station_id: int) -> Optional[int]:
    # 本線の行は出町柳(42)を1行目に、1駅3行ずつ大阪側へ進む
    return (42 - station_id) * 3 + 1 if 4 <= station_id <= 42 else None


def _barely_moving_rows() -> list[tuple[str, int]]:
    # 2時間以上の遅れは公式の値が頭打ちなだけで進んでいないとは限らないので、前詰まりには数えない
    return [(t.direction, t.location_row) for t in tracker.active_trains.values()
            if _on_through_line(t) and _is_barely_moving(t)]


def _blocked_ahead(train, station_row: Optional[int], blockers: list[tuple[str, int]]) -> bool:
    if station_row is None or not _on_through_line(train):
        return False
    row = train.location_row
    for direction, other in blockers:
        if direction != train.direction:
            continue
        if (station_row <= other < row) if direction == "up" else (row < other <= station_row):
            return True
    return False


def _within_estimate_window(minutes_remaining: float, delay: int) -> bool:
    return (
        (minutes_remaining <= 60 and delay <= 10)
        or (minutes_remaining <= 25 and delay <= 60)
    )


def _corrected_delay_minutes(minutes_remaining: float, delay: int) -> float:
    # 小さい遅れは香里園に着くまでに回復しやすいので、遠い列車ほど遅れを割り引く
    if delay > 10:
        return delay
    return delay - min(delay, 0.1 * max(0.0, minutes_remaining))


def _estimated_delay_minutes(train) -> Optional[int]:
    if train.delay_minutes < 120 or not isinstance(train, ActiveTrainData):
        return None
    try:
        return train.estimated_delay_minutes if train.next_stop_station is not None else None
    except (ValueError, IndexError, KeyError, TypeError, AttributeError) as exc:
        print(f"Delay lower bound unavailable: {type(exc).__name__}")
        return None


def _stopped_minutes(train, threshold: Optional[int] = None) -> Optional[int]:
    """見込みを出せず、始発駅以外で同じ位置に threshold 分以上いる列車の停止分数。"""
    if not isinstance(train, ActiveTrainData):
        return None
    if threshold is None:
        threshold = _cfg.get("trains", {}).get("stopped_minutes_threshold", 5)
    if train.is_at_start_station or not _is_unreliable(train):
        return None
    minutes = int(train.staying_time.total_seconds() // 60)
    return minutes if minutes >= threshold else None


def _line_position(col: int, row: int) -> Optional[float]:
    if not 1 <= col <= 5 or not 1 <= row <= 117:
        return None
    st = 42 - (row - 1) // 3
    k = (row - 1) % 3
    if k == 0 or (st in (42, 21, 4) and k == 1):
        return float(st)
    return st - k / 3


class SuspensionState:
    def __init__(self):
        self.suspended = False
        self.enter_count = 0
        self.exit_since: Optional[datetime.datetime] = None

    def update(self, ratio: Optional[float], official: bool, stale: bool, now: datetime.datetime) -> bool:
        cfg = _cfg.get("trains", {})
        if stale or ratio is None:
            self.enter_count = 0
            self.exit_since = None
            return self.suspended
        if official:
            self.suspended = True
            self.enter_count = 0
            self.exit_since = None
        elif not self.suspended:
            self.enter_count = self.enter_count + 1 if ratio >= cfg.get("suspended_enter_ratio", 0.25) else 0
            if self.enter_count >= cfg.get("suspended_enter_count", 2):
                self.suspended = True
                self.enter_count = 0
        elif ratio < cfg.get("suspended_exit_ratio", 0.15):
            if self.exit_since is None:
                self.exit_since = now
            if now - self.exit_since >= datetime.timedelta(minutes=cfg.get("suspended_exit_minutes", 5)):
                self.suspended = False
                self.exit_since = None
        else:
            self.exit_since = None
        return self.suspended


_suspension = SuspensionState()


def _update_suspension(now: datetime.datetime) -> None:
    cfg = _cfg["trains"]
    eligible = [t for t in tracker.active_trains.values()
                if isinstance(t, ActiveTrainData) and t.line == "京阪本線・鴨東線"
                and (pos := _line_position(t.location_col, t.location_row)) is not None
                and cfg.get("map_from_station", 4) <= pos <= cfg.get("map_to_station", 24)]
    ratio = sum(_is_unreliable(t) for t in eligible) / len(eligible) if eligible else None
    official = any(d.line.startswith("京阪") and d.status == "運転見合わせ" for d in latest_delay_data)
    suspended = _suspension.update(ratio, official, _stale_reason(now) is not None, now)
    global _last_unreliable_ratio
    _last_unreliable_ratio = ratio
    print(f"[line] ratio={ratio if ratio is not None else 'none'} suspended={suspended}")


def _direction_state(staying_minutes: list[float], next_delay: Optional[int], stopped_minutes: int) -> str:
    if not staying_minutes:
        return "none"
    stopped = sum(m >= stopped_minutes for m in staying_minutes)
    if stopped == len(staying_minutes):
        return "stopped"
    if stopped * 2 >= len(staying_minutes):
        return "many_stopped"
    if next_delay is not None and next_delay >= 5:
        return "delayed"
    return "normal"

latest_bus_data: List['BusInfo'] = []
latest_delay_data: List['DelayInfo'] = []
latest_delay_groups: List['DelayGroup'] = []
latest_bus_error: Optional[str] = None
latest_delay_error: Optional[str] = None
_last_bus_success: Optional[datetime.datetime] = None
_last_delay_success: Optional[datetime.datetime] = None
_last_unreliable_ratio: Optional[float] = None
_started_at = datetime.datetime.now(JST)
_operation_tracker = None
_operation_providers = None   # _operation_tracker を作ったときの delays.providers


def _load_config_file() -> dict:
    with open("config.yml", encoding="utf-8") as f:
        return yaml.safe_load(f)


templates = Jinja2Templates(directory="templates/minimal")


async def update_train_loop():
    while True:
        try:
            global _cfg
            _cfg = _load_config_file()
            print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Fetching train positions...")
            await _fetch_pos()
            global _first_position_time
            if _first_position_time is None:
                _first_position_time = tracker.position_created_at
            _update_suspension(datetime.datetime.now(JST))
            print("Train fetch complete.")
        except Exception as e:
            print(f"Error in train fetch: {e}")
        await asyncio.sleep(_cfg["intervals"]["train_seconds"])


async def update_bus_loop():
    global latest_bus_data, latest_bus_error, _last_bus_success
    while True:
        try:
            print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Fetching bus info...")
            bus_list = []
            platform_buses = []
            errors = []
            for num in _cfg["buses"]["stop_numbers"]:
                try:
                    res = await get_khbus_info(_cfg["buses"]["stop_name"], num)
                    if res and res.body and res.body.busstates:
                        for bus in res.body.busstates:
                            platform_buses.append((num, bus))
                            prms = bus.busstateprms
                            bus_list.append(BusInfo(
                                route_id=prms.route.replace("[", "").replace("]", ""),
                                destination=prms.destination,
                                status=prms.status,
                                arrival_time=prms.timetable,
                                stop_name=_cfg["buses"]["stop_name"],
                                stop_arrival_is_scheduled="定刻" in prms.timetable,
                            ))
                except Exception as e_inner:
                    errors.append(f"のりば{num}: {e_inner}")
                    print(f"Error fetching bus stop {num}: {e_inner}")

            if platform_buses:
                terminals = await bus_timetable.terminal_times(
                    _cfg["buses"]["stop_name"], platform_buses, datetime.datetime.now(JST))
                for bus, terminal in zip(bus_list, terminals):
                    if terminal is not None:
                        bus.terminal_arrival_time = terminal.time
                        bus.terminal_arrival_is_estimated = terminal.is_estimated

            def parse_time(b: 'BusInfo'):
                import re
                match = re.search(r'(\d{1,2}):(\d{2})', b.arrival_time)
                if match:
                    h, m = int(match.group(1)), int(match.group(2))
                    if h < 5:
                        h += 24
                    return h * 60 + m
                return 9999

            bus_list.sort(key=parse_time)
            if errors:
                # 取得失敗を「接近なし」として表示しない。次に全のりばを取得できるまで前回の表示を保つ。
                latest_bus_error = " / ".join(errors)
            else:
                latest_bus_data = bus_list
                latest_bus_error = None
                _last_bus_success = datetime.datetime.now(JST)
            print(f"Bus fetch complete (Count: {len(latest_bus_data)}).")
        except Exception as e:
            latest_bus_error = str(e)
            print(f"Error in bus fetch: {e}")
        await asyncio.sleep(_cfg["intervals"]["bus_seconds"])


async def update_delay_loop():
    global latest_delay_data, latest_delay_groups, latest_delay_error, _operation_tracker, _operation_providers, _last_delay_success
    while True:
        try:
            print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Fetching delay info...")
            # config.yml は列車のループが毎分読み直すので、取得先が変わったかはここで確かめる
            delay_cfg = _cfg.get("delays") or {}
            if _operation_tracker is None or delay_cfg.get("providers") != _operation_providers:
                _operation_tracker = operation_info.build_tracker(delay_cfg, snapshot_dir="/app/data/operation_snapshots")
                _operation_providers = delay_cfg.get("providers")
            rows, latest_delay_error = await operation_info.fetch(_operation_tracker, _cfg.get("delays") or {})
            latest_delay_data = [DelayInfo(**r) for r in rows]
            latest_delay_groups = [DelayGroup(**g) for g in operation_info.groups(_operation_tracker, delay_cfg)]
            _last_delay_success = datetime.datetime.now(JST)
            if latest_delay_error:
                print(f"Delay fetch partly failed: {latest_delay_error}")
            print(f"Delay fetch complete (Count: {len(latest_delay_data)}).")
        except Exception as e:
            latest_delay_error = str(e)
            print(f"Error in delay fetch: {e}")
        await asyncio.sleep(_cfg["intervals"]["delay_seconds"])


_weather: Optional[weather.WeatherWatcher] = None
# 取得できない時間がこれより長くなったら、古い警報を出し続けないよう札を消す
WEATHER_STALE = datetime.timedelta(minutes=10)


async def update_weather_loop():
    global _weather
    while True:
        cfg = _cfg.get("weather") or {}
        areas = cfg.get("areas") or weather.DEFAULT_AREAS
        try:
            if _weather is None or _weather.areas != list(areas):
                _weather = weather.WeatherWatcher(areas, user_agent="keihan_signage (+https://github.com/dk-butsuri/keihan_signage)")
            print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Fetching weather warnings...")
            await asyncio.to_thread(_weather.update)
            if _weather.error:
                print(f"Weather fetch partly failed: {_weather.error}")
            print("Weather fetch complete.")
        except Exception as e:
            if _weather is not None:
                _weather.error = str(e)
            print(f"Error in weather fetch: {e}")
        # 気象庁の高頻度フィードは60秒より短い間隔で読めない
        await asyncio.sleep(max(60, _cfg.get("intervals", {}).get("weather_seconds", 60)))


async def _reload_config() -> None:
    global _cfg
    old_features = dict(_cfg.get("features", {}))
    _cfg = _load_config_file()
    new_features = _cfg["features"]

    task_map = {
        "trains": (update_train_loop, True),
        "buses":  (update_bus_loop,  False),
        "delays": (update_delay_loop, False),
        "weather": (update_weather_loop, False),
    }
    for key, (loop_fn, needs_init) in task_map.items():
        was_on = old_features.get(key, True)
        is_on  = new_features.get(key, True)
        if was_on and not is_on:
            t = _tasks.pop(key, None)
            if t and not t.done():
                t.cancel()
        elif not was_on and is_on:
            if needs_init:
                try:
                    await _fetch_pos()
                except Exception as e:
                    print(f"Initial fetch on reload failed: {e}")
            _tasks[key] = asyncio.create_task(loop_fn())
        elif key == "delays" and is_on:
            # 運行情報は10分おきなので、設定を変えたらすぐ取り直す（取得先ごとの30秒制限はライブラリが守る）
            t = _tasks.pop(key, None)
            if t and not t.done():
                t.cancel()
            _tasks[key] = asyncio.create_task(loop_fn())


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _cfg
    _cfg = _load_config_file()
    print("Starting up... Initializing background fetchers.")

    if _cfg["features"]["trains"]:
        try:
            await _fetch_pos()
        except Exception as e:
            print(f"Initial train fetch failed: {e}")
        _tasks["trains"] = asyncio.create_task(update_train_loop())

    if _cfg["features"]["buses"]:
        _tasks["buses"] = asyncio.create_task(update_bus_loop())

    if _cfg["features"]["delays"]:
        _tasks["delays"] = asyncio.create_task(update_delay_loop())

    if _cfg["features"].get("weather", True):
        _tasks["weather"] = asyncio.create_task(update_weather_loop())

    yield

    print("Shutting down...")
    for t in _tasks.values():
        t.cancel()
    await asyncio.gather(*_tasks.values(), return_exceptions=True)


app = FastAPI(lifespan=lifespan)
app.include_router(demo_router)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://local.koriwallpaper"],
    allow_methods=["GET"],
)


# --- Pydantic Models ---

class TrainInfo(BaseModel):
    kind: str
    destination: str
    time: str
    estimated_time: Optional[str] = None
    delay: int
    estimated_delay_minutes: Optional[int] = None
    status: str
    minutes_remaining: Optional[int] = None
    is_this_station: bool = False
    position: Optional[str] = None
    raw_time: Optional[datetime.datetime] = None
    estimate_unreliable: bool = False
    sub_station_name: Optional[str] = None
    sub_station_time: Optional[str] = None
    sub_station_verb: Optional[str] = None
    position_text: Optional[str] = None
    stopped_minutes: Optional[int] = None
    is_active: bool = False

class StationResponse(BaseModel):
    station_name: str
    up_trains: List[TrainInfo]
    down_trains: List[TrainInfo]
    error: Optional[str] = None


def _position_view(train: ActiveTrainData, stopped_minutes: int, stop_threshold: int) -> str:
    _, st1, st2 = calc_position(train.location_col, train.location_row)
    stopped = stopped_minutes >= stop_threshold and not train.is_at_start_station
    stopped_text = None
    if stopped:
        lower_bound = "以上" if train.position_since == _first_position_time else ""
        stopped_text = f"停止{stopped_minutes}分{lower_bound}"
    if st2 is None:
        here = tracker.stations[st1]
        is_stop = any(s.station == here for s in train.stop_stations)
        if is_stop:
            text = f"{here.station_name.ja}に停車中"
        else:
            text = f"{here.station_name.ja}で停止" if stopped else f"{here.station_name.ja}を通過中"
    else:
        ref = train.next_station.station_number
        prev = st1 if st2 == ref else st2
        text = f"{tracker.stations[prev].station_name.ja}→{tracker.stations[ref].station_name.ja}"
        if stopped:
            text += "で停止"
    if stopped_text:
        text += f"（{stopped_text}）"
    return text


def _apply_leading_estimate_mask(trains: list) -> None:
    if len(trains) < 2:
        return
    if not trains[0].estimate_unreliable:
        return
    for i in range(1, len(trains)):
        if not trains[i].is_active:
            trains[i] = trains[i].model_copy(update={
                "minutes_remaining": None,
                "estimate_unreliable": True,
            })

class BusInfo(BaseModel):
    route_id: str
    destination: str
    status: str
    arrival_time: str
    stop_name: str = ""
    stop_arrival_is_scheduled: bool = False
    terminal_arrival_time: Optional[str] = None
    terminal_arrival_is_estimated: bool = False

class BusResponse(BaseModel):
    buses: List[BusInfo]
    error: Optional[str] = None

class DelayInfo(BaseModel):
    line: str
    status: str
    detail: str
    announced_time: Optional[datetime.datetime] = None

class DelayGroupLine(BaseModel):
    name: str
    status: str
    ticker_name: str
    detail: str
    announced_time: Optional[datetime.datetime] = None

class DelayGroup(BaseModel):
    mark: str
    name: str
    status: str
    lines: List[DelayGroupLine] = Field(default_factory=list)

class DelayResponse(BaseModel):
    delays: List[DelayInfo]
    groups: List[DelayGroup] = Field(default_factory=list)
    error: Optional[str] = None


class LineStation(BaseModel):
    number: int
    name: str


class LineTrain(BaseModel):
    direction: Literal["up", "down"]
    position: float
    kind: str
    delay: int
    estimated_delay_minutes: Optional[int] = None
    stopped_minutes: Optional[int] = None
    stopped_lower_bound: bool = False


class OutsideCounts(BaseModel):
    up_osaka: int = 0
    down_osaka: int = 0
    up_kyoto: int = 0
    down_kyoto: int = 0


class DirectionView(BaseModel):
    state: Literal["none", "stopped", "many_stopped", "delayed", "normal"]
    next: List[TrainInfo]


class LineDirections(BaseModel):
    up: DirectionView
    down: DirectionView


class LineResponse(BaseModel):
    suspended: bool
    as_of: str
    total: int
    stopped: int
    station_id: int
    stations: List[LineStation]
    trains: List[LineTrain]
    outside: OutsideCounts
    outside_stopped: OutsideCounts
    directions: LineDirections
    compress_ranges: List[List[int]] = []
    error: Optional[str] = None

def _sub_station_fields(train, station) -> dict:
    sub_id = _cfg["trains"].get("sub_station_id")
    if sub_id is None:
        return {}
    stops = [s for s in train.stop_stations if s.is_stop]
    sub_index = next((i for i, s in enumerate(stops) if s.station.station_number == sub_id), None)
    main_index = next((i for i, s in enumerate(stops) if s.station.station_number == station.station_number), None)
    if sub_index is None or main_index is None or stops[sub_index].time is None:
        return {}
    sub = stops[sub_index]
    return {
        "sub_station_name": sub.station.station_name.ja,
        "sub_station_time": (sub.time + datetime.timedelta(minutes=train.delay_minutes)).strftime("%H:%M"),
        "sub_station_verb": "着",
    }


def _line_train_fields(train, unreliable: bool) -> dict:
    if not isinstance(train, ActiveTrainData):
        return {}
    _, st1, st2 = calc_position(train.location_col, train.location_row)
    if st2 is None:
        here = tracker.stations[st1]
        is_stop = any(s.is_stop and s.station.station_number == st1 for s in train.stop_stations)
        suffix = "に停車中" if is_stop else ("で停止" if unreliable else "を通過中")
        text = here.station_name.ja + suffix
    else:
        ref = train.next_station.station_number
        prev = st1 if st2 == ref else st2
        text = f"{tracker.stations[prev].station_name.ja} → {tracker.stations[ref].station_name.ja} の間"
    return {"position_text": text, "stopped_minutes": _stopped_minutes(train)}


def _ordered_trains(station, min_minutes: int, max_per_dir: int, include_position: bool = False):
    up_trains_list = []
    down_trains_list = []
    now = datetime.datetime.now(JST)
    stop_threshold = _cfg["trains"].get("stopped_minutes_threshold", 5)
    station_row = _station_row(_cfg["trains"]["station_id"])
    blockers = _barely_moving_rows()

    for train, stop_data in station.upcoming_trains:
        if not stop_data.time:
            continue
        departure_time = stop_data.time
        delay = train.delay_minutes
        # 2時間を超えると公式は「2時間以上」とだけ返し、ライブラリは下限の120分とする
        over_hours = delay >= 120
        estimated_delay = _estimated_delay_minutes(train)
        expected_time = departure_time + datetime.timedelta(minutes=delay)
        remaining = (expected_time - now).total_seconds() / 60
        estimated_time = departure_time + datetime.timedelta(minutes=round(_corrected_delay_minutes(remaining, delay)))
        minutes_val: Optional[int] = int((estimated_time - now).total_seconds() / 60)

        position_unreliable = _is_unreliable(train)
        blocked = _blocked_ahead(train, station_row, blockers)
        filter_minutes = None if position_unreliable or blocked else minutes_val
        unreliable = position_unreliable or blocked or (delay >= 1 and not _within_estimate_window(remaining, delay))
        if unreliable:
            minutes_val = None

        status_text = ""
        is_this_station = (
            isinstance(train, ActiveTrainData)
            and train.is_stopping is True
            and train.next_stop_station == station
        )
        if over_hours:
            status_text = f"遅れ{estimated_delay}分以上" if estimated_delay and estimated_delay > 120 else "遅れ2時間以上"
        elif delay > 0:
            status_text = f"遅れ約{delay}分"
        elif is_this_station:
            status_text = "当駅停車中"

        # 見込みを出さない列車は、代わりに位置で示す
        position_text = None
        if unreliable and isinstance(train, ActiveTrainData) and not is_this_station:
            try:
                stopped_minutes = int(train.staying_time.total_seconds() // 60)
                position_text = _position_view(train, stopped_minutes, stop_threshold)
            except Exception as e_pos:
                print(f"[position] error: {e_pos}")
        elif is_this_station and status_text != "当駅停車中":
            position_text = "当駅に停車中"
            minutes_val = None

        destination = train.destination
        info = TrainInfo(
            kind=train.train_type.value,
            destination=destination.station_name.ja if destination is not None else "不明",
            time=departure_time.strftime("%H:%M"),
            estimated_time=None if unreliable or over_hours else estimated_time.strftime("%H:%M"),
            delay=delay,
            estimated_delay_minutes=estimated_delay,
            status=status_text,
            minutes_remaining=minutes_val,
            is_this_station=is_this_station,
            position=position_text,
            raw_time=departure_time,
            estimate_unreliable=unreliable,
            **_sub_station_fields(train, station),
            **(_line_train_fields(train, position_unreliable) if include_position else {}),
            is_active=isinstance(train, ActiveTrainData),
        )
        if min_minutes > 0 and is_this_station:
            continue
        if filter_minutes is not None and filter_minutes < min_minutes and not is_this_station:
            continue
        if train.direction == "up":
            up_trains_list.append(info)
        else:
            down_trains_list.append(info)

    up_trains_list.sort(key=lambda x: x.raw_time if x.raw_time else datetime.datetime.max.replace(tzinfo=JST))
    down_trains_list.sort(key=lambda x: x.raw_time if x.raw_time else datetime.datetime.max.replace(tzinfo=JST))

    _apply_leading_estimate_mask(up_trains_list)
    _apply_leading_estimate_mask(down_trains_list)

    return up_trains_list[:max_per_dir], down_trains_list[:max_per_dir]

# --- Endpoints ---

@app.api_route("/assets/{name}", methods=["GET", "HEAD"])
async def screen_asset(name: str):
    if name not in ("assembly.js", "opening.js", "weather.js"):
        raise HTTPException(404, "Asset not found")
    return FileResponse(Path(__file__).parent / "templates" / "minimal" / name,
                        media_type="text/javascript", headers={"Cache-Control": "no-store"})


@app.head("/")
async def head_root():
    return Response(status_code=200)

@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    try:
        cfg = _load_config_file()
        station_id = cfg["trains"]["station_id"]
        station_name = tracker.stations[station_id].station_name.ja
    except (KeyError, AttributeError):
        station_name = ""
    return templates.TemplateResponse(request, "index.html", {
        "station_name": station_name,
        "config": {"features": _cfg["features"], "buses": {"stop_name": _cfg["buses"]["stop_name"]}},
    })

@app.post("/api/config/reload")
async def config_reload():
    await _reload_config()
    return {"ok": True}

@app.get("/api/trains", response_model=StationResponse)
async def get_trains():
    try:
        station_id = _cfg["trains"]["station_id"]
        station = tracker.stations[station_id]
        # 取得に失敗し続けても列車の状態は最後に取得できたときのまま残るので、位置情報の作成時刻で古さを判断する
        stale = _stale_reason(datetime.datetime.now(JST))
        if stale:
            return StationResponse(station_name=station.station_name.ja, up_trains=[], down_trains=[], error=stale)
        up, down = _ordered_trains(station, _cfg["trains"]["min_minutes_until"], _cfg["trains"]["max_trains_per_direction"])
        return StationResponse(station_name=station.station_name.ja, up_trains=up, down_trains=down)
    except Exception as e:
        print(f"Error in /api/trains: {e}")
        try:
            fallback_name = tracker.stations[_cfg["trains"]["station_id"]].station_name.ja
        except Exception:
            fallback_name = ""
        return StationResponse(station_name=fallback_name, up_trains=[], down_trains=[], error=str(e))

@app.get("/api/line", response_model=LineResponse)
async def get_line():
    cfg = _cfg["trains"]
    station = tracker.stations[cfg["station_id"]]
    start, end = cfg.get("map_from_station", 4), cfg.get("map_to_station", 24)
    stale = _stale_reason(datetime.datetime.now(JST))
    active = [t for t in tracker.active_trains.values()
              if isinstance(t, ActiveTrainData) and t.line == "京阪本線・鴨東線"]
    outside = OutsideCounts()
    outside_stopped = OutsideCounts()
    trains = []
    stopped_count = 0
    for train in active:
        stopped_minutes = _stopped_minutes(train)
        if stopped_minutes is not None:
            stopped_count += 1
        pos = _line_position(train.location_col, train.location_row)
        if pos is None:
            continue
        if start <= pos <= end:
            trains.append(LineTrain(
                direction=train.direction, position=pos, kind=train.train_type.value, delay=train.delay_minutes,
                estimated_delay_minutes=_estimated_delay_minutes(train),
                stopped_minutes=stopped_minutes,
                stopped_lower_bound=train.position_since == _first_position_time,
            ))
        else:
            key = train.direction + ("_osaka" if pos < start else "_kyoto")
            setattr(outside, key, getattr(outside, key) + 1)
            if stopped_minutes is not None:
                setattr(outside_stopped, key, getattr(outside_stopped, key) + 1)
    up, down = _ordered_trains(station, 0, 2, include_position=True) if not stale else ([], [])
    directions = {}
    for direction, upcoming in (("up", up), ("down", down)):
        staying = [t.staying_time.total_seconds() / 60 for t, _ in station.upcoming_trains
                   if isinstance(t, ActiveTrainData) and t.direction == direction and not t.is_at_start_station]
        directions[direction] = DirectionView(
            state=_direction_state(staying, upcoming[0].delay if upcoming else None, cfg.get("direction_stopped_minutes", 10)),
            next=upcoming,
        )
    raw_ranges = cfg.get("map_compress_ranges")
    if raw_ranges is None:
        single = (cfg.get("map_compress_from"), cfg.get("map_compress_to"))
        raw_ranges = [single] if None not in single else []
    compress_ranges = []
    for pair in raw_ranges:
        if isinstance(pair, (list, tuple)) and len(pair) == 2:
            f, t = pair
            if isinstance(f, int) and isinstance(t, int) and f < t:
                compress_ranges.append([f, t])
    return LineResponse(
        suspended=bool(cfg.get("force_suspended", False) or _suspension.suspended),
        as_of=_last_pos_success.strftime("%H:%M:%S") if _last_pos_success else "—",
        total=len(active), stopped=stopped_count, station_id=cfg["station_id"],
        stations=[LineStation(number=n, name=tracker.stations[n].station_name.ja) for n in range(start, end + 1)],
        trains=trains if not stale else [], outside=outside, outside_stopped=outside_stopped,
        directions=LineDirections(**directions), compress_ranges=compress_ranges, error=stale,
    )


@app.get("/api/buses", response_model=BusResponse)
async def get_buses():
    return BusResponse(buses=latest_bus_data, error=latest_bus_error)

@app.get("/api/delays", response_model=DelayResponse)
async def get_delays():
    groups = latest_delay_groups or [DelayGroup(**g) for g in operation_info.groups(None, _cfg.get("delays") or {})]
    return DelayResponse(delays=latest_delay_data, groups=groups, error=latest_delay_error)

@app.get("/api/weather")
async def get_weather():
    now = datetime.datetime.now(JST)
    enabled = _cfg.get("features", {}).get("weather", True)
    w = _weather
    fresh = bool(w and w.summary is not None and w.last_success and now - w.last_success <= WEATHER_STALE)
    summary = w.summary if fresh else None
    return {
        "enabled": enabled,
        "available": enabled and fresh,
        "as_of": w.last_success.astimezone(JST).strftime("%H:%M") if fresh else None,
        "warnings": summary["warnings"] if summary else [],
        "previews": summary["previews"] if summary else [],
        **weather.area_labels(w.areas if w else (_cfg.get("weather") or {}).get("areas") or weather.DEFAULT_AREAS),
        "error": w.error if w else None,
    }

@app.get("/api/status")
async def get_status():
    """管理画面向けに、各情報を最後に取得できた時刻と、いまの判定をまとめて返す。"""
    now = datetime.datetime.now(JST)
    features = _cfg.get("features", {})
    iso = lambda t: t.isoformat() if t else None
    return {
        "now": now.isoformat(),
        "started_at": _started_at.isoformat(),
        "trains": {
            "enabled": features.get("trains", True),
            "last_success": iso(_last_pos_success),
            "position_created_at": iso(tracker.position_created_at),
            "active": len(tracker.active_trains),
            "error": _stale_reason(now),
            "suspended": bool(_cfg.get("trains", {}).get("force_suspended", False) or _suspension.suspended),
            "forced": bool(_cfg.get("trains", {}).get("force_suspended", False)),
            "unreliable_ratio": _last_unreliable_ratio,
            "interval_seconds": _cfg.get("intervals", {}).get("train_seconds"),
        },
        "buses": {
            "enabled": features.get("buses", True),
            "last_success": iso(_last_bus_success),
            "count": len(latest_bus_data),
            "error": latest_bus_error,
            "interval_seconds": _cfg.get("intervals", {}).get("bus_seconds"),
        },
        "delays": {
            "enabled": features.get("delays", True),
            "last_success": iso(_last_delay_success),
            "affected": len(latest_delay_data),
            "error": latest_delay_error,
            "interval_seconds": _cfg.get("intervals", {}).get("delay_seconds"),
        },
        "weather": {
            "enabled": features.get("weather", True),
            "last_success": iso(_weather.last_success if _weather else None),
            "warnings": len(_weather.summary["warnings"]) if _weather and _weather.summary else 0,
            "error": _weather.error if _weather else None,
            "interval_seconds": max(60, _cfg.get("intervals", {}).get("weather_seconds", 60)),
        },
    }

# ホストが NTP で同期しているので、自前で NTP に問い合わせない（待つ間の分だけ表示が進んでいた）
@app.get("/api/time")
async def get_time():
    from fastapi.responses import JSONResponse
    return JSONResponse(content={"ts": time.time()}, headers={"Cache-Control": "no-store"})

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False)
