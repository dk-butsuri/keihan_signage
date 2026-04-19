import asyncio
import json
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import AsyncGenerator, Optional

import httpx
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.templating import Jinja2Templates
from time_sync import get_ntp_time

TRANSIT_URL = os.getenv("TRANSIT_URL", "http://transit:8000")
CLOCK_URL = os.getenv("CLOCK_URL", "http://clock:80")
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "changeme")
DATA_DIR = Path(os.getenv("DATA_DIR", "/app/data"))
SCHEDULE_FILE = DATA_DIR / "schedule.json"

VALID_MODES = {"transit", "clock"}
SERVICE_URLS = {"transit": TRANSIT_URL, "clock": CLOCK_URL}

app = FastAPI()
templates = Jinja2Templates(directory="templates")

current_mode: str = "transit"
manual_override_until: Optional[datetime] = None
subscribers: list[asyncio.Queue] = []


def load_schedule() -> dict:
    if SCHEDULE_FILE.exists():
        return json.loads(SCHEDULE_FILE.read_text(encoding="utf-8"))
    return {"default_mode": "transit", "rules": []}


def save_schedule(data: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SCHEDULE_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


async def broadcast_mode(mode: str) -> None:
    for q in subscribers:
        await q.put(mode)


async def schedule_loop() -> None:
    global current_mode, manual_override_until
    while True:
        await asyncio.sleep(30)
        try:
            if manual_override_until and datetime.now() < manual_override_until:
                continue
            manual_override_until = None
            sched = load_schedule()
            now = datetime.now()
            now_str = f"{now.hour:02d}:{now.minute:02d}"
            matched_mode = sched.get("default_mode", "transit")
            for rule in sorted(sched.get("rules", []), key=lambda r: r["time"]):
                if rule["time"] <= now_str:
                    matched_mode = rule["mode"]
            if matched_mode != current_mode:
                current_mode = matched_mode
                await broadcast_mode(current_mode)
        except Exception:
            pass


@app.on_event("startup")
async def startup() -> None:
    global current_mode
    sched = load_schedule()
    current_mode = sched.get("default_mode", "transit")
    asyncio.create_task(schedule_loop())


@app.get("/", response_class=HTMLResponse)
async def display(request: Request):
    return templates.TemplateResponse("display.html", {"request": request})


@app.get("/admin", response_class=HTMLResponse)
async def admin(request: Request):
    return templates.TemplateResponse("admin.html", {"request": request})


@app.get("/api/mode")
async def get_mode():
    return {"mode": current_mode}


@app.post("/api/mode")
async def set_mode(request: Request):
    auth = request.headers.get("Authorization", "")
    if auth != f"Bearer {ADMIN_TOKEN}":
        raise HTTPException(status_code=401, detail="Unauthorized")
    body = await request.json()
    mode = body.get("mode")
    if mode not in VALID_MODES:
        raise HTTPException(status_code=400, detail=f"mode must be one of {VALID_MODES}")
    override_minutes = int(body.get("override_minutes", 60))
    global current_mode, manual_override_until
    current_mode = mode
    manual_override_until = datetime.now() + timedelta(minutes=override_minutes)
    await broadcast_mode(current_mode)
    return {"mode": current_mode, "override_until": manual_override_until.isoformat()}


@app.get("/api/mode/stream")
async def mode_stream(request: Request):
    queue: asyncio.Queue = asyncio.Queue()
    subscribers.append(queue)

    async def event_generator() -> AsyncGenerator[str, None]:
        try:
            yield f"data: {json.dumps({'mode': current_mode})}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    mode = await asyncio.wait_for(queue.get(), timeout=25)
                    yield f"data: {json.dumps({'mode': mode})}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            subscribers.remove(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/time")
async def get_time():
    return await asyncio.to_thread(get_ntp_time)


@app.get("/api/schedule")
async def get_schedule():
    return load_schedule()


@app.put("/api/schedule")
async def put_schedule(request: Request):
    auth = request.headers.get("Authorization", "")
    if auth != f"Bearer {ADMIN_TOKEN}":
        raise HTTPException(status_code=401, detail="Unauthorized")
    data = await request.json()
    save_schedule(data)
    return data


async def _proxy(target_base: str, path: str, request: Request) -> Response:
    url = f"{target_base}/{path}"
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            resp = await client.request(
                method=request.method,
                url=url,
                headers={k: v for k, v in request.headers.items() if k.lower() != "host"},
                content=await request.body(),
            )
            excluded = {"transfer-encoding", "connection"}
            headers = {k: v for k, v in resp.headers.items() if k.lower() not in excluded}
            return Response(content=resp.content, status_code=resp.status_code, headers=headers)
        except httpx.RequestError:
            raise HTTPException(status_code=502, detail="Upstream unreachable")


@app.api_route("/transit/{path:path}", methods=["GET", "HEAD", "POST"])
async def proxy_transit(path: str, request: Request):
    return await _proxy(TRANSIT_URL, path, request)


@app.api_route("/transit", methods=["GET", "HEAD", "POST"])
async def proxy_transit_root(request: Request):
    return await _proxy(TRANSIT_URL, "", request)


@app.api_route("/clock/{path:path}", methods=["GET", "HEAD", "POST"])
async def proxy_clock(path: str, request: Request):
    return await _proxy(CLOCK_URL, path, request)


@app.api_route("/clock", methods=["GET", "HEAD", "POST"])
async def proxy_clock_root(request: Request):
    return await _proxy(CLOCK_URL, "", request)
