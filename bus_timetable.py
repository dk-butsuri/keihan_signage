import asyncio
import datetime
import re
import time
from dataclasses import dataclass

import httpx
from keihan_tracker.bus.tracker import fetch_diagram


@dataclass(frozen=True, slots=True)
class TerminalArrival:
    time: str
    is_estimated: bool


_cache = {}


def _name(value):
    return re.sub(r"〔[^〕]*〕|［[^］]*］", "", value).strip().removesuffix("行")


def _minutes(value):
    match = re.fullmatch(r"([0-9]{1,2}):([0-5][0-9])", value or "")
    if match and int(match[1]) < 48:
        return (int(match[1]) * 60 + int(match[2])) % 1440
    return None


def _terminal_time(diagram, stop_name, destination):
    stops = diagram.stops
    if not stops or _name(stops[-1].stop_name) != _name(destination):
        return None
    _, hour, minute = diagram.dgmpl.rsplit(":", 2)
    departure = _minutes(f"{int(hour):02d}:{int(minute):02d}")
    if departure is None or not any(_name(stop.stop_name) == _name(stop_name)
                                   and _minutes(stop.departure_time) == departure for stop in stops):
        return None
    terminal = stops[-1]
    minutes = _minutes(terminal.arrival_time)
    if minutes is None:
        return None
    return TerminalArrival(f"{minutes // 60:02d}:{minutes % 60:02d}", terminal.arrival_is_estimated)


async def terminal_times(stop_name, platform_buses, now: datetime.datetime):
    current = time.monotonic()
    for key, (expires, _) in list(_cache.items()):
        if expires <= current or key[0] != now.date():
            del _cache[key]
    semaphore = asyncio.Semaphore(3)

    async def lookup(platform, bus):
        dgmpl = bus.dgmpl
        if not dgmpl:
            return None
        destination = bus.busstateprms.destination
        key = (now.date(), stop_name, platform, dgmpl, destination)
        if key in _cache:
            return _cache[key][1]
        result = None
        try:
            async with semaphore:
                diagram = await asyncio.wait_for(fetch_diagram(dgmpl), timeout=6)
                result = _terminal_time(diagram, stop_name, destination)
        except (httpx.HTTPError, ValueError, TimeoutError) as exc:
            print(f"Bus terminal timetable unavailable: {type(exc).__name__}")
        if len(_cache) >= 512:
            del _cache[next(iter(_cache))]
        _cache[key] = (time.monotonic() + (86400 if result else 300), result)
        return result

    return await asyncio.gather(*(lookup(platform, bus) for platform, bus in platform_buses))
