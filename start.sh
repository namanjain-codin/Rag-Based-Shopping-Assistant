#!/bin/bash
# Run FAISS ingestion on first deploy (only if index doesn't exist)
if [ ! -d "faiss_index" ]; then
  echo "📦 Running ingestion..."
  python ingest.py
fi
echo "🚀 Starting API..."
uvicorn api:app --host 0.0.0.0 --port $PORT
