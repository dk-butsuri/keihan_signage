# 香里園 交通情報ダッシュボード

香里園駅（KH18）および同志社香里バス停の発着情報と、近鉄・京阪の遅延情報をリアルタイムで表示するWebアプリです。

## 機能

- **列車情報**: 香里園駅の上り（京都方面）・下り（大阪方面）の発車時刻・遅延状況
- **バス情報**: 同志社香里バス停（1番・2番乗り場）の時刻・行先
- **遅延情報**: バスすぱあと、またはYahoo!鉄道情報からの遅延情報を取得し Gemini AI で自動分類（運転見合わせ / 列車遅延 / ダイヤ乱れ など）

## 技術スタック

| 項目 | 内容 |
|------|------|
| バックエンド | FastAPI + Uvicorn |
| データ取得 | [keihan_tracker](https://github.com/dk-butsuri/keihan_tracker) |
| AI分類 | Google Gemini API (`gemini-3.1-flash-lite-preview`) |
| テンプレート | Jinja2 |
| コンテナ | Docker / Docker Compose |

## セットアップ

### 1. 環境変数の設定

`.env.example` をコピーして `.env` を作成し、APIキーを設定します。

```bash
cp .env.example .env
```

`.env` を編集：

```env
GOOGLE_API_KEY=your_google_api_key_here
```

> Google APIキーは [Google AI Studio](https://aistudio.google.com/) で取得できます。

### 2. Docker で起動（推奨）

```bash
docker compose up -d
```

ブラウザで `http://localhost:8000` にアクセスします。

### 3. ローカルで起動

```bash
pip install -r requirements.txt
python main.py
```

## API エンドポイント

| エンドポイント | 説明 |
|----------------|------|
| `GET /` | ダッシュボード画面 |
| `GET /api/trains` | 香里園駅の列車情報 |
| `GET /api/buses` | 同志社香里バス停の情報 |
| `GET /api/delays` | 遅延情報（AI分類済み） |

## データ更新間隔

| データ | 間隔 |
|--------|------|
| 列車位置情報 | 60秒ごと |
| バス情報 | 60秒ごと |
| 遅延情報 | 10分ごと |
