"""
api.py  (v3 — pgvector + synchronized embeddings)
---------------------------------------------------
Key additions over v2:
- POST /products     → creates product + generates embedding immediately
- DELETE /products   → deletes product + embedding from pgvector
- PATCH  /products/{id}/stock → if stock goes 0, excluded from search automatically
- PUT    /products/{id}       → if description/features change, re-embeds
- POST   /admin/reindex       → rebuild BM25 + re-embed any missing vectors
"""

import os
import time
import json
from contextlib import asynccontextmanager
from typing import List, Optional, Dict, Any

from fastapi import FastAPI, HTTPException, Request, Header, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from worker import load_services, get_recommendations, compare_products, reload_bm25, build_doc_text
from database import (
    init_db, seed_from_json,
    get_all_products, get_product_by_id, get_low_stock_products,
    create_product, update_product, update_stock, set_stock, delete_product,
    upsert_embedding, LOW_STOCK_THRESHOLD,
)
import redis_cache

# ── Config ────────────────────────────────────────────────────────────────────
ADMIN_SECRET = os.getenv("ADMIN_SECRET", "shoplens-admin-2024")

services: Dict[str, Any] = {}
metrics = {
    "total_requests": 0, "recommend_requests": 0, "compare_requests": 0,
    "cache_hits": 0, "cache_misses": 0, "total_latency_ms": 0.0,
    "recommend_latency_ms": 0.0, "compare_latency_ms": 0.0, "errors": 0,
}
_constraint_cache: Dict[str, Any] = {}


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("🚀 Starting ShopLens API (pgvector mode)...")
    init_db()
    services.update(load_services())
    print("✅ Ready.")
    yield
    services.clear()


app = FastAPI(title="🛒 ShopLens API v3", version="3.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        os.getenv("FRONTEND_URL", "https://rag-based-shopping-assistant.vercel.app"),
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Auth ──────────────────────────────────────────────────────────────────────

def require_admin(x_admin_key: Optional[str] = Header(default=None)):
    if x_admin_key != ADMIN_SECRET:
        raise HTTPException(status_code=401, detail="Invalid or missing admin key.")


# ── Middleware ────────────────────────────────────────────────────────────────

@app.middleware("http")
async def track_latency(request: Request, call_next):
    start = time.perf_counter()
    try:
        response = await call_next(request)
        metrics["total_requests"]   += 1
        metrics["total_latency_ms"] += (time.perf_counter() - start) * 1000
        return response
    except Exception:
        metrics["errors"] += 1
        raise


# ── Pydantic models ───────────────────────────────────────────────────────────

class ProductOut(BaseModel):
    id: str; name: str; brand: str; category: str
    price: float; currency: str; rating: float
    features: List[str]; tags: List[str]; description: str; stock: int

class ProductCreate(BaseModel):
    id: str; name: str; brand: str; category: str
    price: float = Field(..., gt=0)
    currency: str = "INR"
    rating: float = Field(..., ge=0, le=5)
    features: List[str] = []
    tags: List[str] = []
    description: str = ""
    stock: int = Field(default=100, ge=0)

class ProductUpdate(BaseModel):
    name: Optional[str] = None; brand: Optional[str] = None
    category: Optional[str] = None
    price: Optional[float] = Field(default=None, gt=0)
    currency: Optional[str] = None
    rating: Optional[float] = Field(default=None, ge=0, le=5)
    features: Optional[List[str]] = None
    tags: Optional[List[str]] = None
    description: Optional[str] = None

class StockUpdate(BaseModel):
    action: str = Field(..., description="'set' | 'add' | 'subtract'")
    quantity: int = Field(..., ge=0)

class RecommendRequest(BaseModel):
    query: str
    top_n: int = Field(default=3, ge=1, le=10)

class CompareRequest(BaseModel):
    product_names: List[str] = Field(..., min_length=2)
    use_case: str


# ── Embedding helper ──────────────────────────────────────────────────────────

def embed_and_store(product: dict):
    """Generate embedding for a product and store it in pgvector. Runs in background."""
    try:
        doc_text  = build_doc_text(product)
        embedding = services["embeddings"].embed_query(doc_text)
        upsert_embedding(product["id"], embedding, doc_text)
        reload_bm25(services)
        redis_cache.invalidate_products()
        redis_cache.invalidate_recommendations()
        print(f"✅ Embedded and indexed: {product['name']}")
    except Exception as e:
        print(f"⚠️  Failed to embed {product['id']}: {e}")


# ── Product endpoints ─────────────────────────────────────────────────────────

@app.get("/products", response_model=List[ProductOut])
def list_products(category: Optional[str] = None):
    # Try Redis first
    cached = redis_cache.get_products(category)
    if cached:
        print(f"💾 Redis HIT — products:{category or 'all'}")
        return cached
    # DB fallback
    products = get_all_products(category)
    redis_cache.set_products(products, category)
    return products


@app.get("/products/low-stock")
def low_stock(threshold: int = LOW_STOCK_THRESHOLD):
    cached = redis_cache.get_low_stock()
    if cached is not None:
        print("💾 Redis HIT — low_stock")
        return cached
    items  = get_low_stock_products(threshold)
    result = [{"id": r["id"], "name": r["name"], "category": r["category"], "stock": r["stock"]} for r in items]
    redis_cache.set_low_stock(result)
    return result


@app.get("/products/{product_id}", response_model=ProductOut)
def get_product(product_id: str):
    p = get_product_by_id(product_id)
    if not p:
        raise HTTPException(status_code=404, detail=f"Product {product_id} not found.")
    return p


@app.post("/products", response_model=ProductOut, status_code=201, dependencies=[Depends(require_admin)])
def add_product(body: ProductCreate, background_tasks: BackgroundTasks):
    """
    Creates product in DB, then generates embedding in the background.
    Product is immediately visible in the catalog.
    It appears in AI search results within ~5 seconds (after embedding).
    """
    if get_product_by_id(body.id):
        raise HTTPException(status_code=409, detail=f"Product '{body.id}' already exists.")
    created = create_product(body.model_dump())
    # Embed in background so HTTP response is instant
    background_tasks.add_task(embed_and_store, created)
    return created


@app.put("/products/{product_id}", response_model=ProductOut, dependencies=[Depends(require_admin)])
def edit_product(product_id: str, body: ProductUpdate, background_tasks: BackgroundTasks):
    """
    Updates product. If name/description/features/tags changed,
    re-generates the embedding in the background.
    """
    updates  = {k: v for k, v in body.model_dump().items() if v is not None}
    updated  = update_product(product_id, updates)
    if not updated:
        raise HTTPException(status_code=404, detail=f"Product {product_id} not found.")
    # Re-embed if text fields changed
    text_fields = {"name", "brand", "category", "description", "features", "tags"}
    if text_fields & set(updates.keys()):
        background_tasks.add_task(embed_and_store, updated)
    return updated


@app.patch("/products/{product_id}/stock", response_model=ProductOut, dependencies=[Depends(require_admin)])
def adjust_stock(product_id: str, body: StockUpdate, background_tasks: BackgroundTasks):
    if body.action   == "set":      result = set_stock(product_id, body.quantity)
    elif body.action == "add":      result = update_stock(product_id, +body.quantity)
    elif body.action == "subtract": result = update_stock(product_id, -body.quantity)
    else: raise HTTPException(status_code=400, detail="action must be 'set', 'add', or 'subtract'.")

    if not result:
        raise HTTPException(status_code=404, detail=f"Product {product_id} not found.")

    # Invalidate Redis product + low-stock + recommendation cache
    redis_cache.invalidate_products()
    redis_cache.invalidate_recommendations()
    background_tasks.add_task(reload_bm25, services)
    return result


@app.delete("/products/{product_id}", dependencies=[Depends(require_admin)])
def remove_product(product_id: str, background_tasks: BackgroundTasks):
    deleted = delete_product(product_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Product {product_id} not found.")
    redis_cache.invalidate_products()
    redis_cache.invalidate_recommendations()
    background_tasks.add_task(reload_bm25, services)
    return {"deleted": True, "id": product_id}


# ── Admin: reindex ────────────────────────────────────────────────────────────

@app.post("/admin/reindex", dependencies=[Depends(require_admin)])
async def reindex(background_tasks: BackgroundTasks):
    def _reindex():
        from ingest_db import ingest
        ingest(force=False)
        reload_bm25(services)
        redis_cache.invalidate_products()
        redis_cache.invalidate_recommendations()
        redis_cache.invalidate_bm25()
        print("✅ Reindex complete.")
    background_tasks.add_task(_reindex)
    return {"status": "reindex started in background"}


# ── RAG endpoints ─────────────────────────────────────────────────────────────

@app.post("/recommend")
def recommend(request: RecommendRequest):
    if not request.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty.")
    t_start = time.perf_counter(); cache_hit = False
    try:
        cache_key = request.query.strip().lower()
        if cache_key in _constraint_cache:
            services["_cached_constraints"] = _constraint_cache[cache_key]
            metrics["cache_hits"] += 1; cache_hit = True
        else:
            services["_cached_constraints"] = None
            metrics["cache_misses"] += 1
        result = get_recommendations(query=request.query, services=services, top_n=request.top_n)
        if not cache_hit:
            _constraint_cache[cache_key] = result["extracted_constraints"]
        metrics["recommend_requests"]   += 1
        metrics["recommend_latency_ms"] += (time.perf_counter() - t_start) * 1000
        return {**result, "cache_hit": cache_hit}
    except Exception as e:
        metrics["errors"] += 1
        raise HTTPException(status_code=500, detail=f"Recommendation failed: {str(e)}")


@app.post("/compare")
def compare(request: CompareRequest):
    t_start = time.perf_counter()
    try:
        result = compare_products(request.product_names, request.use_case, services)
        metrics["compare_requests"]   += 1
        metrics["compare_latency_ms"] += (time.perf_counter() - t_start) * 1000
        return result
    except ValueError as e:
        metrics["errors"] += 1
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        metrics["errors"] += 1
        raise HTTPException(status_code=500, detail=f"Comparison failed: {str(e)}")


# ── Utility ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    ready = bool(services.get("embeddings") and services.get("bm25_index") and services.get("llm"))
    low   = get_low_stock_products()
    return {
        "status": "healthy" if ready else "degraded",
        "mode":   "pgvector",
        "low_stock_count": len(low),
        "services": {
            "pgvector":   "supabase",
            "bm25":       f"{len(services.get('all_docs', []))} docs" if ready else "not loaded",
            "embeddings": "mistral-embed" if ready else "not loaded",
            "llm":        "mistral-large-latest" if ready else "not loaded",
        }
    }


@app.get("/metrics")
def get_metrics():
    total = metrics["total_requests"]; rc = metrics["recommend_requests"]; cc = metrics["compare_requests"]
    ct    = metrics["cache_hits"] + metrics["cache_misses"]
    return {
        "total_requests":           total,
        "recommend_requests":       rc,
        "compare_requests":         cc,
        "errors":                   metrics["errors"],
        "cache_hits":               metrics["cache_hits"],
        "cache_misses":             metrics["cache_misses"],
        "cache_hit_rate_pct":       round(metrics["cache_hits"]/ct*100 if ct else 0, 2),
        "avg_latency_ms":           round(metrics["total_latency_ms"]/total if total else 0, 2),
        "avg_recommend_latency_ms": round(metrics["recommend_latency_ms"]/rc if rc else 0, 2),
        "avg_compare_latency_ms":   round(metrics["compare_latency_ms"]/cc if cc else 0, 2),
        "constraint_cache_size":    len(_constraint_cache),
        "redis":                    redis_cache.get_stats(),
    }


@app.get("/")
def root():
    return {"message": "🛒 ShopLens API v3 — pgvector + Supabase"}

# ── Checkout endpoints ────────────────────────────────────────────────────────
from checkout import send_otp, verify_otp, send_confirmation

class CheckoutItem(BaseModel):
    id:    str
    name:  str
    qty:   int
    price: float

class SendOtpRequest(BaseModel):
    name:    str = Field(..., min_length=2)
    email:   str = Field(..., pattern=r"^[^@]+@[^@]+\.[^@]+$")
    mobile:  str = Field(..., min_length=10, max_length=15)
    address: str = Field(..., min_length=10)
    items:   List[CheckoutItem]
    total:   float

class VerifyOtpRequest(BaseModel):
    email: str
    otp:   str = Field(..., min_length=6, max_length=6)


@app.post("/checkout/send-otp")
def checkout_send_otp(body: SendOtpRequest):
    """
    Step 1 of checkout:
    Validates input, sends OTP to email, stores order data temporarily.
    """
    if not body.items:
        raise HTTPException(status_code=400, detail="Cart is empty.")
    try:
        send_otp(
            email=body.email,
            name=body.name,
            order_data={
                "name":    body.name,
                "email":   body.email,
                "mobile":  body.mobile,
                "address": body.address,
                "items":   [i.model_dump() for i in body.items],
                "total":   body.total,
            }
        )
        return {"status": "otp_sent", "email": body.email}
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to send OTP: {str(e)}")


@app.post("/checkout/verify-otp")
def checkout_verify_otp(body: VerifyOtpRequest, background_tasks: BackgroundTasks):
    """
    Step 2 of checkout:
    Verifies OTP → deducts stock → sends confirmation email.
    """
    try:
        record = verify_otp(email=body.email, otp=body.otp)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    order = record["order_data"]
    name  = record["name"]

    # Deduct stock for each item
    stock_errors = []
    for item in order["items"]:
        result = update_stock(item["id"], -item["qty"])
        if not result:
            stock_errors.append(item["name"])
        else:
            # Reload BM25 in background to reflect stock change
            background_tasks.add_task(reload_bm25, services)

    # Send confirmation email in background (don't block response)
    background_tasks.add_task(
        send_confirmation,
        email=order["email"],
        name=name,
        mobile=order["mobile"],
        address=order["address"],
        items=order["items"],
        total=order["total"],
    )

    return {
        "status":        "order_placed",
        "message":       f"Order confirmed! Confirmation sent to {order['email']}",
        "stock_errors":  stock_errors,
        "order_summary": {
            "name":    name,
            "email":   order["email"],
            "mobile":  order["mobile"],
            "address": order["address"],
            "items":   order["items"],
            "total":   order["total"],
        }
    }