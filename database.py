import os
import json
from typing import List, Optional, Dict, Any
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

load_dotenv()

LOW_STOCK_THRESHOLD = 5


def get_conn():
    """Open a fresh PostgreSQL connection using DATABASE_URL."""
    url = os.getenv("DATABASE_URL")
    if not url:
        raise ValueError("DATABASE_URL is not set in environment variables.")
    if "sslmode" not in url:
        url += "?sslmode=require"
    return psycopg2.connect(url, cursor_factory=RealDictCursor)


# ── Schema bootstrap ──────────────────────────────────────────────────────────

SCHEMA_SQL = """
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
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at ON products;
CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
"""


def init_db():
    """Create table if it doesn't exist. Safe to call multiple times."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(SCHEMA_SQL)
        conn.commit()
        print("✅ Database schema ready.")
    finally:
        conn.close()


# ── Seed from products.json ───────────────────────────────────────────────────

def seed_from_json(json_path: str = "products.json", default_stock: int = 100):
    """
    Inserts products from products.json into the DB.
    Uses INSERT ... ON CONFLICT DO NOTHING so re-running is safe.
    """
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
        print(f"✅ Seeded {len(products)} products into the database.")
    finally:
        conn.close()


# ── Read operations ───────────────────────────────────────────────────────────

def get_all_products(category: Optional[str] = None) -> List[Dict]:
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            if category:
                cur.execute(
                    "SELECT * FROM products WHERE category = %s ORDER BY rating DESC",
                    (category,)
                )
            else:
                cur.execute("SELECT * FROM products ORDER BY rating DESC")
            rows = cur.fetchall()
            return [dict(r) for r in rows]
    finally:
        conn.close()


def get_product_by_id(product_id: str) -> Optional[Dict]:
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM products WHERE id = %s", (product_id,))
            row = cur.fetchone()
            return dict(row) if row else None
    finally:
        conn.close()


def get_low_stock_products(threshold: int = LOW_STOCK_THRESHOLD) -> List[Dict]:
    """Returns all products with stock <= threshold."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM products WHERE stock <= %s ORDER BY stock ASC",
                (threshold,)
            )
            return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


# ── Write operations ──────────────────────────────────────────────────────────

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
        return dict(row)
    finally:
        conn.close()


def update_product(product_id: str, data: Dict) -> Optional[Dict]:
    """Partial update — only updates fields present in data."""
    allowed = {"name", "brand", "category", "price", "currency",
               "rating", "features", "tags", "description", "stock"}
    fields = {k: v for k, v in data.items() if k in allowed}
    if not fields:
        return get_product_by_id(product_id)

    # Serialize JSON fields
    for key in ("features", "tags"):
        if key in fields and isinstance(fields[key], list):
            fields[key] = json.dumps(fields[key])

    set_clause = ", ".join(f"{k} = %s" for k in fields)
    values = list(fields.values()) + [product_id]

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE products SET {set_clause} WHERE id = %s RETURNING *",
                values
            )
            row = cur.fetchone()
        conn.commit()
        return dict(row) if row else None
    finally:
        conn.close()


def update_stock(product_id: str, delta: int) -> Optional[Dict]:
    """
    Atomically adjusts stock by delta (positive = restock, negative = deduct).
    Prevents stock from going below 0.
    """
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE products
                SET stock = GREATEST(0, stock + %s)
                WHERE id = %s
                RETURNING *
            """, (delta, product_id))
            row = cur.fetchone()
        conn.commit()
        return dict(row) if row else None
    finally:
        conn.close()


def set_stock(product_id: str, quantity: int) -> Optional[Dict]:
    """Set stock to an exact value."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE products SET stock = %s WHERE id = %s RETURNING *
            """, (max(0, quantity), product_id))
            row = cur.fetchone()
        conn.commit()
        return dict(row) if row else None
    finally:
        conn.close()


def delete_product(product_id: str) -> bool:
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM products WHERE id = %s", (product_id,))
            deleted = cur.rowcount > 0
        conn.commit()
        return deleted
    finally:
        conn.close()


# ── RAG sync helper ───────────────────────────────────────────────────────────

def get_products_as_dicts() -> List[Dict]:
    """
    Returns products in the same format as products.json —
    used by ingest.py to rebuild the FAISS/BM25 index from DB.
    """
    rows = get_all_products()
    result = []
    for r in rows:
        result.append({
            "id":          r["id"],
            "name":        r["name"],
            "brand":       r["brand"],
            "category":    r["category"],
            "price":       float(r["price"]),
            "currency":    r["currency"],
            "rating":      float(r["rating"]),
            "features":    r["features"] if isinstance(r["features"], list) else json.loads(r["features"]),
            "tags":        r["tags"] if isinstance(r["tags"], list) else json.loads(r["tags"]),
            "description": r["description"],
            "stock":       r["stock"],
        })
    return result