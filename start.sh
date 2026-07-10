#!/bin/bash
set -e
echo "🌱 Seeding DB from products.json (skips existing)..."
python ingest_db.py --seed

echo "⚙️  Embedding products missing vectors..."
python ingest_db.py

echo "🚀 Starting ShopLens API..."
uvicorn api:app --host 0.0.0.0 --port $PORT