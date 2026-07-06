"""
ingest_db.py
------------
Builds FAISS + BM25 index from the Supabase PostgreSQL database.
Run this after any bulk product changes, or it auto-runs on API startup
if the index is missing.

Usage:
    python ingest_db.py

Or seed + ingest in one shot:
    python ingest_db.py --seed
"""

import sys
import json
import os
from dotenv import load_dotenv
from langchain_core.documents import Document
from langchain_mistralai import MistralAIEmbeddings
from langchain_community.vectorstores import FAISS
from database import init_db, seed_from_json, get_products_as_dicts

load_dotenv()

FAISS_INDEX_PATH = "faiss_index"
DOCS_CACHE_FILE  = "docs_cache.json"


def build_product_document(product: dict) -> Document:
    content = (
        f"Product: {product['name']}\n"
        f"Brand: {product['brand']}\n"
        f"Category: {product['category']}\n"
        f"Price: ₹{product['price']}\n"
        f"Rating: {product['rating']} / 5\n"
        f"Features: {', '.join(product['features'])}\n"
        f"Tags: {', '.join(product['tags'])}\n"
        f"Description: {product['description']}"
    )
    metadata = {
        "id":       product["id"],
        "name":     product["name"],
        "brand":    product["brand"],
        "category": product["category"],
        "price":    product["price"],
        "currency": product["currency"],
        "rating":   product["rating"],
        "features": product["features"],
        "tags":     product["tags"],
        "stock":    product.get("stock", 100),
    }
    return Document(page_content=content, metadata=metadata)


def ingest():
    print("🗄️  Fetching products from Supabase...")
    init_db()
    products = get_products_as_dicts()
    if not products:
        print("⚠️  No products found in database. Run with --seed first.")
        return

    print(f"✅ Fetched {len(products)} products.")
    docs = [build_product_document(p) for p in products]

    print(f"💾 Saving docs cache for BM25 → '{DOCS_CACHE_FILE}'")
    cache = [{"page_content": d.page_content, "metadata": d.metadata} for d in docs]
    with open(DOCS_CACHE_FILE, "w") as f:
        json.dump(cache, f, indent=2)

    print("🔗 Connecting to Mistral Embeddings API...")
    embeddings = MistralAIEmbeddings(
        model="mistral-embed",
        api_key=os.getenv("MISTRAL_API_KEY")
    )

    print("⚙️  Building FAISS index...")
    vectorstore = FAISS.from_documents(docs, embeddings)

    print(f"💾 Saving FAISS index → '{FAISS_INDEX_PATH}'")
    vectorstore.save_local(FAISS_INDEX_PATH)
    print("✅ Ingestion complete.")


if __name__ == "__main__":
    if "--seed" in sys.argv:
        print("🌱 Seeding database from products.json...")
        init_db()
        seed_from_json("products.json")
    ingest()