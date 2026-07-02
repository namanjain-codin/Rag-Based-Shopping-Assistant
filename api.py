"""
api.py
------
FastAPI server with:
  POST /recommend  - Hybrid RAG recommendations with reranking
  POST /compare    - Structured product comparison table
  GET  /metrics    - Query latency, cache hit rate, request volume
  GET  /health     - Health check
  GET  /           - Root
"""

import time
from contextlib import asynccontextmanager
from typing import List, Optional, Dict, Any
from fastapi.middleware.cors import CORSMiddleware

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from worker import load_services, get_recommendations, compare_products

# ── Global state ──────────────────────────────────────────────────────────────
services: Dict[str, Any] = {}

# In-memory metrics store
metrics = {
    "total_requests":        0,
    "recommend_requests":    0,
    "compare_requests":      0,
    "cache_hits":            0,        # queries served from constraint cache
    "cache_misses":          0,
    "total_latency_ms":      0.0,      # cumulative latency across all requests
    "recommend_latency_ms":  0.0,
    "compare_latency_ms":    0.0,
    "errors":                0,
}

# Simple in-memory constraint cache: query string → extracted constraints
# Prevents redundant LLM calls for identical or repeated queries
_constraint_cache: Dict[str, Any] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("🚀 Starting ShopLens API...")
    services.update(load_services())
    print("✅ API is ready!")
    yield
    print("👋 Shutting down...")
    services.clear()


app = FastAPI(
    title="🛒 ShopLens — RAG Shopping Assistant",
    description=(
        "Natural language product recommendations using "
        "Hybrid Retrieval (BM25 + FAISS + RRF) "
        "with Constraint-Aware Reranking and explainability."
    ),
    version="4.1.0",
    lifespan=lifespan
)
 
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",          # Vite dev server
        "https://shoplens.vercel.app",    # Replace with your actual Vercel URL
        # Add any preview URLs e.g. "https://shoplens-git-main-yourname.vercel.app"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Middleware — track latency for every request ───────────────────────────────

@app.middleware("http")
async def track_latency_middleware(request: Request, call_next):
    """
    Runs before and after every request.
    Records total latency and increments global request counter.
    """
    start = time.perf_counter()
    try:
        response = await call_next(request)
        elapsed_ms = (time.perf_counter() - start) * 1000
        metrics["total_requests"]   += 1
        metrics["total_latency_ms"] += elapsed_ms
        return response
    except Exception:
        metrics["errors"] += 1
        raise


# ── Pydantic Models — /recommend ──────────────────────────────────────────────

class RecommendRequest(BaseModel):
    query: str = Field(..., description="Natural language shopping query")
    top_n: int = Field(default=3, ge=1, le=10)


class ScoreBreakdown(BaseModel):
    final_score:   float
    semantic:      float
    price_fit:     float
    feature_match: float
    rating:        float


class ProductRecommendation(BaseModel):
    id:              str
    name:            str
    brand:           str
    category:        str
    price:           float
    currency:        str
    rating:          float
    features:        List[str]
    score_breakdown: ScoreBreakdown
    explanation:     str


class ExtractedConstraints(BaseModel):
    max_price:         Optional[float] = None
    min_price:         Optional[float] = None
    min_rating:        Optional[float] = None
    category:          Optional[str]   = None
    required_features: List[str]       = []
    use_case:          Optional[str]   = None
    search_query:      Optional[str]   = None


class RetrievalInfo(BaseModel):
    method:                         str
    rerank_weights:                 Dict[str, float]
    total_candidates_before_rerank: int


class RecommendResponse(BaseModel):
    query:                 str
    cache_hit:             bool = Field(..., description="True if constraints were served from cache")
    extracted_constraints: ExtractedConstraints
    retrieval_info:        RetrievalInfo
    recommendations:       List[ProductRecommendation]


# ── Pydantic Models — /compare ────────────────────────────────────────────────

class CompareRequest(BaseModel):
    product_names: List[str] = Field(..., min_length=2)
    use_case:      str       = Field(..., description="Intended use case for the comparison")


class ComparisonTableEntry(BaseModel):
    product_id:   str
    product_name: str
    price:        float
    rating:       float
    pros:         List[str]
    cons:         List[str]
    best_for:     str
    use_case_fit: str
    verdict:      str


class Winner(BaseModel):
    product_id: str
    reason:     str


class ComparisonResult(BaseModel):
    summary:          str
    comparison_table: List[ComparisonTableEntry]
    winner:           Winner


class CompareResponse(BaseModel):
    use_case:          str
    products_compared: List[str]
    not_found:         List[str] = []
    comparison:        ComparisonResult


# ── Pydantic Models — /metrics ────────────────────────────────────────────────

class MetricsResponse(BaseModel):
    total_requests:           int
    recommend_requests:       int
    compare_requests:         int
    errors:                   int
    cache_hits:               int
    cache_misses:             int
    cache_hit_rate_pct:       float = Field(..., description="Cache hit rate as a percentage")
    avg_latency_ms:           float = Field(..., description="Average latency across all requests (ms)")
    avg_recommend_latency_ms: float = Field(..., description="Average /recommend endpoint latency (ms)")
    avg_compare_latency_ms:   float = Field(..., description="Average /compare endpoint latency (ms)")
    constraint_cache_size:    int   = Field(..., description="Number of cached constraint extractions")


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {
        "message":  "🛒 ShopLens RAG Shopping Assistant is live!",
        "endpoints": {
            "POST /recommend": "Natural language product recommendations",
            "POST /compare":   "Structured comparison table for 2-4 products",
            "GET  /metrics":   "Query latency, cache hit rate, request volume",
            "GET  /health":    "Service health check",
        }
    }


@app.get("/health")
def health():
    """
    Returns service health status.
    Checks that services (FAISS, BM25, LLM) are loaded and ready.
    """
    ready = bool(services.get("vectorstore") and services.get("bm25_index") and services.get("llm"))
    return {
        "status":   "healthy" if ready else "degraded",
        "services": {
            "faiss":    "loaded" if services.get("vectorstore") else "not loaded",
            "bm25":     "loaded" if services.get("bm25_index")  else "not loaded",
            "llm":      "loaded" if services.get("llm")         else "not loaded",
        }
    }


@app.get("/metrics", response_model=MetricsResponse)
def get_metrics():
    """
    Returns live operational metrics:
    - Request counts per endpoint
    - Average latency (overall, /recommend, /compare)
    - Cache hit rate for constraint extraction
    - Error count
    """
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
        "cache_hit_rate_pct":       round((metrics["cache_hits"] / cache_total * 100) if cache_total > 0 else 0.0, 2),
        "avg_latency_ms":           round(metrics["total_latency_ms"]     / total     if total     > 0 else 0.0, 2),
        "avg_recommend_latency_ms": round(metrics["recommend_latency_ms"] / rec_count if rec_count > 0 else 0.0, 2),
        "avg_compare_latency_ms":   round(metrics["compare_latency_ms"]   / cmp_count if cmp_count > 0 else 0.0, 2),
        "constraint_cache_size":    len(_constraint_cache),
    }


@app.post("/recommend", response_model=RecommendResponse)
def recommend(request: RecommendRequest):
    """
    Get product recommendations from a natural language query.
    Constraint extraction results are cached — repeated/identical
    queries skip the LLM extraction call entirely.
    """
    if not request.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty.")

    t_start   = time.perf_counter()
    cache_hit = False

    try:
        # Check constraint cache
        cache_key = request.query.strip().lower()
        if cache_key in _constraint_cache:
            print(f"💾 Cache hit for query: '{request.query}'")
            cached_constraints           = _constraint_cache[cache_key]
            services["_cached_constraints"] = cached_constraints
            metrics["cache_hits"]        += 1
            cache_hit                    = True
        else:
            services["_cached_constraints"] = None
            metrics["cache_misses"]      += 1

        result = get_recommendations(
            query=request.query,
            services=services,
            top_n=request.top_n
        )

        # Store extracted constraints in cache for next time
        if not cache_hit:
            _constraint_cache[cache_key] = result["extracted_constraints"]

        elapsed_ms = (time.perf_counter() - t_start) * 1000
        metrics["recommend_requests"]  += 1
        metrics["recommend_latency_ms"] += elapsed_ms

        return {**result, "cache_hit": cache_hit}

    except Exception as e:
        metrics["errors"] += 1
        raise HTTPException(status_code=500, detail=f"Recommendation failed: {str(e)}")


@app.post("/compare", response_model=CompareResponse)
def compare(request: CompareRequest):
    """
    Compare 2-4 products side by side for a specific use case.
    Returns pros, cons, use-case fit, verdict, and an overall winner.
    """
    if len(request.product_names) < 2:
        raise HTTPException(status_code=400, detail="Provide at least 2 product names.")
    if len(request.product_names) > 4:
        raise HTTPException(status_code=400, detail="Compare at most 4 products at a time.")
    if not request.use_case.strip():
        raise HTTPException(status_code=400, detail="use_case cannot be empty.")

    t_start = time.perf_counter()
    try:
        result     = compare_products(
            product_names=request.product_names,
            use_case=request.use_case,
            services=services
        )
        elapsed_ms = (time.perf_counter() - t_start) * 1000
        metrics["compare_requests"]   += 1
        metrics["compare_latency_ms"] += elapsed_ms
        return result

    except ValueError as e:
        metrics["errors"] += 1
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        metrics["errors"] += 1
        raise HTTPException(status_code=500, detail=f"Comparison failed: {str(e)}")
