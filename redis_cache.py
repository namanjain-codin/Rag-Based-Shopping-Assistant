"""
cache.py
--------
Redis caching layer using Upstash Redis (REST API).
Uses Upstash's HTTP REST API — no persistent TCP connection needed

Cache keys used:
  constraint:{query_hash}     → extracted constraints (TTL: 1 hour)
  products:all                → all products list (TTL: 5 minutes)
  products:low_stock          → low stock list (TTL: 30 seconds)
  bm25:docs                   → serialized doc texts for BM25 (TTL: 10 minutes)
"""

import os
import json
import hashlib
import urllib.request
import urllib.error
from typing import Any, Optional
from dotenv import load_dotenv

load_dotenv()

# TTLs in seconds
TTL_CONSTRAINTS   = 3600   # 1 hour  — constraint extraction results
TTL_PRODUCTS      = 300    # 5 min   — full product list
TTL_LOW_STOCK     = 30     # 30 sec  — low stock list (changes frequently)
TTL_BM25_DOCS     = 600    # 10 min  — BM25 doc cache
TTL_RECOMMEND     = 1800   # 30 min  — full recommendation results


def _get_config():
    url   = os.getenv("UPSTASH_REDIS_REST_URL", "").rstrip("/")
    token = os.getenv("UPSTASH_REDIS_REST_TOKEN", "")
    return url, token


def _is_configured() -> bool:
    url, token = _get_config()
    return bool(url and token)


def _request(method: str, *args) -> Any:
    """Make a REST API call to Upstash Redis."""
    url, token = _get_config()
    if not url or not token:
        return None

    endpoint = f"{url}/{method}/{'/'.join(str(a) for a in args)}"
    req = urllib.request.Request(
        endpoint,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type":  "application/json",
            "User-Agent":    "ShopLens/1.0",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read())
            return data.get("result")
    except Exception as e:
        print(f"⚠️  Redis {method} error: {e}")
        return None


def _post(command: list) -> Any:
    """POST a Redis command as JSON array."""
    url, token = _get_config()
    if not url or not token:
        return None

    payload = json.dumps(command).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type":  "application/json",
            "User-Agent":    "ShopLens/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read())
            return data.get("result")
    except Exception as e:
        print(f"⚠️  Redis POST error: {e}")
        return None


# ── Core get/set/delete ────────────────────────────────────────────────────────

def get(key: str) -> Optional[Any]:
    """Get a value from Redis. Returns None on miss or error."""
    if not _is_configured():
        return None
    result = _request("get", key)
    if result is None:
        return None
    try:
        return json.loads(result)
    except (json.JSONDecodeError, TypeError):
        return result


def set(key: str, value: Any, ttl: int = TTL_CONSTRAINTS) -> bool:
    """Set a value in Redis with TTL in seconds."""
    if not _is_configured():
        return False
    serialized = json.dumps(value)
    result = _post(["SET", key, serialized, "EX", ttl])
    return result == "OK"


def delete(key: str) -> bool:
    """Delete a key from Redis."""
    if not _is_configured():
        return False
    result = _post(["DEL", key])
    return bool(result)


def flush_pattern(pattern: str) -> int:
    """Delete all keys matching a pattern (e.g. 'products:*')."""
    if not _is_configured():
        return 0
    # SCAN to find matching keys
    keys_result = _post(["KEYS", pattern])
    if not keys_result:
        return 0
    deleted = 0
    for key in keys_result:
        if delete(key):
            deleted += 1
    print(f"🗑️  Flushed {deleted} Redis keys matching '{pattern}'")
    return deleted


def ping() -> bool:
    """Check if Redis is reachable."""
    if not _is_configured():
        return False
    result = _post(["PING"])
    return result == "PONG"


# ── Constraint cache ───────────────────────────────────────────────────────────

def query_hash(query: str) -> str:
    """Stable hash for a query string → used as cache key."""
    return hashlib.md5(query.strip().lower().encode()).hexdigest()


def get_recommendation(query: str, top_n: int) -> Optional[dict]:
    key    = f"recommend:{query_hash(query)}:{top_n}"
    cached = get(key)
    if cached:
        print(f"💾 Redis HIT — full recommendation for: '{query[:50]}' top_n={top_n}")
    return cached


def set_recommendation(query: str, top_n: int, result: dict) -> bool:
    key = f"recommend:{query_hash(query)}:{top_n}"
    ok  = set(key, result, TTL_RECOMMEND)
    if ok:
        print(f"✅ Redis SET — recommendation cached for: '{query[:50]}' top_n={top_n}")
    return ok


def invalidate_recommendations():
    """Call when products change — cached recommendations may be stale."""
    flush_pattern("recommend:*")


def get_constraints(query: str) -> Optional[dict]:
    key    = f"constraint:{query_hash(query)}"
    cached = get(key)
    if cached:
        print(f"💾 Redis HIT — constraints for: '{query[:50]}'")
    return cached


def set_constraints(query: str, constraints: dict) -> bool:
    key = f"constraint:{query_hash(query)}"
    ok  = set(key, constraints, TTL_CONSTRAINTS)
    if ok:
        print(f"✅ Redis SET — constraints cached for: '{query[:50]}'")
    return ok


# ── Product cache ──────────────────────────────────────────────────────────────

def _strip_datetimes(obj):
    """Remove non-JSON-serializable fields (datetime) from dicts."""
    if isinstance(obj, list):
        return [_strip_datetimes(i) for i in obj]
    if isinstance(obj, dict):
        return {k: v for k, v in obj.items()
                if not hasattr(v, 'isoformat')}  # drop datetime objects
    return obj


def get_products(category: Optional[str] = None) -> Optional[list]:
    key = f"products:all:{category or 'all'}"
    return get(key)


def set_products(products: list, category: Optional[str] = None) -> bool:
    key = f"products:all:{category or 'all'}"
    return set(key, _strip_datetimes(products), TTL_PRODUCTS)


def get_low_stock() -> Optional[list]:
    return get("products:low_stock")


def set_low_stock(items: list) -> bool:
    return set("products:low_stock", _strip_datetimes(items), TTL_LOW_STOCK)


def invalidate_products():
    """Call this after any product create/update/delete."""
    flush_pattern("products:*")


# ── BM25 doc cache ─────────────────────────────────────────────────────────────

def get_bm25_docs() -> Optional[list]:
    return get("bm25:docs")


def set_bm25_docs(docs: list) -> bool:
    return set("bm25:docs", _strip_datetimes(docs), TTL_BM25_DOCS)


def invalidate_bm25():
    delete("bm25:docs")


# ── Stats ──────────────────────────────────────────────────────────────────────

def get_stats() -> dict:
    """Returns Redis info for the metrics endpoint."""
    if not _is_configured():
        return {"configured": False}
    try:
        dbsize = _post(["DBSIZE"])
        return {
            "configured": True,
            "ping":       ping(),
            "key_count":  dbsize or 0,
            "ttls": {
                "constraints_sec": TTL_CONSTRAINTS,
                "products_sec":    TTL_PRODUCTS,
                "low_stock_sec":   TTL_LOW_STOCK,
                "bm25_docs_sec":   TTL_BM25_DOCS,
            }
        }
    except Exception as e:
        return {"configured": True, "error": str(e)}