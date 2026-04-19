import time
import ntplib

NTP_HOST = "ntp.nict.jp"
CACHE_TTL = 30  # seconds

_cache: dict = {}


def get_ntp_time() -> dict:
    now = time.time()
    if _cache and now - _cache["at"] < CACHE_TTL:
        return _cache["data"]
    c = ntplib.NTPClient()
    resp = c.request(NTP_HOST, version=3)
    data = {"ts": time.time() + resp.offset, "ntp_rtt_ms": resp.delay * 1000}
    _cache.update({"at": now, "data": data})
    return data
