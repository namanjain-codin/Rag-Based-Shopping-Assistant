import { useState, useMemo, useRef, useEffect } from "react";
import { PRODUCTS, CATEGORIES, CATEGORY_ICONS } from "./products.js";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

// ── Helpers ───────────────────────────────────────────────────────────────────
const stars = (r) => "★".repeat(Math.floor(r)) + (r % 1 >= 0.5 ? "½" : "") + "☆".repeat(5 - Math.ceil(r));
const catColor = {
  Footwear:"#6366f1", Clothing:"#ec4899", Bags:"#f59e0b", Accessories:"#10b981",
  Fitness:"#ef4444", Camping:"#84cc16", Electronics:"#3b82f6",
  Equipment:"#8b5cf6", Sports:"#f97316", Travel:"#06b6d4"
};
const getCatBg = (cat) => catColor[cat] || "#6366f1";

// ── Product Card (catalog) ────────────────────────────────────────────────────
function ProductCard({ p, onAskAI }) {
  return (
    <div className="pcard">
      <div className="pcard-img" style={{ background: `linear-gradient(135deg, ${getCatBg(p.category)}22 0%, ${getCatBg(p.category)}44 100%)` }}>
        <span className="pcard-cat-icon">{CATEGORY_ICONS[p.category]}</span>
        <span className="pcard-cat-badge" style={{ background: getCatBg(p.category) }}>{p.category}</span>
      </div>
      <div className="pcard-body">
        <p className="pcard-brand">{p.brand}</p>
        <h3 className="pcard-name">{p.name}</h3>
        <div className="pcard-stars">
          <span className="stars">{stars(p.rating)}</span>
          <span className="rating-num">{p.rating}</span>
        </div>
        <div className="pcard-features">
          {p.features.map(f => <span key={f} className="feat-pill">{f}</span>)}
        </div>
        <p className="pcard-desc">{p.description.slice(0, 80)}…</p>
        <div className="pcard-footer">
          <span className="pcard-price">₹{p.price.toLocaleString()}</span>
          <button className="btn-ai" onClick={() => onAskAI(p.name)}>Ask AI ✦</button>
        </div>
      </div>
    </div>
  );
}

// ── AI Result Card ────────────────────────────────────────────────────────────
function AIResultCard({ rec, rank }) {
  const [open, setOpen] = useState(false);
  const sb = rec.score_breakdown;
  return (
    <div className="ai-card" style={{ animationDelay: `${rank * 60}ms` }}>
      <div className="ai-card-rank">#{rank + 1}</div>
      <div className="ai-card-main">
        <div className="ai-card-header">
          <div>
            <span className="ai-cat-badge" style={{ background: getCatBg(rec.category) }}>{rec.category}</span>
            <h3 className="ai-name">{rec.name}</h3>
            <p className="ai-brand">{rec.brand}</p>
          </div>
          <div className="ai-right">
            <div className="ai-price">₹{rec.price.toLocaleString()}</div>
            <div className="ai-stars">{stars(rec.rating)} <span>{rec.rating}</span></div>
          </div>
        </div>
        <p className="ai-explanation">{rec.explanation}</p>
        <div className="ai-features">
          {rec.features.slice(0, 5).map(f => <span key={f} className="feat-pill">{f}</span>)}
        </div>
        <button className="score-toggle" onClick={() => setOpen(!open)}>
          {open ? "▲ Hide scores" : "▼ Score breakdown"}
        </button>
        {open && (
          <div className="score-bars">
            {[
              { label: "Semantic", val: sb.semantic, color: "#6366f1" },
              { label: "Price fit", val: sb.price_fit, color: "#10b981" },
              { label: "Features", val: sb.feature_match, color: "#f59e0b" },
              { label: "Rating", val: sb.rating, color: "#ec4899" },
            ].map(s => (
              <div key={s.label} className="score-row">
                <span>{s.label}</span>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.min(s.val * 100, 100)}%`, background: s.color }} /></div>
                <span>{(s.val * 100).toFixed(0)}%</span>
              </div>
            ))}
            <div className="final-score">Final score: {(sb.final_score * 100).toFixed(1)}</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Compare Card ──────────────────────────────────────────────────────────────
function CompareCard({ entry, isWinner }) {
  return (
    <div className={`cmp-card${isWinner ? " cmp-winner" : ""}`}>
      {isWinner && <div className="winner-label">🏆 Best pick</div>}
      <h3 className="cmp-name">{entry.product_name}</h3>
      <div className="cmp-meta">
        <span className="cmp-price">₹{entry.price?.toLocaleString()}</span>
        <span className="cmp-rating">{stars(Math.round(entry.rating * 2) / 2)} {entry.rating}</span>
      </div>
      <span className={`fit-badge fit-${(entry.use_case_fit || "").toLowerCase()}`}>{entry.use_case_fit} fit</span>
      <div className="cmp-section">
        {entry.pros?.map((p, i) => <div key={i} className="cmp-pro">✓ {p}</div>)}
      </div>
      <div className="cmp-section">
        {entry.cons?.map((c, i) => <div key={i} className="cmp-con">✗ {c}</div>)}
      </div>
      <p className="cmp-verdict">{entry.verdict}</p>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState("home");  // home | search | compare | metrics
  const [mobileNav, setMobileNav] = useState(false);

  // Catalog state
  const [cat, setCat] = useState("All");
  const [sort, setSort] = useState("rating");
  const [search, setSearch] = useState("");

  // AI Recommend state
  const [aiQuery, setAiQuery] = useState("");
  const [topN, setTopN] = useState(3);
  const [aiResult, setAiResult] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

  // Compare state
  const [cmpNames, setCmpNames] = useState("");
  const [cmpUseCase, setCmpUseCase] = useState("");
  const [cmpResult, setCmpResult] = useState(null);
  const [cmpLoading, setCmpLoading] = useState(false);
  const [cmpError, setCmpError] = useState("");

  // Metrics
  const [metrics, setMetrics] = useState(null);
  const [metricsLoading, setMetricsLoading] = useState(false);

  const searchRef = useRef(null);

  const filtered = useMemo(() => {
    let list = PRODUCTS;
    if (cat !== "All") list = list.filter(p => p.category === cat);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q) ||
        p.features.some(f => f.toLowerCase().includes(q))
      );
    }
    if (sort === "rating") list = [...list].sort((a, b) => b.rating - a.rating);
    if (sort === "price-asc") list = [...list].sort((a, b) => a.price - b.price);
    if (sort === "price-desc") list = [...list].sort((a, b) => b.price - a.price);
    return list;
  }, [cat, sort, search]);

  const handleAskAI = (name) => {
    setAiQuery(`Tell me about ${name} and similar products`);
    setPage("search");
    setTimeout(() => searchRef.current?.focus(), 100);
  };

  const handleSearch = async () => {
    if (!aiQuery.trim()) return;
    setAiLoading(true); setAiError(""); setAiResult(null);
    try {
      const res = await fetch(`${API_BASE}/recommend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: aiQuery.trim(), top_n: topN }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || "Request failed");
      setAiResult(await res.json());
    } catch (e) { setAiError(e.message); }
    setAiLoading(false);
  };

  const handleCompare = async () => {
    const names = cmpNames.split(",").map(s => s.trim()).filter(Boolean);
    if (names.length < 2) { setCmpError("Enter at least 2 product names, separated by commas."); return; }
    if (!cmpUseCase.trim()) { setCmpError("Please describe the use case."); return; }
    setCmpLoading(true); setCmpError(""); setCmpResult(null);
    try {
      const res = await fetch(`${API_BASE}/compare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_names: names, use_case: cmpUseCase.trim() }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || "Request failed");
      setCmpResult(await res.json());
    } catch (e) { setCmpError(e.message); }
    setCmpLoading(false);
  };

  const handleMetrics = async () => {
    setMetricsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/metrics`);
      setMetrics(await res.json());
    } catch {}
    setMetricsLoading(false);
  };

  const navItems = [
    { id: "home", label: "Shop" },
    { id: "search", label: "AI Search" },
    { id: "compare", label: "Compare" },
    { id: "metrics", label: "Metrics" },
  ];

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --bg: #0f0f0f;
          --surface: #1a1a1a;
          --surface2: #242424;
          --border: rgba(255,255,255,0.08);
          --border2: rgba(255,255,255,0.14);
          --text: #f0f0ef;
          --muted: #888884;
          --muted2: #555552;
          --accent: #7c6ef5;
          --accent2: #9d92f7;
          --green: #22c55e;
          --radius: 12px;
          --radius-sm: 7px;
        }
        body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; min-height: 100vh; }

        /* NAV */
        nav { position: sticky; top: 0; z-index: 100; background: rgba(15,15,15,0.92); backdrop-filter: blur(12px); border-bottom: 0.5px solid var(--border); }
        .nav-inner { max-width: 1200px; margin: 0 auto; padding: 0 1.5rem; height: 60px; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
        .nav-logo { display: flex; align-items: center; gap: 10px; cursor: pointer; text-decoration: none; }
        .logo-icon { width: 34px; height: 34px; border-radius: 9px; background: var(--accent); display: flex; align-items: center; justify-content: center; font-size: 17px; flex-shrink: 0; }
        .logo-text { font-size: 18px; font-weight: 700; letter-spacing: -0.5px; color: var(--text); }
        .logo-sub { font-size: 11px; color: var(--muted); margin-top: -2px; }
        .nav-links { display: flex; gap: 4px; }
        .nav-link { padding: 7px 14px; border-radius: var(--radius-sm); font-size: 14px; cursor: pointer; border: none; background: transparent; color: var(--muted); font-family: inherit; transition: all 0.15s; font-weight: 500; }
        .nav-link:hover { color: var(--text); background: var(--surface2); }
        .nav-link.active { color: var(--text); background: var(--surface2); }
        .nav-ai-btn { padding: 8px 18px; background: var(--accent); color: #fff; border: none; border-radius: 20px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; transition: opacity 0.15s; white-space: nowrap; }
        .nav-ai-btn:hover { opacity: 0.88; }
        @media (max-width: 640px) {
          .nav-links { display: none; }
          .nav-links.open { display: flex; flex-direction: column; position: absolute; top: 60px; left: 0; right: 0; background: rgba(15,15,15,0.98); border-bottom: 0.5px solid var(--border); padding: 12px; gap: 4px; }
          .hamburger { display: flex; flex-direction: column; gap: 4px; cursor: pointer; padding: 8px; border: none; background: transparent; }
          .hamburger span { width: 20px; height: 2px; background: var(--text); border-radius: 2px; }
        }
        @media (min-width: 641px) { .hamburger { display: none; } }

        /* HERO */
        .hero { max-width: 1200px; margin: 0 auto; padding: 3.5rem 1.5rem 1.5rem; }
        .hero-headline { font-size: clamp(28px, 5vw, 48px); font-weight: 800; letter-spacing: -1.5px; line-height: 1.1; margin-bottom: 12px; }
        .hero-accent { color: var(--accent2); }
        .hero-sub { font-size: 16px; color: var(--muted); max-width: 480px; line-height: 1.7; margin-bottom: 28px; }
        .hero-searchbar { display: flex; gap: 10px; max-width: 600px; background: var(--surface); border: 1px solid var(--border2); border-radius: 50px; padding: 6px 6px 6px 20px; }
        .hero-searchbar input { flex: 1; background: transparent; border: none; outline: none; font-size: 15px; color: var(--text); font-family: inherit; }
        .hero-searchbar input::placeholder { color: var(--muted2); }
        .hero-search-btn { padding: 10px 22px; background: var(--accent); color: #fff; border: none; border-radius: 50px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit; white-space: nowrap; }
        .hero-stats { display: flex; gap: 2rem; margin-top: 2.5rem; flex-wrap: wrap; }
        .hero-stat span:first-child { font-size: 22px; font-weight: 700; display: block; }
        .hero-stat span:last-child { font-size: 12px; color: var(--muted); }

        /* CATEGORY STRIP */
        .cat-strip { max-width: 1200px; margin: 0 auto; padding: 1.5rem 1.5rem 0; }
        .cat-scroll { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; scrollbar-width: none; }
        .cat-scroll::-webkit-scrollbar { display: none; }
        .cat-pill { display: flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 50px; border: 0.5px solid var(--border2); background: var(--surface); cursor: pointer; font-size: 13px; color: var(--muted); white-space: nowrap; transition: all 0.15s; font-family: inherit; font-weight: 500; }
        .cat-pill:hover { border-color: var(--accent); color: var(--text); }
        .cat-pill.active { background: var(--accent); border-color: var(--accent); color: #fff; }

        /* PRODUCT GRID */
        .catalog { max-width: 1200px; margin: 0 auto; padding: 1.5rem; }
        .catalog-toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 10px; }
        .catalog-count { font-size: 14px; color: var(--muted); }
        .sort-select { background: var(--surface); border: 0.5px solid var(--border2); border-radius: var(--radius-sm); padding: 8px 12px; color: var(--text); font-size: 13px; cursor: pointer; font-family: inherit; }
        .product-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }

        /* PRODUCT CARD */
        .pcard { background: var(--surface); border: 0.5px solid var(--border); border-radius: var(--radius); overflow: hidden; transition: transform 0.2s, border-color 0.2s; cursor: default; }
        .pcard:hover { transform: translateY(-3px); border-color: var(--border2); }
        .pcard-img { height: 140px; display: flex; align-items: center; justify-content: center; position: relative; }
        .pcard-cat-icon { font-size: 52px; }
        .pcard-cat-badge { position: absolute; top: 10px; right: 10px; font-size: 10px; color: #fff; padding: 3px 8px; border-radius: 20px; font-weight: 600; letter-spacing: 0.04em; }
        .pcard-body { padding: 14px; }
        .pcard-brand { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 3px; }
        .pcard-name { font-size: 14px; font-weight: 600; line-height: 1.35; margin-bottom: 6px; }
        .pcard-stars { display: flex; align-items: center; gap: 5px; margin-bottom: 8px; }
        .stars { color: #f59e0b; font-size: 12px; letter-spacing: 1px; }
        .rating-num { font-size: 12px; color: var(--muted); }
        .pcard-features { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
        .feat-pill { font-size: 10px; padding: 2px 7px; border-radius: 12px; background: var(--surface2); color: var(--muted); border: 0.5px solid var(--border); }
        .pcard-desc { font-size: 12px; color: var(--muted); line-height: 1.5; margin-bottom: 12px; }
        .pcard-footer { display: flex; justify-content: space-between; align-items: center; }
        .pcard-price { font-size: 16px; font-weight: 700; color: var(--text); }
        .btn-ai { padding: 6px 14px; background: transparent; border: 0.5px solid var(--accent); color: var(--accent2); border-radius: 20px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; transition: all 0.15s; }
        .btn-ai:hover { background: var(--accent); color: #fff; }

        /* PAGE WRAPPER */
        .page { max-width: 860px; margin: 0 auto; padding: 2rem 1.5rem 4rem; }
        .page-title { font-size: 24px; font-weight: 700; letter-spacing: -0.5px; margin-bottom: 6px; }
        .page-sub { font-size: 14px; color: var(--muted); margin-bottom: 1.75rem; }

        /* SEARCH PAGE */
        .search-box { background: var(--surface); border: 0.5px solid var(--border2); border-radius: var(--radius); padding: 1.25rem; margin-bottom: 1.5rem; }
        .search-row { display: flex; gap: 10px; align-items: stretch; }
        .search-input { flex: 1; background: var(--surface2); border: 0.5px solid var(--border2); border-radius: var(--radius-sm); padding: 11px 14px; font-size: 15px; color: var(--text); font-family: inherit; outline: none; transition: border-color 0.15s; }
        .search-input:focus { border-color: var(--accent); }
        .topn-select { background: var(--surface2); border: 0.5px solid var(--border2); border-radius: var(--radius-sm); padding: 11px 12px; color: var(--text); font-size: 14px; cursor: pointer; font-family: inherit; }
        .primary-btn { padding: 11px 24px; background: var(--accent); color: #fff; border: none; border-radius: var(--radius-sm); font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit; white-space: nowrap; transition: opacity 0.15s; }
        .primary-btn:hover { opacity: 0.88; }
        .primary-btn:disabled { opacity: 0.45; cursor: not-allowed; }

        /* AI CARDS */
        .ai-card { display: flex; gap: 0; background: var(--surface); border: 0.5px solid var(--border); border-radius: var(--radius); overflow: hidden; margin-bottom: 12px; animation: slideUp 0.3s ease both; }
        @keyframes slideUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        .ai-card-rank { width: 44px; display: flex; align-items: center; justify-content: center; background: var(--accent); color: #fff; font-size: 14px; font-weight: 700; flex-shrink: 0; }
        .ai-card-main { flex: 1; padding: 1.1rem 1.25rem; min-width: 0; }
        .ai-card-header { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
        .ai-cat-badge { font-size: 10px; color: #fff; padding: 2px 8px; border-radius: 12px; font-weight: 600; display: inline-block; margin-bottom: 4px; }
        .ai-name { font-size: 16px; font-weight: 700; line-height: 1.3; }
        .ai-brand { font-size: 12px; color: var(--muted); margin-top: 2px; }
        .ai-right { text-align: right; flex-shrink: 0; }
        .ai-price { font-size: 18px; font-weight: 700; color: var(--accent2); }
        .ai-stars { font-size: 12px; color: var(--muted); margin-top: 3px; }
        .ai-stars .stars { color: #f59e0b; }
        .ai-explanation { font-size: 14px; line-height: 1.65; color: #ccc; margin: 8px 0 10px; }
        .ai-features { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 10px; }
        .score-toggle { background: transparent; border: 0.5px solid var(--border2); border-radius: var(--radius-sm); padding: 5px 12px; font-size: 12px; color: var(--muted); cursor: pointer; font-family: inherit; transition: background 0.15s; }
        .score-toggle:hover { background: var(--surface2); }
        .score-bars { margin-top: 10px; border-top: 0.5px solid var(--border); padding-top: 10px; }
        .score-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 12px; color: var(--muted); }
        .score-row > span:first-child { width: 70px; flex-shrink: 0; }
        .score-row > span:last-child { width: 32px; text-align: right; flex-shrink: 0; }
        .bar-track { flex: 1; height: 4px; background: var(--surface2); border-radius: 4px; overflow: hidden; }
        .bar-fill { height: 100%; border-radius: 4px; transition: width 0.5s; }
        .final-score { font-size: 13px; font-weight: 600; color: var(--accent2); margin-top: 8px; }

        /* RESULT META */
        .result-meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 16px; font-size: 13px; color: var(--muted); }
        .cache-pill { font-size: 11px; padding: 3px 9px; border-radius: 12px; background: #22c55e18; color: #4ade80; }
        .miss-pill { background: #6366f118; color: #a5b4fc; }

        /* COMPARE */
        .cmp-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
        .cmp-card { background: var(--surface); border: 0.5px solid var(--border); border-radius: var(--radius); padding: 1.25rem; }
        .cmp-winner { border: 1.5px solid var(--accent); }
        .winner-label { font-size: 12px; font-weight: 600; color: var(--accent2); margin-bottom: 8px; }
        .cmp-name { font-size: 15px; font-weight: 700; margin-bottom: 8px; line-height: 1.3; }
        .cmp-meta { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
        .cmp-price { font-size: 17px; font-weight: 700; color: var(--accent2); }
        .cmp-rating { font-size: 12px; color: var(--muted); }
        .fit-badge { font-size: 11px; font-weight: 600; padding: 3px 9px; border-radius: 12px; display: inline-block; margin-bottom: 10px; }
        .fit-high { background: #22c55e18; color: #4ade80; }
        .fit-medium { background: #f59e0b18; color: #fbbf24; }
        .fit-low { background: #ef444418; color: #f87171; }
        .cmp-section { margin-bottom: 6px; }
        .cmp-pro { font-size: 13px; color: #4ade80; margin-bottom: 3px; }
        .cmp-con { font-size: 13px; color: #f87171; margin-bottom: 3px; }
        .cmp-verdict { font-size: 13px; color: var(--muted); margin-top: 10px; font-style: italic; border-top: 0.5px solid var(--border); padding-top: 10px; }
        .cmp-summary { background: var(--surface); border: 0.5px solid var(--border); border-radius: var(--radius); padding: 1.25rem; margin-bottom: 14px; font-size: 14px; line-height: 1.7; color: #ccc; }
        .cmp-winner-note { font-size: 13px; color: var(--muted); margin-top: 10px; border-top: 0.5px solid var(--border); padding-top: 10px; }

        /* METRICS */
        .metrics-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; margin-top: 1.25rem; }
        .metric-card { background: var(--surface); border: 0.5px solid var(--border); border-radius: var(--radius); padding: 1rem 1.1rem; }
        .metric-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px; }
        .metric-value { font-size: 24px; font-weight: 700; }

        /* MISC */
        .field-group { margin-bottom: 1rem; }
        label { font-size: 13px; color: var(--muted); display: block; margin-bottom: 6px; font-weight: 500; }
        .text-input { width: 100%; background: var(--surface2); border: 0.5px solid var(--border2); border-radius: var(--radius-sm); padding: 11px 14px; font-size: 14px; color: var(--text); font-family: inherit; outline: none; transition: border-color 0.15s; }
        .text-input:focus { border-color: var(--accent); }
        textarea.text-input { resize: vertical; min-height: 68px; }
        .error-box { background: #ef444412; color: #f87171; font-size: 13px; padding: 10px 14px; border-radius: var(--radius-sm); margin-top: 10px; }
        .hint { font-size: 12px; color: var(--muted2); margin-top: 4px; }
        .spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.25); border-top-color: #fff; border-radius: 50%; animation: spin 0.7s linear infinite; vertical-align: -2px; margin-right: 6px; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .empty-state { text-align: center; padding: 4rem 1rem; color: var(--muted); }
        .empty-state .big { font-size: 48px; margin-bottom: 12px; }

        /* FOOTER */
        footer { border-top: 0.5px solid var(--border); padding: 2rem 1.5rem; text-align: center; color: var(--muted2); font-size: 13px; }
        .footer-inner { max-width: 1200px; margin: 0 auto; }
        .tech-badges { display: flex; justify-content: center; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
        .tech-badge { font-size: 11px; padding: 3px 10px; border-radius: 12px; border: 0.5px solid var(--border2); color: var(--muted); }
      `}</style>

      {/* NAV */}
      <nav>
        <div className="nav-inner">
          <div className="nav-logo" onClick={() => { setPage("home"); setMobileNav(false); }}>
            <div className="logo-icon">🛒</div>
            <div>
              <div className="logo-text">ShopLens</div>
              <div className="logo-sub">RAG Shopping Assistant</div>
            </div>
          </div>
          <div className={`nav-links${mobileNav ? " open" : ""}`}>
            {navItems.map(n => (
              <button key={n.id} className={`nav-link${page === n.id ? " active" : ""}`}
                onClick={() => { setPage(n.id); setMobileNav(false); }}>
                {n.label}
              </button>
            ))}
          </div>
          <button className="nav-ai-btn" onClick={() => { setPage("search"); setMobileNav(false); }}>
            ✦ Ask AI
          </button>
          <button className="hamburger" onClick={() => setMobileNav(!mobileNav)} aria-label="Menu">
            <span /><span /><span />
          </button>
        </div>
      </nav>

      {/* HOME PAGE */}
      {page === "home" && (
        <>
          <div className="hero">
            <h1 className="hero-headline">
              Shop smarter with<br /><span className="hero-accent">AI-powered search</span>
            </h1>
            <p className="hero-sub">
              Natural language recommendations using hybrid RAG retrieval — just describe what you need.
            </p>
            <div className="hero-searchbar">
              <input
                placeholder='Try "waterproof hiking boots under ₹2000"…'
                onKeyDown={e => { if (e.key === "Enter" && e.target.value.trim()) { setAiQuery(e.target.value); setPage("search"); } }}
                onChange={e => setAiQuery(e.target.value)}
                value={aiQuery}
              />
              <button className="hero-search-btn" onClick={() => { if (aiQuery.trim()) setPage("search"); }}>
                Search with AI →
              </button>
            </div>
            <div className="hero-stats">
              <div className="hero-stat"><span>40</span><span>Products</span></div>
              <div className="hero-stat"><span>10</span><span>Categories</span></div>
              <div className="hero-stat"><span>BM25 + FAISS</span><span>Hybrid retrieval</span></div>
              <div className="hero-stat"><span>RRF</span><span>Rank fusion</span></div>
            </div>
          </div>

          <div className="cat-strip">
            <div className="cat-scroll">
              {CATEGORIES.map(c => (
                <button key={c} className={`cat-pill${cat === c ? " active" : ""}`} onClick={() => setCat(c)}>
                  {CATEGORY_ICONS[c] || "📦"} {c}
                </button>
              ))}
            </div>
          </div>

          <div className="catalog">
            <div className="catalog-toolbar">
              <span className="catalog-count">{filtered.length} products{cat !== "All" ? ` in ${cat}` : ""}{search ? ` matching "${search}"` : ""}</span>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  className="text-input" style={{ width: 180, padding: "7px 12px", fontSize: 13 }}
                  placeholder="Filter products…" value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                <select className="sort-select" value={sort} onChange={e => setSort(e.target.value)}>
                  <option value="rating">Top rated</option>
                  <option value="price-asc">Price: low to high</option>
                  <option value="price-desc">Price: high to low</option>
                </select>
              </div>
            </div>
            {filtered.length === 0 ? (
              <div className="empty-state">
                <div className="big">🔍</div>
                <p>No products match your filter.</p>
              </div>
            ) : (
              <div className="product-grid">
                {filtered.map(p => <ProductCard key={p.id} p={p} onAskAI={handleAskAI} />)}
              </div>
            )}
          </div>
        </>
      )}

      {/* AI SEARCH PAGE */}
      {page === "search" && (
        <div className="page">
          <h1 className="page-title">AI Search</h1>
          <p className="page-sub">Describe what you need in plain English — our RAG pipeline finds the best matches.</p>
          <div className="search-box">
            <div className="search-row">
              <input
                ref={searchRef}
                className="search-input"
                value={aiQuery}
                onChange={e => setAiQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSearch()}
                placeholder='e.g. "waterproof camping gear under ₹1500"'
              />
              <select className="topn-select" value={topN} onChange={e => setTopN(Number(e.target.value))}>
                {[1,2,3,4,5].map(n => <option key={n} value={n}>Top {n}</option>)}
              </select>
              <button className="primary-btn" onClick={handleSearch} disabled={aiLoading || !aiQuery.trim()}>
                {aiLoading ? <><span className="spinner" />Searching…</> : "Search ✦"}
              </button>
            </div>
            {aiError && <div className="error-box">{aiError}</div>}
          </div>

          {aiResult && (
            <>
              <div className="result-meta">
                <span>Results for: <strong>{aiResult.query}</strong></span>
                <span className={`cache-pill${aiResult.cache_hit ? "" : " miss-pill"}`}>
                  {aiResult.cache_hit ? "💾 cache hit" : "🔄 fresh extraction"}
                </span>
                {aiResult.extracted_constraints.max_price && <span>Budget: ₹{aiResult.extracted_constraints.max_price}</span>}
                {aiResult.extracted_constraints.category && <span>Category: {aiResult.extracted_constraints.category}</span>}
              </div>
              {aiResult.recommendations.map((r, i) => <AIResultCard key={r.id} rec={r} rank={i} />)}
            </>
          )}

          {!aiResult && !aiLoading && (
            <div className="empty-state">
              <div className="big">✦</div>
              <p>Enter a query above to get AI-powered recommendations.</p>
            </div>
          )}
        </div>
      )}

      {/* COMPARE PAGE */}
      {page === "compare" && (
        <div className="page">
          <h1 className="page-title">Compare Products</h1>
          <p className="page-sub">Compare 2–4 products side by side for your specific use case.</p>
          <div className="search-box">
            <div className="field-group">
              <label>Product names (comma-separated)</label>
              <input className="text-input" value={cmpNames} onChange={e => setCmpNames(e.target.value)}
                placeholder="e.g. AquaShield Hiking Boots, CloudWalk Running Shoes" />
              <p className="hint">Use partial names — we'll match them from the catalog</p>
            </div>
            <div className="field-group" style={{ marginBottom: 0 }}>
              <label>Use case / intent</label>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <textarea className="text-input" value={cmpUseCase} onChange={e => setCmpUseCase(e.target.value)}
                  placeholder="e.g. monsoon trekking in the Himalayas" style={{ flex: 1 }} />
                <button className="primary-btn" onClick={handleCompare} disabled={cmpLoading} style={{ flexShrink: 0, marginTop: 0 }}>
                  {cmpLoading ? <><span className="spinner" />Comparing…</> : "Compare ⚖️"}
                </button>
              </div>
            </div>
            {cmpError && <div className="error-box">{cmpError}</div>}
          </div>

          {cmpResult && (
            <>
              {cmpResult.comparison.summary && (
                <div className="cmp-summary">
                  {cmpResult.comparison.summary}
                  {cmpResult.comparison.winner && (
                    <div className="cmp-winner-note">
                      🏆 Best overall: <strong>{cmpResult.comparison.winner.product_id}</strong> — {cmpResult.comparison.winner.reason}
                    </div>
                  )}
                </div>
              )}
              <div className="cmp-grid">
                {cmpResult.comparison.comparison_table?.map(e => (
                  <CompareCard key={e.product_id} entry={e}
                    isWinner={e.product_id === cmpResult.comparison.winner?.product_id} />
                ))}
              </div>
            </>
          )}

          {!cmpResult && !cmpLoading && (
            <div className="empty-state">
              <div className="big">⚖️</div>
              <p>Enter product names above to compare them.</p>
            </div>
          )}
        </div>
      )}

      {/* METRICS PAGE */}
      {page === "metrics" && (
        <div className="page">
          <h1 className="page-title">API Metrics</h1>
          <p className="page-sub">Live operational stats from your ShopLens backend.</p>
          <div className="search-box" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 14, color: "var(--muted)" }}>Click to pull fresh data from your Render API</span>
            <button className="primary-btn" onClick={handleMetrics} disabled={metricsLoading}>
              {metricsLoading ? <><span className="spinner" />Loading…</> : "Fetch metrics"}
            </button>
          </div>
          {metrics && (
            <div className="metrics-grid">
              {[
                { label: "Total requests", value: metrics.total_requests },
                { label: "Recommend calls", value: metrics.recommend_requests },
                { label: "Compare calls", value: metrics.compare_requests },
                { label: "Errors", value: metrics.errors },
                { label: "Cache hits", value: metrics.cache_hits },
                { label: "Cache misses", value: metrics.cache_misses },
                { label: "Cache hit rate", value: `${metrics.cache_hit_rate_pct}%` },
                { label: "Avg latency", value: `${metrics.avg_latency_ms}ms` },
                { label: "Rec latency", value: `${metrics.avg_recommend_latency_ms}ms` },
                { label: "Cmp latency", value: `${metrics.avg_compare_latency_ms}ms` },
                { label: "Cached extractions", value: metrics.constraint_cache_size },
              ].map(m => (
                <div key={m.label} className="metric-card">
                  <div className="metric-label">{m.label}</div>
                  <div className="metric-value">{m.value}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <footer>
        <div className="footer-inner">
          <p>ShopLens · RAG-powered shopping assistant built with FastAPI, LangChain, FAISS, BM25 & Mistral AI</p>
          <div className="tech-badges">
            {["FastAPI", "LangChain", "FAISS", "BM25 + RRF", "Mistral AI", "React + Vite", "Render", "Vercel"].map(t => (
              <span key={t} className="tech-badge">{t}</span>
            ))}
          </div>
        </div>
      </footer>
    </>
  );
}
