"""サイネージのバージョン。

「YYMMDD-N」の形で、N はこれまでの更新の通し番号、日付は最後に更新した日（日本時間）。
controller と transit のプログラムの中身（ファイルのハッシュ）を覚えておき、どちらかが変わったら1つ進める。
5分以内に続いた変化は、同じ1回の更新として数える（両方を作り直すと、起動の順に2回変わって見えるため）。
端末はこの値が変わったのを見て、自分で画面を読み直す。
"""
import hashlib
import json
import os
from datetime import datetime, timedelta
from pathlib import Path

MERGE_WINDOW = timedelta(minutes=5)
HISTORY_LIMIT = 30
# ハッシュに含めないもの: 実行時のデータ、設定（管理画面で変える）、テストや道具
SKIP_DIRS = {"data", "__pycache__", "tests", "tools", "controller", "clock", "controller_data", "volume",
             "venv", ".git", ".pytest_cache", "node_modules"}
SKIP_FILES = {"config.yml", ".env", ".env.example"}


def code_hash(root: Path) -> str:
    """root の下のプログラム一式のハッシュ。ファイルの並び順に左右されないよう、名前順に読む"""
    digest = hashlib.sha256()
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
        for name in sorted(filenames):
            if name in SKIP_FILES or name.endswith(".pyc"):
                continue
            path = Path(dirpath) / name
            digest.update(str(path.relative_to(root)).encode())
            digest.update(path.read_bytes())
    return digest.hexdigest()[:16]


class VersionBook:
    """バージョンの記録（data/version.json）。書くのは controller だけ"""

    def __init__(self, path: Path):
        self.path = path
        try:
            self.data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self.data = {"count": 0, "date": None, "updated_at": None, "hashes": {}, "history": []}

    @property
    def version(self) -> str:
        return f"{self.data['date']}-{self.data['count']}" if self.data["count"] else "—"

    def note(self, part: str, digest: str, now: datetime | None = None) -> bool:
        """part（controller / transit）の今のハッシュを知らせる。番号が進んだら True"""
        if not digest or self.data["hashes"].get(part) == digest:
            return False
        now = now or datetime.now().astimezone()
        first_seen = part not in self.data["hashes"]
        self.data["hashes"][part] = digest
        # 初めて見る部品は、記録を始めたとき（count が 0）以外は数えない
        if first_seen and self.data["count"]:
            self._save()
            return False
        # 5分の幅は、その更新の始まりから数える（続けて直しても、いつまでも1回にはしない）
        began = self.data["history"] and datetime.fromisoformat(self.data["history"][0]["at"])
        changed = not (began and now - began <= MERGE_WINDOW)
        if changed:
            self.data["count"] += 1
            self.data["date"] = now.strftime("%y%m%d")
            self.data["history"].insert(0, {"version": None, "at": now.isoformat(timespec="seconds"), "parts": []})
            del self.data["history"][HISTORY_LIMIT:]
        entry = self.data["history"][0]
        if part not in entry["parts"]:
            entry["parts"].append(part)
        entry["version"] = self.version
        self.data["updated_at"] = now.isoformat(timespec="seconds")
        self._save()
        return changed

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.data, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(self.path)

    @property
    def build(self) -> str:
        """中身が変わるたびに変わる値。同じ番号にまとめた更新でも変わるので、端末の読み直しにはこちらを使う"""
        parts = sorted(self.data["hashes"].items())
        return hashlib.sha256(json.dumps(parts).encode()).hexdigest()[:12] if parts else ""

    def summary(self) -> dict:
        return {"version": self.version, "build": self.build, "updated_at": self.data["updated_at"],
                "history": self.data["history"][:10]}
