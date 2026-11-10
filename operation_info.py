"""運行情報の取得（train_operation_info）。

keihan_tracker 2.7.0 で運行情報の機能（get_yahoo_delay・get_ekispert_delay・DelayLine）が削除されたため、
同じ作者の train_operation_info に移した。状態はライブラリが公式の表示から分類して返す。
"""
from typing import Optional
from unicodedata import normalize

from train_operation_info import Tracker
from train_operation_info.exceptions import RefreshError
from train_operation_info.models import Line, LineStatus

# 関西の公式サイト。Yahoo! は二次利用を禁じているため、設定で選んだときだけ使う
DEFAULT_PROVIDERS = ("keihan", "jrw", "hankyu", "hanshin", "kintetsu", "nankai", "osaka_metro", "osaka_monorail")

# JR西日本は北陸・中国地方の路線も返すため、既定では京阪神の路線に絞る
DEFAULT_ONLY_LINES = {
    "jrw": [
        "琵琶湖線", "ＪＲ京都線", "ＪＲ神戸線", "湖西線", "草津線", "奈良線", "嵯峨野線",
        "おおさか東線", "ＪＲ宝塚線", "ＪＲ東西線", "学研都市線", "大阪環状線", "ＪＲゆめ咲線",
        "大和路線", "阪和線", "関西空港線", "羽衣線", "関西線",
    ],
}

# 「京都線」（阪急・近鉄）や「奈良線」（近鉄・JR）のように路線名が重なるので、Yahoo! と同じく会社の略称を付ける。
# 路線名が略称で始まるもの（東京メトロ銀座線など）はそのまま。ここに無い取得元は会社名を付ける
_PREFIX = {
    "keihan": "京阪", "jrw": "JR", "hankyu": "阪急", "hanshin": "阪神", "kintetsu": "近鉄",
    "nankai": "南海", "osaka_metro": "Osaka Metro ", "osaka_monorail": "",
    "jrhokkaido": "JR北海道 ", "jreast": "JR東日本 ", "jrcentral": "JR東海 ", "jrshikoku": "JR四国 ",
    "jrkyushu": "JR九州 ", "tokyo_metro": "東京メトロ", "toei": "都営", "tobu": "東武", "seibu": "西武",
    "keisei": "京成", "keio": "京王", "keikyu": "京急", "tokyu": "東急", "meitetsu": "名鉄",
    "hakone_tozan": "", "minatomirai": "", "rinkai": "", "yurikamome": "", "tosaden": "", "yuirail": "",
    "taipei_metro": "台北捷運 ", "tra": "台鐵 ", "thsr": "", "singapore_mrt": "Singapore MRT ",
    "transilien": "", "obb": "", "yahoo": "",
}

_STATUS_LABEL = {
    LineStatus.DELAYED: "列車遅延",
    LineStatus.SUSPENDED: "運転見合わせ",
    LineStatus.PARTIAL_SUSPENSION: "部分運休",
}

DEFAULT_GROUPS = (
    {"name": "京阪", "providers": ["keihan"], "lines": ["京阪本線", "鴨東線", "中之島線", "交野線", "宇治線"]},
    {"name": "大阪メトロ", "providers": ["osaka_metro"]},
    {"name": "JR", "providers": ["jrw"], "lines": DEFAULT_ONLY_LINES["jrw"]},
    {"name": "私鉄", "providers": ["hankyu", "hanshin", "kintetsu", "nankai", "osaka_monorail"]},
)
_SEVERITY = {status: index for index, status in enumerate((
    LineStatus.SUSPENDED, LineStatus.PARTIAL_SUSPENSION, LineStatus.DELAYED,
    LineStatus.ALERT, LineStatus.NORMAL, LineStatus.UNKNOWN,
))}


def groups(tracker: Optional[Tracker], cfg: dict) -> list[dict]:
    result = []
    only_lines = cfg.get("only_lines", DEFAULT_ONLY_LINES) or {}
    for group in cfg.get("groups", DEFAULT_GROUPS):
        names = group.get("lines")
        order = {normalize("NFKC", name): i for i, name in enumerate(names or [])}
        lines = [line for line in (tracker.lines if tracker else ())
                 if line.provider_id in group["providers"] and _wanted(line, only_lines)
                 and (names is None or normalize("NFKC", line.name) in order)]
        lines.sort(key=lambda line: (_SEVERITY[line.status], order.get(normalize("NFKC", line.name), 0)))
        status = lines[0].status if lines else LineStatus.UNKNOWN
        mark = "×" if status == LineStatus.SUSPENDED else "△" if status in _STATUS_LABEL else "−" if status == LineStatus.UNKNOWN else "○"
        result.append({
            "name": group["name"], "mark": mark,
            "status": _STATUS_LABEL.get(status, "情報なし" if status == LineStatus.UNKNOWN else "平常運転"),
            "lines": [{
                "name": normalize("NFKC", line.name if len(group["providers"]) == 1 else _display_name(line)),
                "status": _label(line), "ticker_name": normalize("NFKC", _display_name(line)),
                "detail": _detail(line), "announced_time": line.updated_at,
            } for line in lines if line.status in _STATUS_LABEL],
        })
    return result


def build_tracker(cfg: dict, snapshot_dir: Optional[str] = None) -> Tracker:
    if cfg.get("providers") == "all":
        # ライブラリの既定（全取得元から、規約や APIキーの扱いで明示指定が要る yahoo・mta_subway・odakyu・db を除く）
        return Tracker(snapshot_dir=snapshot_dir)
    providers = tuple(cfg.get("providers") or DEFAULT_PROVIDERS)
    overrides = []
    if "yahoo" in providers:
        from train_operation_info.providers.yahoo import YahooArea, YahooProvider
        overrides.append(YahooProvider(areas=(YahooArea.KINKI,), snapshot_dir=snapshot_dir))
    return Tracker(enabled_providers=providers, snapshot_dir=snapshot_dir, overrides=overrides)


def _wanted(line: Line, only_lines: dict) -> bool:
    names = only_lines.get(line.provider_id)
    return names is None or normalize("NFKC", line.name) in {normalize("NFKC", name) for name in names}


def _display_name(line: Line) -> str:
    prefix = _PREFIX.get(line.provider_id, line.operator.name + " ")
    name = line.name
    if line.provider_id == "jrw" and name.startswith("ＪＲ"):
        return name
    if name.startswith(prefix.strip()):
        return name
    return prefix + name


def _label(line: Line) -> str:
    # ALERT: 影響の程度が公式に書かれていないお知らせ。公式の表示（source_status）は
    # 「TRAFIC:UNKNOWN」のような内部の値のこともあるので出さない
    return _STATUS_LABEL.get(line.status, "お知らせ")


def _detail(line: Line) -> str:
    alerts = line.active_alerts or line.alerts
    if alerts:
        return "\n".join(a.description or a.title for a in alerts)
    return line.source_status or ""


async def fetch(tracker: Tracker, cfg: dict) -> tuple[list[dict], Optional[str]]:
    """影響のある路線（遅延・運転見合わせ・部分運休・お知らせ）と、取得に失敗した取得先の説明を返す。

    失敗した取得先は前回の情報を保つ（ライブラリの仕様）ので、他社の分は表示を続ける。
    """
    error = None
    try:
        await tracker.refresh()
    except RefreshError as e:
        error = " / ".join(f"{pid}: {err}" for pid, err in e.errors.items())
    only_lines = cfg.get("only_lines", DEFAULT_ONLY_LINES) or {}
    rows = []
    for line in tracker.affected_lines:
        if not _wanted(line, only_lines):
            continue
        rows.append({
            "line": _display_name(line),
            "status": _label(line),
            "detail": _detail(line),
            # 公式が発表時刻を出していない取得元（JR東日本など）は None。取得時刻で埋めると「たった今に発表」と出てしまう
            "announced_time": line.updated_at,
        })
    return rows, error
