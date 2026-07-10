"""
ingest_db.py  (v2 — pgvector edition)
---------------------------------------
Generates Mistral embeddings for all products and stores them
directly in the Supabase products table (embedding vector column).
No local files needed. Safe to re-run — skips products that already
have embeddings unless --force is passed.

Usage:
    python ingest_db.py           # embed products missing embeddings
    python ingest_db.py --seed    # seed from products.json first, then embed
    python ingest_db.py --force   # re-embed ALL products
"""

import sys
import os
import time
import json
from dotenv import load_dotenv
from langchain_mistralai import MistralAIEmbeddings
from database import init_db, seed_from_json, get_conn
from worker import build_doc_text

load_dotenv()

BATCH_SIZE = 8   # Mistral embed API batch size


def get_products_needing_embedding(force: bool = False):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            if force:
                cur.execute("SELECT id, name, brand, category, price, currency, rating, features, tags, description FROM products ORDER BY id")
            else:
                cur.execute("SELECT id, name, brand, category, price, currency, rating, features, tags, description FROM products WHERE embedding IS NULL ORDER BY id")
            rows = cur.fetchall()
            result = []
            for r in rows:
                d = dict(r)
                d["features"] = d["features"] if isinstance(d["features"], list) else json.loads(d["features"])
                d["tags"]     = d["tags"]     if isinstance(d["tags"], list)     else json.loads(d["tags"])
                d["price"]    = float(d["price"])
                d["rating"]   = float(d["rating"])
                result.append(d)
            return result
    finally:
        conn.close()


def save_embeddings_batch(products: list, embeddings: list):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            for p, emb in zip(products, embeddings):
                doc_text = build_doc_text(p)
                cur.execute(
                    "UPDATE products SET embedding = %s::vector, doc_text = %s WHERE id = %s",
                    (emb, doc_text, p["id"])
                )
        conn.commit()
    finally:
        conn.close()


def ingest(force: bool = False):
    print("🗄️  Connecting to Supabase...")
    init_db()

    products = get_products_needing_embedding(force)
    if not products:
        print("✅ All products already have embeddings. Use --force to re-embed.")
        return

    print(f"📦 {len(products)} products need embeddings.")

    api_key = os.getenv("MISTRAL_API_KEY")
    if not api_key:
        raise ValueError("MISTRAL_API_KEY not set.")

    embed_model = MistralAIEmbeddings(model="mistral-embed", api_key=api_key)

    # Process in batches
    for i in range(0, len(products), BATCH_SIZE):
        batch    = products[i:i + BATCH_SIZE]
        texts    = [build_doc_text(p) for p in batch]
        print(f"  ⚙️  Embedding batch {i//BATCH_SIZE + 1} ({len(batch)} products)...")
        vecs     = embed_model.embed_documents(texts)
        save_embeddings_batch(batch, vecs)
        print(f"  ✅ Saved embeddings for: {[p['name'] for p in batch]}")
        if i + BATCH_SIZE < len(products):
            time.sleep(1)  # rate limit buffer

    print(f"\n✅ Done. {len(products)} products embedded and stored in pgvector.")


if __name__ == "__main__":
    force = "--force" in sys.argv
    if "--seed" in sys.argv:
        print("🌱 Seeding from products.json...")
        init_db()
        seed_from_json("products.json")
    ingest(force=force)