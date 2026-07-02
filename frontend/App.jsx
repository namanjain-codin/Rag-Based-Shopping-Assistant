import { useState } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

const STAR = (rating) => {
  const full = Math.floor(rating);
  const half = rating % 1 >= 0.5;
  return Array.from({ length: 5 }, (_, i) =>
    i < full ? "★" : i === full && half ? "½" : "☆"
  ).join("");
};

const ScoreBar = ({ label, value, color }) => (
  <div style={{ marginBottom: 6 }}>
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>
      <span>{label}</span><span>{(value * 100).toFixed(0)}%</span>
    </div>
    <div style={{ background: "var(--track)", borderRadius: 4, height: 5 }}>
      <div style={{ width: `${Math.min(value * 100, 100)}%`, height: 5, background: color, borderRadius: 4, transition: "width 0.5s" }} />
    </div>
  </div>
);

const ProductCard = ({ rec, index }) => {
  const [open, setOpen] = useState(false);
  const { score_breakdown: sb } = rec;
  return (
    <div className="card" style={{ animationDelay: `${index * 80}ms` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span className="rank-badge">#{index + 1}</span>
            <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{rec.category}</span>
          </div>
          <h3 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 2px", lineHeight: 1.3 }}>{rec.name}</h3>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>{rec.brand}</p>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--accent)" }}>₹{rec.price.toLocaleString()}</div>
          <div style={{ fontSize: 13, color: "#f59e0b", letterSpacing: 1 }}>{STAR(rec.rating)} <span style={{ color: "var(--muted)", letterSpacing: 0 }}>{rec.rating}</span></div>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "12px 0" }}>
        {rec.features.slice(0, 5).map(f => (
          <span key={f} className="tag">{f}</span>
        ))}
      </div>

      <p style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.65, margin: "0 0 12px" }}>{rec.explanation}</p>

      <button className="ghost-btn" onClick={() => setOpen(!open)} style={{ fontSize: 13, marginBottom: open ? 12 : 0 }}>
        {open ? "▲ Hide scores" : "▼ Score breakdown"}
      </button>

      {open && (
        <div style={{ borderTop: "0.5px solid var(--border)", paddingTop: 12 }}>
          <ScoreBar label="Semantic match" value={sb.semantic} color="#6366f1" />
          <ScoreBar label="Price fit" value={sb.price_fit} color="#10b981" />
          <ScoreBar label="Feature match" value={sb.feature_match} color="#f59e0b" />
          <ScoreBar label="Rating" value={sb.rating} color="#ec4899" />
          <div style={{ marginTop: 8, fontSize: 13, fontWeight: 600, color: "var(--accent)" }}>
            Final score: {(sb.final_score * 100).toFixed(1)}
          </div>
        </div>
      )}
    </div>
  );
};

const CompareCard = ({ entry, isWinner }) => (
  <div className="card" style={{ borderColor: isWinner ? "var(--accent)" : "var(--border)", borderWidth: isWinner ? 2 : 0.5 }}>
    {isWinner && <div className="winner-badge">🏆 Best pick</div>}
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{entry.product_name}</h3>
      <span style={{ fontWeight: 700, color: "var(--accent)" }}>₹{entry.price?.toLocaleString()}</span>
    </div>
    <div style={{ fontSize: 13, color: "#f59e0b", marginBottom: 8 }}>{"★".repeat(Math.round(entry.rating))} {entry.rating}</div>
    <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
      <span className={`fit-badge fit-${entry.use_case_fit?.toLowerCase()}`}>{entry.use_case_fit} fit</span>
    </div>
    <div style={{ fontSize: 13, marginBottom: 6 }}>
      <strong style={{ color: "#10b981" }}>✓</strong> {entry.pros?.join(" · ")}
    </div>
    <div style={{ fontSize: 13, marginBottom: 8 }}>
      <strong style={{ color: "#ef4444" }}>✗</strong> {entry.cons?.join(" · ")}
    </div>
    <p style={{ fontSize: 13, color: "var(--muted)", margin: 0, fontStyle: "italic" }}>{entry.verdict}</p>
  </div>
);

const MetricsPanel = ({ metrics }) => (
  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginTop: 16 }}>
    {[
      { label: "Total requests", value: metrics.total_requests },
      { label: "Recommend", value: metrics.recommend_requests },
      { label: "Compare", value: metrics.compare_requests },
      { label: "Cache hit rate", value: `${metrics.cache_hit_rate_pct}%` },
      { label: "Avg latency", value: `${metrics.avg_latency_ms}ms` },
      { label: "Rec latency", value: `${metrics.avg_recommend_latency_ms}ms` },
      { label: "Errors", value: metrics.errors },
      { label: "Cache entries", value: metrics.constraint_cache_size },
    ].map(m => (
      <div key={m.label} className="metric-card">
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>{m.label}</div>
        <div style={{ fontSize: 22, fontWeight: 700 }}>{m.value}</div>
      </div>
    ))}
  </div>
);

export default function App() {
  const [tab, setTab] = useState("recommend");
  const [query, setQuery] = useState("");
  const [topN, setTopN] = useState(3);
  const [recResult, setRecResult] = useState(null);
  const [recLoading, setRecLoading] = useState(false);
  const [recError, setRecError] = useState("");

  const [compareNames, setCompareNames] = useState("");
  const [useCase, setUseCase] = useState("");
  const [cmpResult, setCmpResult] = useState(null);
  const [cmpLoading, setCmpLoading] = useState(false);
  const [cmpError, setCmpError] = useState("");

  const [metrics, setMetrics] = useState(null);
  const [metricsLoading, setMetricsLoading] = useState(false);

  const handleRecommend = async () => {
    if (!query.trim()) return;
    setRecLoading(true); setRecError(""); setRecResult(null);
    try {
      const res = await fetch(`${API_BASE}/recommend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim(), top_n: topN }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || "Request failed");
      setRecResult(await res.json());
    } catch (e) { setRecError(e.message); }
    setRecLoading(false);
  };

  const handleCompare = async () => {
    const names = compareNames.split(",").map(s => s.trim()).filter(Boolean);
    if (names.length < 2) { setCmpError("Enter at least 2 product names separated by commas."); return; }
    if (!useCase.trim()) { setCmpError("Describe the use case."); return; }
    setCmpLoading(true); setCmpError(""); setCmpResult(null);
    try {
      const res = await fetch(`${API_BASE}/compare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_names: names, use_case: useCase.trim() }),
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
    } catch { setMetrics(null); }
    setMetricsLoading(false);
  };

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --bg: #f9f9f8; --surface: #ffffff; --border: rgba(0,0,0,0.1);
          --text: #1a1a18; --muted: #6b6b68; --accent: #5b46e8;
          --track: rgba(0,0,0,0.07);
        }
        @media (prefers-color-scheme: dark) {
          :root {
            --bg: #141413; --surface: #1e1e1c; --border: rgba(255,255,255,0.1);
            --text: #ebebea; --muted: #888880; --accent: #8b7cf8;
            --track: rgba(255,255,255,0.08);
          }
        }
        body { background: var(--bg); color: var(--text); font-family: system-ui, -apple-system, sans-serif; min-height: 100vh; }
        .shell { max-width: 760px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
        .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 2rem; }
        .brand-icon { width: 36px; height: 36px; background: var(--accent); border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 18px; }
        .brand h1 { font-size: 22px; font-weight: 700; letter-spacing: -0.5px; }
        .brand p { font-size: 13px; color: var(--muted); }
        .tabs { display: flex; gap: 4px; background: var(--track); border-radius: 10px; padding: 4px; margin-bottom: 1.5rem; }
        .tab { flex: 1; padding: 8px 12px; border: none; background: transparent; cursor: pointer; border-radius: 7px; font-size: 14px; color: var(--muted); transition: all 0.15s; font-weight: 500; }
        .tab.active { background: var(--surface); color: var(--text); box-shadow: 0 1px 3px rgba(0,0,0,0.12); }
        .section { background: var(--surface); border-radius: 14px; padding: 1.25rem; border: 0.5px solid var(--border); margin-bottom: 1rem; }
        label { display: block; font-size: 13px; color: var(--muted); margin-bottom: 6px; font-weight: 500; }
        input[type=text], textarea { width: 100%; padding: 10px 12px; border: 0.5px solid var(--border); border-radius: 8px; font-size: 14px; background: var(--bg); color: var(--text); outline: none; transition: border-color 0.15s; font-family: inherit; }
        input[type=text]:focus, textarea:focus { border-color: var(--accent); }
        textarea { resize: vertical; min-height: 72px; }
        .row { display: flex; gap: 10px; align-items: flex-end; }
        .row > *:first-child { flex: 1; }
        select { padding: 10px 12px; border: 0.5px solid var(--border); border-radius: 8px; font-size: 14px; background: var(--bg); color: var(--text); cursor: pointer; font-family: inherit; }
        .btn { padding: 10px 20px; background: var(--accent); color: #fff; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; white-space: nowrap; transition: opacity 0.15s; }
        .btn:hover { opacity: 0.88; }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .ghost-btn { background: transparent; border: 0.5px solid var(--border); border-radius: 7px; padding: 6px 12px; cursor: pointer; color: var(--muted); font-size: 13px; transition: background 0.15s; font-family: inherit; }
        .ghost-btn:hover { background: var(--track); }
        .card { background: var(--surface); border: 0.5px solid var(--border); border-radius: 14px; padding: 1.25rem; margin-bottom: 12px; animation: slideUp 0.35s ease both; }
        @keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
        .rank-badge { background: var(--accent); color: #fff; border-radius: 5px; font-size: 11px; font-weight: 700; padding: 2px 7px; }
        .tag { background: var(--track); border-radius: 6px; font-size: 12px; padding: 3px 9px; color: var(--muted); }
        .winner-badge { display: inline-block; background: #f59e0b22; color: #b45309; font-size: 12px; font-weight: 600; border-radius: 6px; padding: 3px 10px; margin-bottom: 8px; }
        .fit-badge { font-size: 11px; font-weight: 600; border-radius: 5px; padding: 3px 8px; }
        .fit-high { background: #10b98120; color: #065f46; }
        .fit-medium { background: #f59e0b20; color: #92400e; }
        .fit-low { background: #ef444420; color: #991b1b; }
        .metric-card { background: var(--surface); border: 0.5px solid var(--border); border-radius: 10px; padding: 14px; }
        .error { color: #ef4444; font-size: 13px; margin-top: 8px; background: #ef444412; padding: 10px 14px; border-radius: 8px; }
        .hint { font-size: 12px; color: var(--muted); margin-top: 4px; }
        .cache-pill { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; padding: 3px 9px; border-radius: 12px; margin-left: 8px; }
        .cache-hit { background: #10b98118; color: #065f46; }
        .cache-miss { background: #6366f118; color: #3730a3; }
        .spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: spin 0.7s linear infinite; vertical-align: -3px; margin-right: 6px; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .meta-row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 12px; padding-bottom: 12px; border-bottom: 0.5px solid var(--border); font-size: 13px; color: var(--muted); }
        .cmp-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
      `}</style>
      <div className="shell">
        <div className="brand">
          <div className="brand-icon">🛒</div>
          <div>
            <h1>ShopLens</h1>
            <p>RAG-powered shopping assistant · hybrid retrieval + reranking</p>
          </div>
        </div>

        <div className="tabs">
          {["recommend", "compare", "metrics"].map(t => (
            <button key={t} className={`tab${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>
              {t === "recommend" ? "🔍 Recommend" : t === "compare" ? "⚖️ Compare" : "📊 Metrics"}
            </button>
          ))}
        </div>

        {tab === "recommend" && (
          <>
            <div className="section">
              <label>What are you looking for?</label>
              <div className="row">
                <input
                  type="text" value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleRecommend()}
                  placeholder='e.g. "waterproof hiking boots under ₹2000"'
                />
                <select value={topN} onChange={e => setTopN(Number(e.target.value))}>
                  {[1,2,3,4,5].map(n => <option key={n} value={n}>Top {n}</option>)}
                </select>
                <button className="btn" onClick={handleRecommend} disabled={recLoading || !query.trim()}>
                  {recLoading ? <><span className="spinner" />Searching…</> : "Search"}
                </button>
              </div>
              {recError && <div className="error">{recError}</div>}
            </div>

            {recResult && (
              <>
                <div className="meta-row">
                  <span>Query: <strong>{recResult.query}</strong></span>
                  <span className={`cache-pill ${recResult.cache_hit ? "cache-hit" : "cache-miss"}`}>
                    {recResult.cache_hit ? "💾 cache hit" : "🔄 fresh extraction"}
                  </span>
                  {recResult.extracted_constraints.max_price && (
                    <span>Budget: ₹{recResult.extracted_constraints.max_price}</span>
                  )}
                  {recResult.extracted_constraints.category && (
                    <span>Category: {recResult.extracted_constraints.category}</span>
                  )}
                </div>
                {recResult.recommendations.map((rec, i) => (
                  <ProductCard key={rec.id} rec={rec} index={i} />
                ))}
              </>
            )}
          </>
        )}

        {tab === "compare" && (
          <>
            <div className="section">
              <label>Product names (comma-separated)</label>
              <input
                type="text" value={compareNames}
                onChange={e => setCompareNames(e.target.value)}
                placeholder="e.g. AquaShield Hiking Boots, CloudWalk Running Shoes"
              />
              <p className="hint">Enter 2–4 exact or partial product names</p>
              <div style={{ height: 12 }} />
              <label>Use case / intent</label>
              <div className="row">
                <textarea
                  value={useCase}
                  onChange={e => setUseCase(e.target.value)}
                  placeholder="e.g. daily commute in the monsoon season"
                />
                <button className="btn" onClick={handleCompare} disabled={cmpLoading} style={{ alignSelf: "flex-end" }}>
                  {cmpLoading ? <><span className="spinner" />Comparing…</> : "Compare"}
                </button>
              </div>
              {cmpError && <div className="error">{cmpError}</div>}
            </div>

            {cmpResult && (
              <>
                <div className="meta-row">
                  <span>Use case: <strong>{cmpResult.use_case}</strong></span>
                  {cmpResult.not_found?.length > 0 && (
                    <span style={{ color: "#ef4444" }}>Not found: {cmpResult.not_found.join(", ")}</span>
                  )}
                </div>
                {cmpResult.comparison.summary && (
                  <div className="card" style={{ marginBottom: 12 }}>
                    <p style={{ fontSize: 14, lineHeight: 1.7, color: "var(--text)" }}>{cmpResult.comparison.summary}</p>
                    {cmpResult.comparison.winner && (
                      <div style={{ marginTop: 10, fontSize: 13, borderTop: "0.5px solid var(--border)", paddingTop: 10, color: "var(--muted)" }}>
                        🏆 Winner: <strong style={{ color: "var(--text)" }}>{cmpResult.comparison.winner.product_id}</strong> — {cmpResult.comparison.winner.reason}
                      </div>
                    )}
                  </div>
                )}
                <div className="cmp-grid">
                  {cmpResult.comparison.comparison_table?.map(entry => (
                    <CompareCard
                      key={entry.product_id}
                      entry={entry}
                      isWinner={entry.product_id === cmpResult.comparison.winner?.product_id}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {tab === "metrics" && (
          <div className="section">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 14, color: "var(--muted)" }}>Live operational metrics from your API</span>
              <button className="btn" onClick={handleMetrics} disabled={metricsLoading}>
                {metricsLoading ? <><span className="spinner" />Loading…</> : "Fetch metrics"}
              </button>
            </div>
            {metrics && <MetricsPanel metrics={metrics} />}
          </div>
        )}
      </div>
    </>
  );
}
