"""
database.py  (v2 — pgvector edition)
-------------------------------------
Supabase PostgreSQL with pgvector for embeddings.
Products table stores both inventory data AND vector embeddings.

Schema:
  products table  → all product fields + embedding vector(1024)
  Stock=0 products are excluded from vector search automatically.
"""

import os
import json
from typing import List, Optional, Dict, Any
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

load_dotenv()

LOW_STOCK_THRESHOLD = 5


def get_conn():
    url = os.getenv("DATABASE_URL")
    if not url:
        raise ValueError("DATABASE_URL is not set.")
    if "sslmode" not in url:
        url += "?sslmode=require"
    return psycopg2.connect(url, cursor_factory=RealDictCursor, connect_timeout=10)


# ── Schema ─────────────────────────────────────────────────────────────────────

SCHEMA_SQL = """
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS products (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    brand       TEXT NOT NULL,
    category    TEXT NOT NULL,
    price       NUMERIC(10, 2) NOT NULL,
    currency    TEXT NOT NULL DEFAULT 'INR',
    rating      NUMERIC(3, 1) NOT NULL,
    features    JSONB NOT NULL DEFAULT '[]',
    tags        JSONB NOT NULL DEFAULT '[]',
    description TEXT NOT NULL DEFAULT '',
    stock       INTEGER NOT NULL DEFAULT 100,
    embedding   vector(1024),
    doc_text    TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at ON products;
CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS products_embedding_idx
    ON products USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 10);
"""


def init_db():
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(SCHEMA_SQL)
        conn.commit()
        print("✅ Database schema + pgvector ready.")
    finally:
        conn.close()


# ── Seed ───────────────────────────────────────────────────────────────────────

def seed_from_json(json_path: str = "products.json", default_stock: int = 100):
    """Insert products from JSON (without embeddings — ingest_db.py adds those)."""
    with open(json_path) as f:
        products = json.load(f)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            for p in products:
                cur.execute("""
                    INSERT INTO products
                        (id, name, brand, category, price, currency, rating,
                         features, tags, description, stock)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (id) DO NOTHING
                """, (
                    p["id"], p["name"], p["brand"], p["category"],
                    p["price"], p.get("currency", "INR"), p["rating"],
                    json.dumps(p.get("features", [])),
                    json.dumps(p.get("tags", [])),
                    p.get("description", ""),
                    default_stock,
                ))
        conn.commit()
        print(f"✅ Seeded {len(products)} products.")
    finally:
        conn.close()


# ── Embedding upsert ────────────────────────────────────────────────────────────

def upsert_embedding(product_id: str, embedding: List[float], doc_text: str):
    """Store or update the vector embedding for a product."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE products
                SET embedding = %s::vector, doc_text = %s
                WHERE id = %s
            """, (embedding, doc_text, product_id))
        conn.commit()
    finally:
        conn.close()


def delete_embedding(product_id: str):
    """Clear embedding when product is deleted (handled by cascade on delete)."""
    pass  # deletion of the row handles this


# ── Vector search ───────────────────────────────────────────────────────────────

def vector_search(query_embedding: List[float], k: int = 10) -> List[Dict]:
    """
    Cosine similarity search using pgvector.
    Excludes products with stock = 0.
    Returns top-k products with similarity scores.
    """
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    id, name, brand, category, price, currency,
                    rating, features, tags, description, stock, doc_text,
                    1 - (embedding <=> %s::vector) AS similarity
                FROM products
                WHERE embedding IS NOT NULL
                  AND stock > 0
                ORDER BY embedding <=> %s::vector
                LIMIT %s
            """, (query_embedding, query_embedding, k))
            rows = cur.fetchall()
            result = []
            for r in rows:
                d = dict(r)
                d["features"] = d["features"] if isinstance(d["features"], list) else json.loads(d["features"])
                d["tags"]     = d["tags"]     if isinstance(d["tags"], list)     else json.loads(d["tags"])
                d["price"]    = float(d["price"])
                d["rating"]   = float(d["rating"])
                d["similarity"] = float(d["similarity"])
                result.append(d)
            return result
    finally:
        conn.close()


# ── BM25 docs loader ─────────────────────────────────────────────────────────────

def get_docs_for_bm25() -> List[Dict]:
    """
    Returns all in-stock products with doc_text for BM25 index.
    Called at startup to build the in-memory BM25 index.
    Stock=0 products excluded.
    """
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, name, brand, category, price, currency,
                       rating, features, tags, description, stock, doc_text
                FROM products
                WHERE stock > 0 AND doc_text IS NOT NULL
                ORDER BY id
            """)
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


# ── CRUD ───────────────────────────────────────────────────────────────────────

def get_all_products(category: Optional[str] = None) -> List[Dict]:
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            if category:
                cur.execute("SELECT * FROM products WHERE category=%s ORDER BY rating DESC", (category,))
            else:
                cur.execute("SELECT * FROM products ORDER BY rating DESC")
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


def get_product_by_id(product_id: str) -> Optional[Dict]:
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM products WHERE id=%s", (product_id,))
            row = cur.fetchone()
            if not row:
                return None
            d = dict(row)
            d["features"] = d["features"] if isinstance(d["features"], list) else json.loads(d["features"])
            d["tags"]     = d["tags"]     if isinstance(d["tags"], list)     else json.loads(d["tags"])
            d["price"]    = float(d["price"])
            d["rating"]   = float(d["rating"])
            return d
    finally:
        conn.close()


def get_low_stock_products(threshold: int = LOW_STOCK_THRESHOLD) -> List[Dict]:
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM products WHERE stock <= %s ORDER BY stock ASC", (threshold,))
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


def create_product(data: Dict) -> Dict:
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO products
                    (id, name, brand, category, price, currency, rating,
                     features, tags, description, stock)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                RETURNING *
            """, (
                data["id"], data["name"], data["brand"], data["category"],
                data["price"], data.get("currency", "INR"), data["rating"],
                json.dumps(data.get("features", [])),
                json.dumps(data.get("tags", [])),
                data.get("description", ""),
                data.get("stock", 100),
            ))
            row = cur.fetchone()
        conn.commit()
        d = dict(row)
        d["features"] = d["features"] if isinstance(d["features"], list) else json.loads(d["features"])
        d["tags"]     = d["tags"]     if isinstance(d["tags"], list)     else json.loads(d["tags"])
        d["price"]    = float(d["price"])
        d["rating"]   = float(d["rating"])
        return d
    finally:
        conn.close()


def update_product(product_id: str, data: Dict) -> Optional[Dict]:
    allowed = {"name","brand","category","price","currency","rating","features","tags","description","stock"}
    fields  = {k: v for k, v in data.items() if k in allowed}
    if not fields:
        return get_product_by_id(product_id)
    for key in ("features", "tags"):
        if key in fields and isinstance(fields[key], list):
            fields[key] = json.dumps(fields[key])
    set_clause = ", ".join(f"{k}=%s" for k in fields)
    values     = list(fields.values()) + [product_id]
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(f"UPDATE products SET {set_clause} WHERE id=%s RETURNING *", values)
            row = cur.fetchone()
        conn.commit()
        if not row:
            return None
        d = dict(row)
        d["features"] = d["features"] if isinstance(d["features"], list) else json.loads(d["features"])
        d["tags"]     = d["tags"]     if isinstance(d["tags"], list)     else json.loads(d["tags"])
        d["price"]    = float(d["price"])
        d["rating"]   = float(d["rating"])
        return d
    finally:
        conn.close()


def update_stock(product_id: str, delta: int) -> Optional[Dict]:
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE products SET stock=GREATEST(0, stock+%s)
                WHERE id=%s RETURNING *
            """, (delta, product_id))
            row = cur.fetchone()
        conn.commit()
        if not row:
            return None
        d = dict(row)
        d["features"] = d["features"] if isinstance(d["features"], list) else json.loads(d["features"])
        d["tags"]     = d["tags"]     if isinstance(d["tags"], list)     else json.loads(d["tags"])
        d["price"]    = float(d["price"])
        d["rating"]   = float(d["rating"])
        return d
    finally:
        conn.close()


def set_stock(product_id: str, quantity: int) -> Optional[Dict]:
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("UPDATE products SET stock=%s WHERE id=%s RETURNING *", (max(0,quantity), product_id))
            row = cur.fetchone()
        conn.commit()
        if not row:
            return None
        d = dict(row)
        d["features"] = d["features"] if isinstance(d["features"], list) else json.loads(d["features"])
        d["tags"]     = d["tags"]     if isinstance(d["tags"], list)     else json.loads(d["tags"])
        d["price"]    = float(d["price"])
        d["rating"]   = float(d["rating"])
        return d
    finally:
        conn.close()


def delete_product(product_id: str) -> bool:
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM products WHERE id=%s", (product_id,))
            deleted = cur.rowcount > 0
        conn.commit()
        return deleted
    finally:
        conn.close()


def get_products_as_dicts() -> List[Dict]:
    """For ingest_db.py compatibility."""
    return get_all_products()