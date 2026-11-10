import argparse
import asyncio
import datetime
import gzip
import json
import sys
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main
from keihan_tracker import KHTracker


RealDateTime = datetime.datetime


class ReplayClock(RealDateTime):
    instant = RealDateTime.now(main.JST)

    @classmethod
    def now(cls, tz=None):
        return cls.instant.astimezone(tz) if tz else cls.instant.replace(tzinfo=None)


class ArchiveTracker(KHTracker):
    def __init__(self, files):
        super().__init__(rate_limit=15)
        self.files = files
        self.position_file = None
        self.at = ""

    async def _get(self, url):
        kind = Path(urlsplit(url).path).stem
        if kind == "trainPositionList":
            path = self.position_file
        else:
            path = next((p for stamp, p in reversed(self.files[kind]) if stamp <= self.at), None)
        if path is None:
            raise ValueError(f"Missing archived {kind} at {self.at}")
        with gzip.open(path, "rt", encoding="utf-8") as source:
            return source.read()

    async def _get_if_modified(self, url):
        return await self._get(url)

    async def _request(self, url, headers):
        raise RuntimeError("Archive replay cannot access the network")


def archive_files(root):
    result = {kind: [] for kind in ("select_station", "transferGuideInfo", "startTimeList", "trainPositionList")}
    for path in sorted(root.glob("*/*.json.gz")):
        stamp, kind = path.name.split("_", 1)
        kind = kind.removesuffix(".json.gz")
        if kind in result:
            result[kind].append((path.parent.name + stamp, path))
    return result


async def build(args):
    start = RealDateTime.fromisoformat(args.start).astimezone(main.JST)
    end = RealDateTime.fromisoformat(args.end).astimezone(main.JST)
    if start >= end:
        raise ValueError("end must be later than start")
    warmup = start - datetime.timedelta(minutes=30)
    files = archive_files(args.snapshots)
    tracker = ArchiveTracker(files)
    main.tracker = tracker
    main._cfg = {"trains": dict(main._load_config_file()["trains"])}
    main._cfg["trains"]["force_suspended"] = False
    frames, skipped = [], 0
    for stamp, path in files["trainPositionList"]:
        recorded = RealDateTime.strptime(stamp, "%Y%m%d%H%M%S.%f").replace(tzinfo=main.JST)
        if not warmup <= recorded <= end:
            continue
        try:
            with gzip.open(path, "rt", encoding="utf-8") as source:
                raw = json.load(source)
            created = RealDateTime.strptime(raw["fileCreatedTime"], "%Y%m%d%H%M%S").replace(tzinfo=main.JST)
            if not warmup <= created <= end:
                continue
        except (ValueError, OSError, KeyError):
            skipped += 1
            continue
        tracker.at, tracker.position_file = stamp, path
        ReplayClock.instant = created
        # Run only in this offline process: production's clock and tracker remain independent.
        with patch("datetime.datetime", ReplayClock):
            await tracker.fetch_pos()
            main._last_pos_success = created
            if main._first_position_time is None:
                main._first_position_time = created
            main._update_suspension(created)
            if created < start or (frames and created.timestamp() <= frames[-1]["ts"]):
                continue
            trains, line = await main.get_trains(), await main.get_line()
            if trains.error or line.error:
                raise ValueError(trains.error or line.error)
            frames.append({"ts": created.timestamp(), "trains": trains.model_dump(mode="json"),
                           "line": line.model_dump(mode="json"), "source": str(path.relative_to(args.snapshots))})
    if len(frames) < 2:
        raise ValueError("At least two usable snapshots are required")
    bundle = {"version": 1, "recorded_date": start.date().isoformat(),
              "station_name": frames[0]["trains"]["station_name"],
              "start": frames[0]["ts"], "end": frames[-1]["ts"], "frames": frames,
              "buses": {"buses": [], "error": "この記録にはバス情報がありません"},
              "delays": {"delays": [], "error": "この記録には公式の運行情報がありません"}}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    pending = args.output.with_suffix(".tmp")
    pending.write_text(json.dumps(bundle, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    pending.replace(args.output)
    print(f"Saved {len(frames)} frames; skipped {skipped} invalid snapshots: {args.output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshots", type=Path, default=Path("/app/data/snapshots"))
    parser.add_argument("--start", required=True, help="ISO datetime with timezone")
    parser.add_argument("--end", required=True, help="ISO datetime with timezone")
    parser.add_argument("--output", type=Path, default=Path("demo-data/replay.json"))
    asyncio.run(build(parser.parse_args()))
