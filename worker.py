"""
worker.py  (v2 — pgvector edition)
------------------------------------
RAG pipeline using pgvector for semantic search instead of FAISS.
BM25 still runs in-memory, rebuilt from DB at startup.
Stock=0 products are automatically excluded from all search results.
"""

import os
import json
import time
from typing import List, Dict, Any, Optional, Tuple

from dotenv import load_dotenv
from langchain_mistralai import MistralAIEmbeddings, ChatMistralAI
from langchain_core.prompts import PromptTemplate
from langchain_core.documents import Document
from rank_bm25 import BM25Okapi

from database import get_docs_for_bm25, vector_search

load_dotenv()

RERANK_WEIGHTS = {
    "semantic":      0.40,
    "price_fit":     0.30,
    "feature_match": 0.20,
    "rating":        0.10,
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def build_doc_text(p: dict) -> str:
    """Builds the text representation of a product for BM25 + embedding."""
    return (
        f"Product: {p['name']}\n"
        f"Brand: {p['brand']}\n"
        f"Category: {p['category']}\n"
        f"Price: ₹{p['price']}\n"
        f"Rating: {p['rating']} / 5\n"
        f"Features: {', '.join(p.get('features', []))}\n"
        f"Tags: {', '.join(p.get('tags', []))}\n"
        f"Description: {p.get('description', '')}"
    )


def product_to_doc(p: dict) -> Document:
    return Document(
        page_content=p.get("doc_text") or build_doc_text(p),
        metadata={
            "id":       p["id"],
            "name":     p["name"],
            "brand":    p["brand"],
            "category": p["category"],
            "price":    p["price"],
            "currency": p.get("currency", "INR"),
            "rating":   p["rating"],
            "features": p.get("features", []),
            "tags":     p.get("tags", []),
            "stock":    p.get("stock", 0),
        }
    )


# ── Service initialization ────────────────────────────────────────────────────

def load_services() -> Dict[str, Any]:
    api_key = os.getenv("MISTRAL_API_KEY")
    if not api_key:
        raise ValueError("MISTRAL_API_KEY is missing.")

    print("🔗 Loading Mistral embeddings model...")
    embeddings = MistralAIEmbeddings(model="mistral-embed", api_key=api_key)

    print("📖 Loading in-stock products from DB for BM25...")
    db_docs = get_docs_for_bm25()
    all_docs = [product_to_doc(p) for p in db_docs]

    print(f"🔨 Building BM25 index over {len(all_docs)} in-stock products...")
    tokenized = [doc.page_content.lower().split() for doc in all_docs]
    bm25_index = BM25Okapi(tokenized)

    print("🤖 Loading Mistral LLM...")
    llm = ChatMistralAI(model="mistral-large-latest", api_key=api_key, temperature=0.2)

    print("✅ All services loaded (pgvector mode — no local FAISS).")
    return {
        "embeddings":  embeddings,
        "bm25_index":  bm25_index,
        "all_docs":    all_docs,
        "llm":         llm,
    }


def reload_bm25(services: Dict[str, Any]):
    """
    Rebuilds the in-memory BM25 index from DB.
    Call this after adding/deleting products via the admin panel.
    Stock=0 products are automatically excluded.
    """
    print("🔄 Reloading BM25 index from DB...")
    db_docs  = get_docs_for_bm25()
    all_docs = [product_to_doc(p) for p in db_docs]
    tokenized = [doc.page_content.lower().split() for doc in all_docs]
    services["bm25_index"] = BM25Okapi(tokenized)
    services["all_docs"]   = all_docs
    print(f"✅ BM25 rebuilt — {len(all_docs)} in-stock products indexed.")


# ── Constraint extraction ─────────────────────────────────────────────────────

CONSTRAINT_PROMPT = PromptTemplate(
    input_variables=["query"],
    template="""
You are a shopping assistant. Extract structured constraints from the user's shopping query.

User Query: "{query}"

Respond ONLY with a valid JSON object — no explanation, no markdown:
{{
  "max_price": <number or null>,
  "min_price": <number or null>,
  "min_rating": <number or null>,
  "category": <string or null>,
  "required_features": [<list of strings>],
  "use_case": "<brief description>",
  "search_query": "<clean rephrased query for semantic search>"
}}
"""
)


def extract_constraints(query: str, llm) -> Dict[str, Any]:
    print(f"\n🔍 Extracting constraints from: '{query}'")
    raw = (CONSTRAINT_PROMPT | llm).invoke({"query": query}).content.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1]
        if raw.endswith("```"):
            raw = raw[:-3].strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {
            "max_price": None, "min_price": None, "min_rating": None,
            "category": None, "required_features": [],
            "use_case": query, "search_query": query,
        }


# ── BM25 search ───────────────────────────────────────────────────────────────

def bm25_search(
    query: str,
    bm25_index: BM25Okapi,
    all_docs: List[Document],
    k: int = 10
) -> List[Tuple[Document, float]]:
    print(f"\n🔑 BM25 search: '{query}'")
    scores = bm25_index.get_scores(query.lower().split())
    scored = sorted(zip(all_docs, scores), key=lambda x: x[1], reverse=True)
    print(f"✅ BM25 returned {len(scored[:k])} candidates.")
    return scored[:k]


# ── pgvector semantic search ──────────────────────────────────────────────────

def semantic_search_pgvector(
    search_query: str,
    embeddings: MistralAIEmbeddings,
    k: int = 10
) -> List[Tuple[Document, float]]:
    """
    Embeds the query and runs cosine similarity search via pgvector.
    Returns (Document, similarity_score) pairs. Stock=0 excluded in SQL.
    """
    print(f"\n🔎 pgvector semantic search: '{search_query}'")
    query_vec = embeddings.embed_query(search_query)
    results   = vector_search(query_vec, k=k)

    docs_with_scores = []
    for r in results:
        doc = product_to_doc(r)
        docs_with_scores.append((doc, float(r["similarity"])))

    print(f"✅ pgvector returned {len(docs_with_scores)} candidates.")
    return docs_with_scores


# ── RRF ───────────────────────────────────────────────────────────────────────

def reciprocal_rank_fusion(
    bm25_results:     List[Tuple[Document, float]],
    semantic_results: List[Tuple[Document, float]],
    k: int = 60
) -> List[Tuple[Document, float]]:
    print("\n🔀 Applying RRF...")
    rrf_scores:  Dict[str, float]    = {}
    sem_scores:  Dict[str, float]    = {}
    doc_map:     Dict[str, Document] = {}

    for rank, (doc, _) in enumerate(bm25_results):
        did = doc.metadata["id"]
        rrf_scores[did] = rrf_scores.get(did, 0.0) + 1.0 / (rank + k)
        doc_map[did]    = doc

    for rank, (doc, sim) in enumerate(semantic_results):
        did = doc.metadata["id"]
        rrf_scores[did] = rrf_scores.get(did, 0.0) + 1.0 / (rank + k)
        sem_scores[did] = sim
        doc_map[did]    = doc

    sorted_ids = sorted(rrf_scores, key=lambda x: rrf_scores[x], reverse=True)
    overlap    = {d.metadata["id"] for d, _ in bm25_results} & \
                 {d.metadata["id"] for d, _ in semantic_results}
    print(f"✅ RRF merged {len(sorted_ids)} candidates. {len(overlap)} in both retrievers.")

    return [(doc_map[did], sem_scores.get(did, 0.5)) for did in sorted_ids]


# ── Reranking ─────────────────────────────────────────────────────────────────

def compute_price_fit(price: float, constraints: Dict) -> float:
    max_p, min_p = constraints.get("max_price"), constraints.get("min_price")
    if max_p is None and min_p is None: return 1.0
    if max_p is not None and price > max_p: return 0.0
    if min_p is not None and price < min_p: return 0.0
    if max_p and max_p > 0: return min(price / max_p, 1.0)
    return 1.0


def compute_feature_match(features: List[str], tags: List[str], required: List[str]) -> float:
    if not required: return 1.0
    combined = [f.lower() for f in features + tags]
    matched  = sum(1 for r in required if any(r.lower() in item for item in combined))
    return matched / len(required)


def constraint_aware_rerank(
    candidates:  List[Tuple[Document, float]],
    constraints: Dict
) -> List[Tuple[Document, float, Dict]]:
    print("\n⚖️  Constraint-aware reranking...")
    required = constraints.get("required_features", [])
    scored   = []
    for doc, sem_sim in candidates:
        meta          = doc.metadata
        price_fit     = compute_price_fit(meta["price"], constraints)
        feature_match = compute_feature_match(meta.get("features",[]), meta.get("tags",[]), required)
        rating_score  = meta["rating"] / 5.0
        final_score   = (
            RERANK_WEIGHTS["semantic"]      * sem_sim       +
            RERANK_WEIGHTS["price_fit"]     * price_fit     +
            RERANK_WEIGHTS["feature_match"] * feature_match +
            RERANK_WEIGHTS["rating"]        * rating_score
        )
        breakdown = {
            "final_score":   round(final_score,    4),
            "semantic":      round(sem_sim,         4),
            "price_fit":     round(price_fit,       4),
            "feature_match": round(feature_match,   4),
            "rating":        round(rating_score,    4),
        }
        scored.append((doc, final_score, breakdown))
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored


# ── Explanation ───────────────────────────────────────────────────────────────

EXPLANATION_PROMPT = PromptTemplate(
    input_variables=["user_query","use_case","product_details","constraints_summary","score_breakdown"],
    template="""
You are a helpful shopping assistant. Write a 2-sentence explanation of why this product
is a good match for the user's query. Be specific and mention key features.

User Query: "{user_query}"
Use Case: "{use_case}"
Constraints: {constraints_summary}
Product Details:
{product_details}
Score Breakdown:
{score_breakdown}

Write 2 concise sentences. Do NOT start with the product name.
"""
)


def generate_explanation(doc: Document, breakdown: Dict, query: str, constraints: Dict, llm) -> str:
    meta = doc.metadata
    cs   = []
    if constraints.get("max_price"):       cs.append(f"budget under ₹{constraints['max_price']}")
    if constraints.get("required_features"): cs.append(f"must have: {', '.join(constraints['required_features'])}")
    if constraints.get("category"):        cs.append(f"category: {constraints['category']}")
    product_details = (
        f"Name: {meta['name']}\nBrand: {meta['brand']}\n"
        f"Price: ₹{meta['price']}\nRating: {meta['rating']}/5\n"
        f"Features: {', '.join(meta.get('features', []))}\n"
        f"Description: {doc.page_content.split('Description:')[-1].strip()}"
    )
    score_text = "\n".join(f"  - {k.replace('_',' ').title()}: {v}" for k, v in breakdown.items() if k != "final_score")
    return (EXPLANATION_PROMPT | llm).invoke({
        "user_query":          query,
        "use_case":            constraints.get("use_case", query),
        "product_details":     product_details,
        "constraints_summary": ", ".join(cs) or "none",
        "score_breakdown":     score_text,
    }).content.strip()


# ── Compare ───────────────────────────────────────────────────────────────────

COMPARISON_PROMPT = PromptTemplate(
    input_variables=["use_case","products_block"],
    template="""
You are an expert product analyst. Compare the following products for this use case: "{use_case}"

{products_block}

Respond ONLY with valid JSON — no markdown:
{{
  "summary": "<2-3 sentence overall summary>",
  "comparison_table": [
    {{
      "product_id": "<id>",
      "product_name": "<name>",
      "price": <number>,
      "rating": <number>,
      "pros": ["<pro 1>", "<pro 2>", "<pro 3>"],
      "cons": ["<con 1>", "<con 2>"],
      "best_for": "<one sentence>",
      "use_case_fit": "<high | medium | low>",
      "verdict": "<one sentence recommendation>"
    }}
  ],
  "winner": {{"product_id": "<id>", "reason": "<why>"}}
}}
"""
)


def _find_product_by_name(name: str, all_docs: List[Document]) -> Optional[Document]:
    name_lower = name.lower().strip()
    for doc in all_docs:
        if doc.metadata["name"].lower() == name_lower: return doc
    for doc in all_docs:
        if name_lower in doc.metadata["name"].lower(): return doc
    for doc in all_docs:
        if doc.metadata["name"].lower() in name_lower: return doc
    return None


def compare_products(product_names: List[str], use_case: str, services: Dict) -> Dict:
    llm, all_docs = services["llm"], services["all_docs"]
    resolved, not_found = [], []
    for name in product_names:
        doc = _find_product_by_name(name, all_docs)
        if doc: resolved.append(doc)
        else:   not_found.append(name)
    if len(resolved) < 2:
        raise ValueError(f"Need at least 2 valid products. Not found: {not_found}")
    products_block = ""
    for doc in resolved:
        meta = doc.metadata
        products_block += (
            f"\n---\nID: {meta['id']}\nName: {meta['name']}\nBrand: {meta['brand']}\n"
            f"Category: {meta['category']}\nPrice: ₹{meta['price']}\nRating: {meta['rating']}/5\n"
            f"Features: {', '.join(meta.get('features',[]))}\n"
            f"Description: {doc.page_content.split('Description:')[-1].strip()}\n"
        )
    raw = (COMPARISON_PROMPT | llm).invoke({"use_case": use_case, "products_block": products_block}).content.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1]
        if raw.endswith("```"): raw = raw[:-3].strip()
    try:
        comparison = json.loads(raw)
    except json.JSONDecodeError:
        comparison = {"raw_response": raw}
    return {
        "use_case":          use_case,
        "products_compared": [doc.metadata["name"] for doc in resolved],
        "not_found":         not_found,
        "comparison":        comparison,
    }


# ── Main pipeline ─────────────────────────────────────────────────────────────

def hybrid_search(query: str, search_query: str, services: Dict, k: int = 10) -> List[Tuple[Document, float]]:
    bm25_results     = bm25_search(query, services["bm25_index"], services["all_docs"], k=k)
    semantic_results = semantic_search_pgvector(search_query, services["embeddings"], k=k)
    return reciprocal_rank_fusion(bm25_results, semantic_results)


def get_recommendations(query: str, services: Dict, top_n: int = 5) -> Dict:
    llm    = services["llm"]
    cached = services.get("_cached_constraints")
    if cached:
        print("💾 Using cached constraints.")
        constraints = cached if isinstance(cached, dict) else cached.dict()
    else:
        constraints = extract_constraints(query, llm)

    search_query = constraints.get("search_query", query)
    merged       = hybrid_search(query, search_query, services, k=10)
    reranked     = constraint_aware_rerank(merged, constraints)
    top_results  = reranked[:top_n]

    recommendations = []
    for doc, final_score, breakdown in top_results:
        meta        = doc.metadata
        explanation = generate_explanation(doc, breakdown, query, constraints, llm)
        recommendations.append({
            "id":              meta["id"],
            "name":            meta["name"],
            "brand":           meta["brand"],
            "category":        meta["category"],
            "price":           meta["price"],
            "currency":        meta.get("currency", "INR"),
            "rating":          meta["rating"],
            "features":        meta.get("features", []),
            "score_breakdown": breakdown,
            "explanation":     explanation,
        })
        time.sleep(2)

    return {
        "query":               query,
        "extracted_constraints": constraints,
        "retrieval_info": {
            "method":                         "Hybrid (BM25 + pgvector + RRF) + Constraint-Aware Reranking",
            "rerank_weights":                 RERANK_WEIGHTS,
            "total_candidates_before_rerank": len(merged),
        },
        "recommendations": recommendations,
    }