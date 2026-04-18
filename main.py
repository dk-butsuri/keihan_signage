from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles # type: ignore
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from typing import List, Optional
import datetime
import asyncio
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

from zoneinfo import ZoneInfo  # 追加
JST = ZoneInfo("Asia/Tokyo")

tracker = KHTracker()

latest_bus_data: List['BusInfo'] = []
latest_delay_data: List['DelayInfo'] = []

async def update_train_loop():
    """Background task to fetch train data every minute."""
    while True:
        try:
            print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Fetching train positions...")
            await tracker.fetch_pos()
            print("Train fetch complete.")
        except Exception as e:
            print(f"Error in train fetch: {e}")
        await asyncio.sleep(60)

async def update_bus_loop():
    """Background task to fetch bus data every minute."""
    global latest_bus_data
    while True:
        try:
            print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Fetching bus info...")
            
            # Logic moved from get_buses
            bus_list = []
            target_stop = "同志社香里"
            stop_nums = [1, 2] # Both directions
            
            for num in stop_nums:
                try:
                    res = await get_khbus_info(target_stop, num)
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
                    pass

            # Sort logic: Keihan Tracker's bus info doesn't provide date, 
            # so we assume times from 00:00 to 04:00 are NEXT DAY if current time is late night.
            def parse_time(b: BusInfo):
                import re
                match = re.search(r'(\d{1,2}):(\d{2})', b.arrival_time)
                if match:
                    h, m = int(match.group(1)), int(match.group(2))
                    # If hour is small (0-4), treat it as 24+ for sorting
                    if h < 5:
                        h += 24
                    return h * 60 + m
                return 9999

            try:
                bus_list.sort(key=parse_time)
            except Exception as e:
                print(f"Error sorting bus list: {e}")
            
            latest_bus_data = bus_list
            print(f"Bus fetch complete (Count: {len(bus_list)}).")
            
        except Exception as e:
            print(f"Error in bus fetch: {e}")
        
        await asyncio.sleep(60)

async def update_delay_loop():
    """Background task to fetch delay info every 2 minutes."""
    global latest_delay_data
    while True:
        try:
            print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Fetching delay info...")
            results = []
            #delays = await get_ekispert_delay(environ["EKISPERT_API_KEY"])
            delays = await get_yahoo_delay()
            delays = await delay_ai.convert(delays,bypass=False)
            for d in delays:
                results.append(DelayInfo(
                    line=d.LineName,
                    status=d.InfoType,
                    detail=d.detail,
                    announced_time=d.AnnouncedTime
                ))
            
            # Keep debug data if user wants (Optional, leaving out for now based on user edit history removing it)
            # If needed, add critical debug lines here.
            
            latest_delay_data = results
            print(f"Delay fetch complete (Count: {len(results)}).")
        except Exception as e:
            print(f"Error in delay fetch: {e}")

        await asyncio.sleep(600)

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Handle startup and shutdown events.
    Starts background data fetch loops.
    """
    print("Starting up... Initializing background fetchers.")

    # Initial fetches for immediate availability
    try:
        await tracker.fetch_pos()
    except Exception as e:
        print(f"Initial train fetch failed: {e}")
        
    task_train = asyncio.create_task(update_train_loop())
    task_bus = asyncio.create_task(update_bus_loop())
    task_delay = asyncio.create_task(update_delay_loop())
    
    yield
    
    print("Shutting down...")
    task_train.cancel()
    task_bus.cancel()
    task_delay.cancel()
    
    try:
        # Await all
        await asyncio.gather(task_train, task_bus, task_delay, return_exceptions=True)
    except asyncio.CancelledError:
        pass

app = FastAPI(lifespan=lifespan)
templates = Jinja2Templates(directory="templates")

# --- Pydantic Models ---

class TrainInfo(BaseModel):
    kind: str
    destination: str
    time: str
    delay: int
    status: str
    minutes_until: str = "" # "あとX分"
    minutes_remaining: Optional[int] = None # For styling logic
    is_this_station: bool = False
    raw_time: Optional[datetime.datetime] = None # For sorting

class StationResponse(BaseModel):
    station_name: str
    up_trains: List[TrainInfo]   # Toward Kyoto
    down_trains: List[TrainInfo] # Toward Osaka

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

@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/api/trains", response_model=StationResponse)
async def get_trains():
    """
    Get train departures for Korien Station (KH18).
    Includes logic to sort by time and separate by direction.
    """
    try:
        # Data is fetched in background, just read the state
        station = tracker.stations[18] # KH18: Korien
        
        up_trains_list = []
        down_trains_list = []
        
        # upcoming_trains contains trains that are scheduled to stop here
        now = datetime.datetime.now(JST)
        
        for train, stop_data in station.upcoming_trains:
            # stop_data.time is likely datetime.datetime
            if not stop_data.time:
                continue
            departure_time = stop_data.time
            time_str = "--:--"
            minutes_str = ""
            minutes_val = None
            effective_delay = train.delay_minutes

            time_str = departure_time.strftime("%H:%M")
            
            # Calculate expected arrival (Scheduled + Delay)
            expected_time = departure_time + datetime.timedelta(minutes=effective_delay)
            
            # Calculate diff from NOW to EXPECTED
            diff = expected_time - now
            minutes_val = int(diff.total_seconds() / 60)
            
            if minutes_val >= 0:
                minutes_str = f"あと{minutes_val}分"
            else:
                minutes_str = "まもなく" 

            # Simple status logic
            status_text = ""
            if effective_delay > 0:
                status_text = f"遅れ約{effective_delay}分"
            elif isinstance(train, ActiveTrainData):
                if train.is_stopping and train.next_stop_station == station:
                     status_text = "当駅停車中"
            
            info = TrainInfo(
                kind=train.train_type.value,
                destination=train.destination.station_name.ja,
                time=time_str,
                delay=effective_delay,
                status=status_text,
                minutes_until=minutes_str,
                minutes_remaining=minutes_val,
                raw_time=departure_time
            )
            if minutes_val < 20:
                continue
            if train.direction == "up": # Kyoto
                up_trains_list.append(info)
            else: # down (Osaka)
                down_trains_list.append(info)
                
        # Sort by raw_time (datetime)
        up_trains_list.sort(key=lambda x: x.raw_time if x.raw_time else datetime.datetime.max.replace(tzinfo=JST))
        down_trains_list.sort(key=lambda x: x.raw_time if x.raw_time else datetime.datetime.max.replace(tzinfo=JST))

        return StationResponse(
            station_name=station.station_name.ja,
            up_trains=up_trains_list[:6], # Show top 6
            down_trains=down_trains_list[:6]
        )
    except Exception as e:
        print(f"Error in /api/trains: {e}")
        return StationResponse(station_name="香里園(エラー)", up_trains=[], down_trains=[])

@app.get("/api/buses", response_model=List[BusInfo])
async def get_buses():
    """
    Get cached bus info.
    """
    return latest_bus_data

@app.get("/api/delays", response_model=List[DelayInfo])
async def get_delays():
    """
    Get cached delay info.
    """
    return latest_delay_data

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False)
