FROM python:3.12-slim AS base

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# ローカル開発用: テスト用ライブラリも入れる (docker-compose.yaml の target: dev で使う)
FROM base AS dev
COPY requirements-dev.txt ./
RUN pip install --no-cache-dir -r requirements-dev.txt

FROM base AS prod

COPY . .

EXPOSE 8000

# 本番 (Render) はポートを PORT 環境変数で指定してくるため、それに従う。
# 起動前にマイグレーションを適用する (適用済みなら何もしない)。
# ローカル開発のホットリロードは docker-compose.yaml の command で上書きする
CMD ["sh", "-c", "alembic upgrade head && uvicorn src.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
