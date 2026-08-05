FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt requirements-dev.txt ./
RUN pip install --no-cache-dir -r requirements-dev.txt

COPY . .

EXPOSE 8000

# 本番 (Render) はポートを PORT 環境変数で指定してくるため、それに従う。
# ローカル開発のホットリロードは docker-compose.yaml の command で上書きする
CMD ["sh", "-c", "uvicorn src.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
