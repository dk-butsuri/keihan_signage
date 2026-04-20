import time
import ntplib

NTP_HOST = "ntp.nict.jp"
CACHE_TTL = 30  # seconds

_cache: dict = {}


def get_ntp_time() -> dict:
    now = time.time()
    if not _cache or now - _cache["at"] >= CACHE_TTL:
        c = ntplib.NTPClient()
        resp = c.request(NTP_HOST, version=3)
        _cache.update({"at": now, "offset": resp.offset, "ntp_rtt_ms": resp.delay * 1000})
    return {"ts": time.time() + _cache["offset"], "ntp_rtt_ms": _cache["ntp_rtt_ms"]}
