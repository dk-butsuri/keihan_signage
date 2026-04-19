from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles # type: ignore
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel
from typing import List, Optional
import datetime
import asyncio
import yaml
from time_sync import get_ntp_time
from keihan_tracker import KHTracker
from keihan_tracker.keihan_train.schemes import TrainType
from keihan_tracker.keihan_train.tracker import ActiveTrainData
import delay_ai
import dotenv
dotenv.load_dotenv()
from os import environ
from keihan_tracker.bus.tracker import get_khbus_info
from keihan_tracker.delay_tracker import get_yahoo_delay
from keihan_tracker.delay_tracker import get_ekispert_delay

from zoneinfo import ZoneInfo
JST = ZoneInfo("Asia/Tokyo")

_cfg: dict = {}
_tasks: dict[str, asyncio.Task] = {}
_templates_cache: Optional[Jinja2Templates] = None
_templates_theme: str = ""

tracker = KHTracker()

latest_bus_data: List['BusInfo'] = []
latest_delay_data: List['DelayInfo'] = []


def _load_config_file() -> dict:
    with open("config.yml", encoding="utf-8") as f:
        return yaml.safe_load(f)


def _get_templates() -> Jinja2Templates:
    global _templates_cache, _templates_theme
    theme = _cfg["design"]["theme"]
    if _templates_cache is None or _templates_theme != theme:
        _templates_cache = Jinja2Templates(directory=f"templates/{theme}")
        _templates_theme = theme
    return _templates_cache


async def update_train_loop():
    while True:
        try:
            print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Fetching train positions...")
            await tracker.fetch_pos()
            print("Train fetch complete.")
        except Exception as e:
            print(f"Error in train fetch: {e}")
        await asyncio.sleep(_cfg["intervals"]["train_seconds"])


async def update_bus_loop():
    global latest_bus_data
    while True:
        try:
            print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Fetching bus info...")
            bus_list = []
            for num in _cfg["buses"]["stop_numbers"]:
                try:
                    res = await get_khbus_info(_cfg["buses"]["stop_name"], num)
                    if res and res.body and res.body.busstates:
                        for bus in res.body.busstates:
                            prms = bus.busstateprms
                            bus_list.append(BusInfo(
                                route_id=prms.route.replace("[", "").replace("]", ""),
                                destination=prms.destination,
                                status=prms.status,
                                arrival_time=prms.timetable
                            ))
                except Exception as e_inner:
                    print(f"Error fetching bus stop {num}: {e_inner}")

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
            latest_bus_data = bus_list
            print(f"Bus fetch complete (Count: {len(bus_list)}).")
        except Exception as e:
            print(f"Error in bus fetch: {e}")
        await asyncio.sleep(_cfg["intervals"]["bus_seconds"])


async def update_delay_loop():
    global latest_delay_data
    while True:
        try:
            print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Fetching delay info...")
            if _cfg["delays"]["source"] == "ekispert":
                delays = await get_ekispert_delay(environ["EKISPERT_API_KEY"])
            else:
                delays = await get_yahoo_delay()
            delays = await delay_ai.convert(delays, bypass=not _cfg["delays"]["use_ai"])
            latest_delay_data = [
                DelayInfo(
                    line=d.LineName,
                    status=d.InfoType,
                    detail=d.detail,
                    announced_time=d.AnnouncedTime
                ) for d in delays
            ]
            print(f"Delay fetch complete (Count: {len(latest_delay_data)}).")
        except Exception as e:
            print(f"Error in delay fetch: {e}")
        await asyncio.sleep(_cfg["intervals"]["delay_seconds"])


async def _reload_config() -> None:
    global _cfg
    old_features = dict(_cfg.get("features", {}))
    _cfg = _load_config_file()
    new_features = _cfg["features"]

    task_map = {
        "trains": (update_train_loop, True),
        "buses":  (update_bus_loop,  False),
        "delays": (update_delay_loop, False),
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
                    await tracker.fetch_pos()
                except Exception as e:
                    print(f"Initial fetch on reload failed: {e}")
            _tasks[key] = asyncio.create_task(loop_fn())


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _cfg
    _cfg = _load_config_file()
    print("Starting up... Initializing background fetchers.")

    if _cfg["features"]["trains"]:
        try:
            await tracker.fetch_pos()
        except Exception as e:
            print(f"Initial train fetch failed: {e}")
        _tasks["trains"] = asyncio.create_task(update_train_loop())

    if _cfg["features"]["buses"]:
        _tasks["buses"] = asyncio.create_task(update_bus_loop())

    if _cfg["features"]["delays"]:
        _tasks["delays"] = asyncio.create_task(update_delay_loop())

    yield

    print("Shutting down...")
    for t in _tasks.values():
        t.cancel()
    await asyncio.gather(*_tasks.values(), return_exceptions=True)


app = FastAPI(lifespan=lifespan)


# --- Pydantic Models ---

class TrainInfo(BaseModel):
    kind: str
    destination: str
    time: str
    delay: int
    status: str
    minutes_until: str = ""
    minutes_remaining: Optional[int] = None
    is_this_station: bool = False
    raw_time: Optional[datetime.datetime] = None

class StationResponse(BaseModel):
    station_name: str
    up_trains: List[TrainInfo]
    down_trains: List[TrainInfo]

class BusInfo(BaseModel):
    route_id: str
    destination: str
    status: str
    arrival_time: str

class DelayInfo(BaseModel):
    line: str
    status: str
    detail: str
    announced_time: Optional[datetime.datetime] = None


# --- Endpoints ---

@app.head("/")
async def head_root():
    return Response(status_code=200)

@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    return _get_templates().TemplateResponse(request, "index.html")

@app.post("/api/config/reload")
async def config_reload():
    await _reload_config()
    return {"ok": True, "theme": _cfg["design"]["theme"]}

@app.get("/api/trains", response_model=StationResponse)
async def get_trains():
    try:
        station_id = _cfg["trains"]["station_id"]
        station = tracker.stations[station_id]
        up_trains_list = []
        down_trains_list = []
        now = datetime.datetime.now(JST)
        min_minutes = _cfg["trains"]["min_minutes_until"]
        max_per_dir = _cfg["trains"]["max_trains_per_direction"]

        for train, stop_data in station.upcoming_trains:
            if not stop_data.time:
                continue
            departure_time = stop_data.time
            effective_delay = train.delay_minutes
            expected_time = departure_time + datetime.timedelta(minutes=effective_delay)
            diff = expected_time - now
            minutes_val = int(diff.total_seconds() / 60)
            minutes_str = f"あと{minutes_val}分" if minutes_val >= 0 else "まもなく"

            status_text = ""
            if effective_delay > 0:
                status_text = f"遅れ約{effective_delay}分"
            elif isinstance(train, ActiveTrainData):
                if train.is_stopping and train.next_stop_station == station:
                    status_text = "当駅停車中"

            info = TrainInfo(
                kind=train.train_type.value,
                destination=train.destination.station_name.ja,
                time=departure_time.strftime("%H:%M"),
                delay=effective_delay,
                status=status_text,
                minutes_until=minutes_str,
                minutes_remaining=minutes_val,
                raw_time=departure_time
            )
            if minutes_val < min_minutes:
                continue
            if train.direction == "up":
                up_trains_list.append(info)
            else:
                down_trains_list.append(info)

        up_trains_list.sort(key=lambda x: x.raw_time if x.raw_time else datetime.datetime.max.replace(tzinfo=JST))
        down_trains_list.sort(key=lambda x: x.raw_time if x.raw_time else datetime.datetime.max.replace(tzinfo=JST))

        return StationResponse(
            station_name=station.station_name.ja,
            up_trains=up_trains_list[:max_per_dir],
            down_trains=down_trains_list[:max_per_dir]
        )
    except Exception as e:
        print(f"Error in /api/trains: {e}")
        return StationResponse(station_name="香里園(エラー)", up_trains=[], down_trains=[])

@app.get("/api/buses", response_model=List[BusInfo])
async def get_buses():
    return latest_bus_data

@app.get("/api/delays", response_model=List[DelayInfo])
async def get_delays():
    return latest_delay_data

@app.get("/api/time")
async def get_time():
    from fastapi.responses import JSONResponse
    data = await asyncio.to_thread(get_ntp_time)
    return JSONResponse(content=data, headers={"Cache-Control": "no-store"})

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False)
