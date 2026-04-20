import time
import ntplib

NTP_HOST = "ntp.nict.jp"
CACHE_TTL = 30  # seconds

_cache: dict = {}


def get_ntp_time() -> dict:
    now = time.time()
    if not _cache or now - _cache["at"] >= CACHE_TTL:
        c = ntplib.NTPClient()
        best = None
        for _ in range(8):
            try:
                resp = c.request(NTP_HOST, version=3)
                if best is None or resp.delay < best.delay:
                    best = resp
            except Exception:
                pass
        if best is None:
            raise RuntimeError("All NTP samples failed")
        _cache.update({"at": now, "offset": best.offset, "ntp_rtt_ms": best.delay * 1000})
    return {"ts": time.time() + _cache["offset"], "ntp_rtt_ms": _cache["ntp_rtt_ms"]}
