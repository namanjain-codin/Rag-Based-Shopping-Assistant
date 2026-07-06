"""
FastAPI server with:
  GET  /products                  - All products from DB (with stock)
  GET  /products/low-stock        - Products with stock <= 5
  POST /products                  - Create a new product (admin)
  PATCH /products/{id}/stock      - Adjust stock (admin)
  PUT  /products/{id}             - Update product fields (admin)
  DELETE /products/{id}           - Delete product (admin)
  POST /recommend                 - Hybrid RAG recommendations
  POST /compare                   - Structured comparison
  GET  /metrics                   - Operational metrics
  GET  /health                    - Health check
"""

import os
import time
import json
from contextlib import asynccontextmanager
from typing import List, Optional, Dict, Any

from fastapi import FastAPI, HTTPException, Request, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from worker import load_services, get_recommendations, compare_products
from database import (
    init_db, seed_from_json,
    get_all_products, get_product_by_id, get_low_stock_products,
    create_product, update_product, update_stock, set_stock, delete_product,
    LOW_STOCK_THRESHOLD,
)

# ── Config ────────────────────────────────────────────────────────────────────
ADMIN_SECRET = os.getenv("ADMIN_SECRET", "shoplens-admin-2024")
# Set a strong secret in Render env vars. Frontend sends it as X-Admin-Key header.

services: Dict[str, Any] = {}

metrics = {
    "total_requests":        0,
    "recommend_requests":    0,
    "compare_requests":      0,
    "cache_hits":            0,
    "cache_misses":          0,
    "total_latency_ms":      0.0,
    "recommend_latency_ms":  0.0,
    "compare_latency_ms":    0.0,
    "errors":                0,
}
_constraint_cache: Dict[str, Any] = {}


# ── Startup ───────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("🚀 Starting ShopLens API...")
    init_db()
    services.update(load_services())
    print("✅ API is ready!")
    yield
    print("👋 Shutting down...")
    services.clear()


app = FastAPI(
    title="🛒 ShopLens — RAG Shopping Assistant",
    description="Hybrid RAG recommendations + Supabase inventory management.",
    version="5.0.0",
    lifespan=lifespan,
)

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


# ── Auth dependency ───────────────────────────────────────────────────────────

def require_admin(x_admin_key: Optional[str] = Header(default=None)):
    if x_admin_key != ADMIN_SECRET:
        raise HTTPException(status_code=401, detail="Invalid or missing admin key.")


# ── Middleware ────────────────────────────────────────────────────────────────

@app.middleware("http")
async def track_latency_middleware(request: Request, call_next):
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
    id:          str
    name:        str
    brand:       str
    category:    str
    price:       float
    currency:    str
    rating:      float
    features:    List[str]
    tags:        List[str]
    description: str
    stock:       int

class ProductCreate(BaseModel):
    id:          str  = Field(..., description="Unique product ID e.g. P041")
    name:        str
    brand:       str
    category:    str
    price:       float = Field(..., gt=0)
    currency:    str   = "INR"
    rating:      float = Field(..., ge=0, le=5)
    features:    List[str] = []
    tags:        List[str] = []
    description: str   = ""
    stock:       int   = Field(default=100, ge=0)

class ProductUpdate(BaseModel):
    name:        Optional[str]       = None
    brand:       Optional[str]       = None
    category:    Optional[str]       = None
    price:       Optional[float]     = Field(default=None, gt=0)
    currency:    Optional[str]       = None
    rating:      Optional[float]     = Field(default=None, ge=0, le=5)
    features:    Optional[List[str]] = None
    tags:        Optional[List[str]] = None
    description: Optional[str]       = None

class StockUpdate(BaseModel):
    action:   str = Field(..., description="'set' | 'add' | 'subtract'")
    quantity: int = Field(..., ge=0)

class LowStockItem(BaseModel):
    id:       str
    name:     str
    category: str
    stock:    int

class RecommendRequest(BaseModel):
    query: str
    top_n: int = Field(default=3, ge=1, le=10)

class CompareRequest(BaseModel):
    product_names: List[str] = Field(..., min_length=2)
    use_case:      str


# ── Product endpoints ─────────────────────────────────────────────────────────

@app.get("/products", response_model=List[ProductOut])
def list_products(category: Optional[str] = None):
    """Returns all products from Supabase with current stock levels."""
    rows = get_all_products(category)
    # Normalize JSONB fields (psycopg2 may return them as list already)
    result = []
    for r in rows:
        r["features"] = r["features"] if isinstance(r["features"], list) else json.loads(r["features"])
        r["tags"]     = r["tags"]     if isinstance(r["tags"], list)     else json.loads(r["tags"])
        r["price"]    = float(r["price"])
        r["rating"]   = float(r["rating"])
        result.append(r)
    return result


@app.get("/products/low-stock", response_model=List[LowStockItem])
def low_stock(threshold: int = LOW_STOCK_THRESHOLD):
    """Returns products with stock at or below threshold (default 5)."""
    items = get_low_stock_products(threshold)
    return [{"id": r["id"], "name": r["name"], "category": r["category"], "stock": r["stock"]} for r in items]


@app.get("/products/{product_id}", response_model=ProductOut)
def get_product(product_id: str):
    p = get_product_by_id(product_id)
    if not p:
        raise HTTPException(status_code=404, detail=f"Product {product_id} not found.")
    p["features"] = p["features"] if isinstance(p["features"], list) else json.loads(p["features"])
    p["tags"]     = p["tags"]     if isinstance(p["tags"], list)     else json.loads(p["tags"])
    p["price"]    = float(p["price"])
    p["rating"]   = float(p["rating"])
    return p


@app.post("/products", response_model=ProductOut, status_code=201, dependencies=[Depends(require_admin)])
def add_product(body: ProductCreate):
    """Admin only. Creates a new product in DB. Doesn't auto-rebuild RAG index."""
    existing = get_product_by_id(body.id)
    if existing:
        raise HTTPException(status_code=409, detail=f"Product ID '{body.id}' already exists.")
    created = create_product(body.model_dump())
    created["features"] = created["features"] if isinstance(created["features"], list) else json.loads(created["features"])
    created["tags"]     = created["tags"]     if isinstance(created["tags"], list)     else json.loads(created["tags"])
    created["price"]    = float(created["price"])
    created["rating"]   = float(created["rating"])
    return created


@app.put("/products/{product_id}", response_model=ProductOut, dependencies=[Depends(require_admin)])
def edit_product(product_id: str, body: ProductUpdate):
    """Admin only. Partial update of product fields."""
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    updated = update_product(product_id, updates)
    if not updated:
        raise HTTPException(status_code=404, detail=f"Product {product_id} not found.")
    updated["features"] = updated["features"] if isinstance(updated["features"], list) else json.loads(updated["features"])
    updated["tags"]     = updated["tags"]     if isinstance(updated["tags"], list)     else json.loads(updated["tags"])
    updated["price"]    = float(updated["price"])
    updated["rating"]   = float(updated["rating"])
    return updated


@app.patch("/products/{product_id}/stock", response_model=ProductOut, dependencies=[Depends(require_admin)])
def adjust_stock(product_id: str, body: StockUpdate):
    """
    Admin only. Adjust product stock.
    action='set'      → sets stock to quantity
    action='add'      → increases stock by quantity
    action='subtract' → decreases stock by quantity (min 0)
    """
    if body.action == "set":
        result = set_stock(product_id, body.quantity)
    elif body.action == "add":
        result = update_stock(product_id, +body.quantity)
    elif body.action == "subtract":
        result = update_stock(product_id, -body.quantity)
    else:
        raise HTTPException(status_code=400, detail="action must be 'set', 'add', or 'subtract'.")

    if not result:
        raise HTTPException(status_code=404, detail=f"Product {product_id} not found.")
    result["features"] = result["features"] if isinstance(result["features"], list) else json.loads(result["features"])
    result["tags"]     = result["tags"]     if isinstance(result["tags"], list)     else json.loads(result["tags"])
    result["price"]    = float(result["price"])
    result["rating"]   = float(result["rating"])
    return result


@app.delete("/products/{product_id}", dependencies=[Depends(require_admin)])
def remove_product(product_id: str):
    """Admin only. Permanently deletes a product."""
    deleted = delete_product(product_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Product {product_id} not found.")
    return {"deleted": True, "id": product_id}


# ── RAG endpoints (unchanged) ─────────────────────────────────────────────────

@app.post("/recommend")
def recommend(request: RecommendRequest):
    if not request.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty.")
    t_start   = time.perf_counter()
    cache_hit = False
    try:
        cache_key = request.query.strip().lower()
        if cache_key in _constraint_cache:
            services["_cached_constraints"] = _constraint_cache[cache_key]
            metrics["cache_hits"] += 1
            cache_hit = True
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
    if len(request.product_names) < 2:
        raise HTTPException(status_code=400, detail="Provide at least 2 product names.")
    t_start = time.perf_counter()
    try:
        result = compare_products(
            product_names=request.product_names,
            use_case=request.use_case,
            services=services
        )
        metrics["compare_requests"]   += 1
        metrics["compare_latency_ms"] += (time.perf_counter() - t_start) * 1000
        return result
    except ValueError as e:
        metrics["errors"] += 1
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        metrics["errors"] += 1
        raise HTTPException(status_code=500, detail=f"Comparison failed: {str(e)}")


# ── Utility endpoints ─────────────────────────────────────────────────────────

@app.get("/health")
def health():
    ready = bool(services.get("vectorstore") and services.get("bm25_index") and services.get("llm"))
    low   = get_low_stock_products()
    return {
        "status":          "healthy" if ready else "degraded",
        "low_stock_count": len(low),
        "services": {
            "faiss": "loaded" if services.get("vectorstore") else "not loaded",
            "bm25":  "loaded" if services.get("bm25_index")  else "not loaded",
            "llm":   "loaded" if services.get("llm")         else "not loaded",
        }
    }


@app.get("/metrics")
def get_metrics():
    total       = metrics["total_requests"]
    rec_count   = metrics["recommend_requests"]
    cmp_count   = metrics["compare_requests"]
    cache_total = metrics["cache_hits"] + metrics["cache_misses"]
    return {
        "total_requests":           total,
        "recommend_requests":       rec_count,
        "compare_requests":         cmp_count,
        "errors":                   metrics["errors"],
        "cache_hits":               metrics["cache_hits"],
        "cache_misses":             metrics["cache_misses"],
        "cache_hit_rate_pct":       round((metrics["cache_hits"] / cache_total * 100) if cache_total else 0, 2),
        "avg_latency_ms":           round(metrics["total_latency_ms"]     / total     if total     else 0, 2),
        "avg_recommend_latency_ms": round(metrics["recommend_latency_ms"] / rec_count if rec_count else 0, 2),
        "avg_compare_latency_ms":   round(metrics["compare_latency_ms"]   / cmp_count if cmp_count else 0, 2),
        "constraint_cache_size":    len(_constraint_cache),
    }


@app.get("/")
def root():
    return {"message": "🛒 ShopLens API v5 with Supabase inventory is live!"}