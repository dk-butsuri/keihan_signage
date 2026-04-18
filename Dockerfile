# Python 3.11-slimをベースイメージに使用
FROM python:3.11-slim

# 作業ディレクトリを設定
WORKDIR /app

# 依存パッケージのインストールに必要なツールをインストール
# git: githubからkeihan_trackerをインストールするために必要
RUN apt-get update && apt-get install -y \
    git \
    && rm -rf /var/lib/apt/lists/*

# requirements.txtをコピー
COPY requirements.txt .

# 依存ライブラリをインストール
RUN pip install --no-cache-dir -r requirements.txt

# アプリケーションコードをコピー
COPY . .

# サーバー起動コマンド
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
