#!/bin/bash
# Seed DB from products.json (first deploy only — ON CONFLICT DO NOTHING)
python ingest_db.py --seed

# Build FAISS/BM25 index from DB if not present
if [ ! -d "faiss_index" ]; then
  echo "📦 Building RAG index from database..."
  python ingest_db.py
fi

echo "🚀 Starting ShopLens API..."
uvicorn api:app --host 0.0.0.0 --port $PORT