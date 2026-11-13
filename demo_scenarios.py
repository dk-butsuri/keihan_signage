import datetime


SCENARIOS = (
    {"id": "power-outage", "title": "停電時の運行記録", "mode": "replay",
     "description": "停電時の実際の列車位置とダイヤを再生。一時停止・早送り・時刻指定で、そのときの動きを確認できます。"},
    {"id": "normal", "title": "通常運転", "mode": "static",
     "description": "各社とも平常運転。通常の発車案内と、運行情報の平常表示を確認できます。"},
    {"id": "jr-loop", "title": "大阪環状線で人立ち入り", "mode": "static",
     "description": "環状線と乗り入れ路線が運転見合わせ。京阪は通常運転のまま、複数路線の切替を確認できます。"},
    {"id": "severe-weather", "title": "荒天で広域に影響", "mode": "static",
     "description": "JR・私鉄・地下鉄の大半が見合わせや遅延。京阪も大幅に遅れ、一部の列車が止まっている想定です。"},
    {"id": "all-stopped", "title": "荒天で京阪も全面見合わせ", "mode": "static",
     "description": "荒天がさらに強まり、京阪の列車もすべて停止。両方面の停止表示と、多数の運行情報を確認できます。"},
    {"id": "display-patterns", "title": "列車カードの全表示パターン", "mode": "gallery",
     "description": "遅延・停止・到着予測の有無による全8通りを、通常表示と圧縮表示で比較。2時間以上の遅延や長時間停止なども確認できます。"},
    {"id": "weather-cards", "title": "気象警報の札のしくみ", "mode": "weather",
     "description": "発表中の警報・警報の予想時系列・警報級の可能性を切り替えて、画面上部の札がどう決まるかを試せます。"},
    {"id": "startup-intro", "title": "起動イントロ", "mode": "intro",
     "description": "ほのかな発光が強まる起動演出から、駅名・時計、京都方面、大阪方面、バス、運行情報へ。左から画面が組み上がる流れを確認できます。"},
)

_STATIONS = tuple(enumerate((
    "京橋", "野江", "関目", "森小路", "千林", "滝井", "土居", "守口市", "西三荘", "門真市", "古川橋",
    "大和田", "萱島", "寝屋川市", "香里園", "光善寺", "枚方公園", "枚方市", "御殿山", "牧野", "樟葉",
), 4))
_REFERENCE = datetime.datetime(2026, 11, 7, 15, tzinfo=datetime.timezone(datetime.timedelta(hours=9)))
_ANNOUNCED = (_REFERENCE - datetime.timedelta(minutes=8)).isoformat()
_JR_LINES = ("大阪環状線", "JRゆめ咲線", "大和路線", "阪和線", "関西空港線", "JR京都線", "JR神戸線", "学研都市線", "JR東西線", "JR宝塚線", "おおさか東線", "奈良線", "琵琶湖線", "湖西線")
_METRO_LINES = ("中央線", "南港ポートタウン線", "御堂筋線", "谷町線", "四つ橋線", "千日前線", "堺筋線", "長堀鶴見緑地線", "今里筋線")
_MONORAIL_LINES = ("大阪モノレール線", "国際文化公園都市線")
_KINTETSU_LINES = ("奈良線", "大阪線", "京都線", "南大阪線", "けいはんな線")
_PRIVATE_LINES = ("阪急京都線", "阪急神戸線", "阪急宝塚線", "阪神本線", "阪神なんば線", "南海本線", "南海高野線")
_KEIHAN_LINES = ("京阪本線", "鴨東線", "中之島線", "交野線", "宇治線")


def display_patterns():
    cases = []
    for predicted in (True, False):
        for stopped in (False, True):
            for delayed in (False, True):
                notes = []
                if predicted and stopped:
                    notes.append("到着予測がある場合、停止時間は表示しません。")
                train = {
                    "kind": "準急", "time": "17:47", "destination": "枚方市",
                    "delay": 6 if delayed else 0, "status": "", "estimate_unreliable": not predicted,
                    "minutes_remaining": 18 if predicted else None, "is_this_station": False,
                    "sub_station_name": "寝屋川市", "sub_station_time": "17:50" if delayed else "17:44",
                    "sub_station_verb": "着", "stopped_minutes": 5 if stopped else None,
                    "stopped_lower_bound": False,
                    "position": "萱島に停車中（停止5分）" if stopped else "大和田 → 萱島 の間",
                }
                cases.append({"id": f"prediction-{int(predicted)}-stop-{int(stopped)}-delay-{int(delayed)}",
                              "title": " ／ ".join(("予測あり" if predicted else "予測なし",
                                                     "遅延6分" if delayed else "遅延なし",
                                                     "停止5分" if stopped else "停止なし")),
                              "predicted": predicted, "extra": False, "note": " ".join(notes), "train": train})
    base = cases[-1]["train"]
    for case_id, title, changes in (
        ("over-two-hours", "2時間以上の遅延・停止時間の下限", {
            "delay": 120, "estimated_delay_minutes": 150, "status": "遅れ150分以上",
            "stopped_minutes": 25, "stopped_lower_bound": True, "position": "萱島に停車中（停止25分以上）"}),
        ("long-stop", "3桁の停止時間・長い行先・日付をまたぐ時刻", {
            "time": "00:06", "destination": "寝屋川市", "delay": 120, "estimated_delay_minutes": 165,
            "status": "遅れ165分以上", "stopped_minutes": 125, "stopped_lower_bound": True,
            "position": "萱島に停車中（停止125分以上）"}),
        ("unknown-time", "定刻が不明", {"time": "-"}),
        ("without-secondary", "寝屋川市の補足時刻なし", {
            "estimate_unreliable": False, "minutes_remaining": 18, "delay": 0,
            "sub_station_time": None, "stopped_minutes": None, "position": None}),
    ):
        train = {**base, **changes}
        cases.append({"id": case_id, "title": title, "predicted": not train["estimate_unreliable"],
                      "extra": True, "note": "", "train": train})
    return {"version": 1, "mode": "gallery", "cases": cases}


def _group(name, lines=()):
    severity = {"運転見合わせ": 0, "部分運休": 1, "列車遅延": 2}
    lines = sorted(lines, key=lambda line: severity[line["status"]])
    return {"name": name, "mark": "×" if lines and lines[0]["status"] == "運転見合わせ" else "△" if lines else "○",
            "status": lines[0]["status"] if lines else "平常運転", "lines": lines}


def _notice(name, status, detail, prefix=""):
    return {"name": name, "ticker_name": name if name.startswith(prefix) else prefix + name,
            "status": status, "detail": detail, "announced_time": _ANNOUNCED}


def _groups(scenario_id):
    if scenario_id == "normal":
        return [_group(name) for name in ("京阪", "大阪メトロ", "JR", "大阪モノレール", "近鉄", "その他の私鉄")]
    if scenario_id == "jr-loop":
        detail = "大阪環状線内での線路内人立ち入りのため、安全確認を行っています。環状線と乗り入れ路線で運転を見合わせています。"
        return [_group("京阪"), _group("大阪メトロ"), _group("JR", [
            _notice(name, "運転見合わせ", detail, "JR") for name in _JR_LINES[:5]
        ]), _group("大阪モノレール"), _group("近鉄"), _group("その他の私鉄")]
    stopped = scenario_id == "all-stopped"
    return [
        _group("京阪", [_notice(name, "運転見合わせ" if stopped else "部分運休" if name == "中之島線" else "列車遅延",
            "強風のため、全線で運転を見合わせています。" if stopped else "強風のため徐行運転を行っており、大幅な遅れや一部列車の運休が発生しています。", "京阪") for name in _KEIHAN_LINES]),
        _group("大阪メトロ", [_notice(name, "運転見合わせ" if i < 2 else "列車遅延",
            "強風の影響で、地上区間を含む路線の運転を見合わせています。" if i < 2 else "荒天による直通運転の中止や混雑の影響で、列車に遅れが出ています。", "Osaka Metro ") for i, name in enumerate(_METRO_LINES)]),
        _group("JR", [_notice(name, "運転見合わせ" if i < 11 else "列車遅延",
            "強風と大雨のため、運転を見合わせています。運転再開の見込みは立っていません。" if i < 11 else "大雨による徐行運転のため、列車に大幅な遅れが出ています。", "JR") for i, name in enumerate(_JR_LINES)]),
        _group("大阪モノレール", [_notice(name, "運転見合わせ",
            "強風のため運転を見合わせています。", "大阪モノレール") for name in _MONORAIL_LINES]),
        _group("近鉄", [_notice(name, "運転見合わせ" if i % 2 == 0 else "列車遅延",
            "強風のため運転を見合わせています。" if i % 2 == 0 else "強風による速度規制のため、列車に遅れが出ています。", "近鉄") for i, name in enumerate(_KINTETSU_LINES)]),
        _group("その他の私鉄", [_notice(name, "運転見合わせ" if i % 3 != 2 else "列車遅延",
            "強風のため運転を見合わせています。" if i % 3 != 2 else "強風による速度規制のため、列車に遅れが出ています。") for i, name in enumerate(_PRIVATE_LINES)]),
    ]


def _train(direction, index, weather, stopped):
    minutes = 6 + index * 10 + (2 if direction == "down" else 0)
    time = _REFERENCE + datetime.timedelta(minutes=minutes)
    position = "寝屋川市 → 香里園 の間" if direction == "up" else "光善寺 → 香里園 の間"
    return {"kind": ("準急", "普通", "快速急行", "準急", "普通", "特急")[index % 6],
            "time": time.strftime("%H:%M"), "destination": ("出町柳" if index % 2 == 0 else "樟葉") if direction == "up" else ("淀屋橋" if index % 2 == 0 else "中之島"),
            "delay": 36 + index * 3 if stopped else 18 + index * 3 if weather else 0,
            "status": "", "estimate_unreliable": weather, "minutes_remaining": None if weather else minutes,
            "is_this_station": False, "sub_station_name": "寝屋川市",
            "sub_station_time": (time + datetime.timedelta(minutes=-3 if direction == "up" else 3)).strftime("%H:%M"),
            "sub_station_verb": "着", "position": position,
            "position_text": position, "stopped_minutes": 28 + index * 2 if stopped else 14 if weather and direction == "up" and index == 0 else None,
            "is_active": True}


def static_scenario(scenario_id):
    if scenario_id not in {scenario["id"] for scenario in SCENARIOS if scenario["mode"] == "static"}:
        raise ValueError("Unknown static demo")
    weather = scenario_id in ("severe-weather", "all-stopped")
    stopped = scenario_id == "all-stopped"
    trains = {"station_name": "香里園", "error": None, **{
        direction + "_trains": [_train(direction, i, weather, stopped) for i in range(7)]
        for direction in ("up", "down")}}
    positions = {"up": (6, 11.7, 14, 16, 17.5, 19.5, 21, 23), "down": (5, 11, 13, 15.3, 18.5, 20, 22, 24)}
    map_trains = [{"direction": direction, "position": position,
        "kind": ("普通", "特急", "準急", "快速急行")[i % 4],
        "delay": 36 + i * 2 if stopped else 15 + i * 2 if weather else 0,
        "stopped_minutes": 28 + i * 2 if stopped else 12 + i if weather and direction == "up" and i in (3, 4, 5) else None,
        "stopped_lower_bound": False} for direction, locations in positions.items() for i, position in enumerate(locations)]
    for direction in ("up", "down"):
        incoming = sorted((train for train in map_trains if train["direction"] == direction
            and (train["position"] < 18 if direction == "up" else train["position"] > 18)),
            key=lambda train: abs(train["position"] - 18))
        for marker, train in zip(incoming, trains[direction + "_trains"]):
            marker.update({key: train[key] for key in ("kind", "delay", "stopped_minutes")})
    line = {"suspended": weather, "as_of": "15:00:00", "total": len(map_trains),
        "stopped": sum(train["stopped_minutes"] is not None for train in map_trains), "station_id": 18,
        "stations": [{"number": number, "name": name} for number, name in _STATIONS], "trains": map_trains,
        "compress_ranges": [[5, 10], [14, 15]], "error": None,
        "outside": dict.fromkeys(("up_osaka", "down_osaka", "up_kyoto", "down_kyoto"), 0),
        "outside_stopped": dict.fromkeys(("up_osaka", "down_osaka", "up_kyoto", "down_kyoto"), 0),
        "directions": {direction: {"state": "stopped" if stopped else "delayed" if weather else "normal",
            "next": trains[direction + "_trains"][:2]} for direction in ("up", "down")}}
    groups = _groups(scenario_id)
    return {"version": 1, "mode": "static", "timestamp": _REFERENCE.timestamp(), "trains": trains, "line": line,
        "buses": {"buses": [{"route_id": "22", "destination": "京阪香里園" if i % 2 == 0 else "寝屋川市駅",
            "stop_name": "同志社香里", "stop_arrival_is_scheduled": False,
            "terminal_arrival_time": None if weather else (_REFERENCE + datetime.timedelta(minutes=8 + i * 10 + (19 if i % 2 == 0 else 12))).strftime("%H:%M"),
            "arrival_time": "荒天のため運休" if weather else (_REFERENCE + datetime.timedelta(minutes=8 + i * 10)).strftime("%H:%M") + " 着予定",
            "status": "運休" if weather else f"約{8 + i * 10}分後に到着"} for i in range(6)], "error": None},
        "delays": {"groups": groups, "delays": [{"line": line["ticker_name"], **{key: line[key] for key in ("status", "detail", "announced_time")}}
            for group in groups for line in group["lines"]], "error": None}}
