# 香里園 サイネージシステム

香里園駅周辺の交通情報（列車・バス・遅延）と時計を切り替えて表示するデジタルサイネージです。

## 構成

```
controller  ─── サイネージ全体を制御（モード管理・スケジュール・SSE配信）
transit     ─── 交通情報表示（列車・バス・遅延）
clock       ─── 時計表示
```

### モード

| モード | 内容 |
|--------|------|
| `transit` | 香里園駅の列車・バス・遅延情報をリアルタイム表示 |
| `clock` | 時計を表示 |

モードの切替は SSE（Server-Sent Events）でクライアントにリアルタイム配信されます。

## 技術スタック

| 項目 | 内容 |
|------|------|
| controller | FastAPI + Uvicorn |
| transit | FastAPI + Uvicorn |
| clock | 静的 HTML |
| データ取得 | [keihan_tracker](https://github.com/dk-butsuri/keihan_tracker) |
| AI分類 | Google Gemini API |
| コンテナ | Docker / Docker Compose |

## セットアップ

### 1. 環境変数の設定

```bash
cp .env.example .env
```

`.env` を編集：

```env
GOOGLE_API_KEY=your_google_api_key_here
```

### 2. 起動

```bash
docker compose up -d
```

ブラウザで `http://localhost:8880` にアクセスします。

## エンドポイント（controller）

| エンドポイント | 説明 |
|----------------|------|
| `GET /` | サイネージ表示画面 |
| `GET /admin` | 管理画面 |
| `GET /api/mode` | 現在のモードを取得 |
| `POST /api/mode` | モードを手動変更（要 Bearer トークン） |
| `GET /api/mode/stream` | モード変更を SSE でストリーミング |
| `GET /api/schedule` | スケジュール取得 |
| `PUT /api/schedule` | スケジュール更新（要 Bearer トークン） |
| `GET /api/time` | NTP 時刻取得 |
| `GET /transit/...` | transit サービスへのプロキシ |
| `GET /clock/...` | clock サービスへのプロキシ |

### 手動モード変更

```bash
curl -X POST http://localhost:8880/api/mode \
  -H "Authorization: Bearer changeme" \
  -H "Content-Type: application/json" \
  -d '{"mode": "clock", "override_minutes": 60}'
```

`override_minutes`（デフォルト: 60）の間、スケジュールによる自動切替を抑制します。

## スケジュール設定

`controller_data/schedule.json` で時刻ごとのモードを設定します。

```json
{
  "default_mode": "transit",
  "rules": [
    {"time": "07:30", "mode": "transit"},
    {"time": "18:30", "mode": "clock"}
  ]
}
```

`rules` は時刻の昇順で評価され、現在時刻以前の最後のルールが適用されます。
スケジュールは 30 秒ごとに確認されます。

## モード切替の仕組み

```
schedule_loop（30秒ごと）
    │ スケジュール評価
    ▼
broadcast_mode
    │ SSE プッシュ
    ▼
display.html（クライアント）─── iframe の src を切替
```

管理画面からの手動変更も同じ `broadcast_mode` を経由して SSE で配信されます。
