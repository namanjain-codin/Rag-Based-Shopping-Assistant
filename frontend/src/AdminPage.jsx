import { useState, useEffect } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";
const LOW_STOCK = 5;

const CATEGORIES = ["Footwear","Clothing","Bags","Accessories","Fitness","Camping","Electronics","Equipment","Sports","Travel"];

function StockBadge({ stock }) {
  if (stock === 0)  return <span className="adm-badge out">Out of stock</span>;
  if (stock <= LOW_STOCK) return <span className="adm-badge low">Low: {stock}</span>;
  return <span className="adm-badge ok">{stock}</span>;
}

function StockControls({ product, onUpdate }) {
  const [qty, setQty] = useState(1);
  const [loading, setLoading] = useState(false);

  const adjust = async (action) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/products/${product.id}/stock`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Key": sessionStorage.getItem("adminKey") || "",
        },
        body: JSON.stringify({ action, quantity: qty }),
      });
      if (!res.ok) throw new Error((await res.json()).detail);
      onUpdate(await res.json());
    } catch (e) { alert(e.message); }
    setLoading(false);
  };

  return (
    <div className="stock-controls">
      <input
        type="number" min={0} value={qty}
        onChange={e => setQty(Math.max(0, parseInt(e.target.value) || 0))}
        className="qty-input"
      />
      <button className="adm-btn green" disabled={loading} onClick={() => adjust("add")}>+ Add</button>
      <button className="adm-btn red"   disabled={loading} onClick={() => adjust("subtract")}>− Remove</button>
      <button className="adm-btn gray"  disabled={loading} onClick={() => adjust("set")}>Set</button>
    </div>
  );
}

function AddProductModal({ onClose, onAdded }) {
  const [form, setForm] = useState({
    id: "", name: "", brand: "", category: "Footwear",
    price: "", rating: "", features: "", tags: "",
    description: "", stock: 100,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.id || !form.name || !form.brand || !form.price || !form.rating) {
      setError("ID, name, brand, price, and rating are required."); return;
    }
    setLoading(true); setError("");
    try {
      const res = await fetch(`${API_BASE}/products`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Key": sessionStorage.getItem("adminKey") || "",
        },
        body: JSON.stringify({
          ...form,
          price:    parseFloat(form.price),
          rating:   parseFloat(form.rating),
          stock:    parseInt(form.stock) || 100,
          features: form.features.split(",").map(s => s.trim()).filter(Boolean),
          tags:     form.tags.split(",").map(s => s.trim()).filter(Boolean),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).detail);
      onAdded(await res.json());
      onClose();
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2>Add new product</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            {[
              { label: "Product ID", key: "id", placeholder: "e.g. P041" },
              { label: "Name", key: "name", placeholder: "Product name" },
              { label: "Brand", key: "brand", placeholder: "Brand name" },
              { label: "Price (₹)", key: "price", placeholder: "1299", type: "number" },
              { label: "Rating (0–5)", key: "rating", placeholder: "4.5", type: "number" },
              { label: "Initial stock", key: "stock", placeholder: "100", type: "number" },
            ].map(f => (
              <div key={f.key} className="form-field">
                <label>{f.label}</label>
                <input type={f.type || "text"} value={form[f.key]}
                  onChange={e => set(f.key, e.target.value)} placeholder={f.placeholder} />
              </div>
            ))}
            <div className="form-field">
              <label>Category</label>
              <select value={form.category} onChange={e => set("category", e.target.value)}>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="form-field full">
            <label>Features (comma-separated)</label>
            <input value={form.features} onChange={e => set("features", e.target.value)}
              placeholder="waterproof, lightweight, anti-slip" />
          </div>
          <div className="form-field full">
            <label>Tags (comma-separated)</label>
            <input value={form.tags} onChange={e => set("tags", e.target.value)}
              placeholder="hiking, outdoor, waterproof" />
          </div>
          <div className="form-field full">
            <label>Description</label>
            <textarea value={form.description} onChange={e => set("description", e.target.value)}
              placeholder="Product description…" rows={3} />
          </div>
          {error && <div className="adm-error">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="adm-btn gray" onClick={onClose}>Cancel</button>
          <button className="adm-btn green" onClick={submit} disabled={loading}>
            {loading ? "Adding…" : "Add product"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditModal({ product, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: product.name, brand: product.brand, category: product.category,
    price: product.price, rating: product.rating,
    features: product.features.join(", "),
    tags: product.tags.join(", "),
    description: product.description,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    setLoading(true); setError("");
    try {
      const res = await fetch(`${API_BASE}/products/${product.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Key": sessionStorage.getItem("adminKey") || "",
        },
        body: JSON.stringify({
          ...form,
          price:    parseFloat(form.price),
          rating:   parseFloat(form.rating),
          features: form.features.split(",").map(s => s.trim()).filter(Boolean),
          tags:     form.tags.split(",").map(s => s.trim()).filter(Boolean),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).detail);
      onSaved(await res.json());
      onClose();
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2>Edit — {product.name}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            {[
              { label: "Name", key: "name" },
              { label: "Brand", key: "brand" },
              { label: "Price (₹)", key: "price", type: "number" },
              { label: "Rating (0–5)", key: "rating", type: "number" },
            ].map(f => (
              <div key={f.key} className="form-field">
                <label>{f.label}</label>
                <input type={f.type || "text"} value={form[f.key]}
                  onChange={e => set(f.key, e.target.value)} />
              </div>
            ))}
            <div className="form-field">
              <label>Category</label>
              <select value={form.category} onChange={e => set("category", e.target.value)}>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="form-field full">
            <label>Features (comma-separated)</label>
            <input value={form.features} onChange={e => set("features", e.target.value)} />
          </div>
          <div className="form-field full">
            <label>Tags (comma-separated)</label>
            <input value={form.tags} onChange={e => set("tags", e.target.value)} />
          </div>
          <div className="form-field full">
            <label>Description</label>
            <textarea value={form.description} onChange={e => set("description", e.target.value)} rows={3} />
          </div>
          {error && <div className="adm-error">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="adm-btn gray" onClick={onClose}>Cancel</button>
          <button className="adm-btn green" onClick={submit} disabled={loading}>
            {loading ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [authed, setAuthed]     = useState(!!sessionStorage.getItem("adminKey"));
  const [keyInput, setKeyInput] = useState("");
  const [authErr, setAuthErr]   = useState("");
  const [adminTab, setAdminTab] = useState("inventory"); // inventory | metrics

  const [products, setProducts] = useState([]);
  const [loading, setLoading]   = useState(false);
  const [filter, setFilter]     = useState("");
  const [catFilter, setCatFilter] = useState("All");
  const [showAdd, setShowAdd]   = useState(false);
  const [editProd, setEditProd] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [lowStockOnly, setLowStockOnly] = useState(false);

  const [metrics, setMetrics]         = useState(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [reindexing, setReindexing]   = useState(false);

  const fetchMetrics = async () => {
    setMetricsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/metrics`);
      setMetrics(await res.json());
    } catch {}
    setMetricsLoading(false);
  };

  const handleReindex = async () => {
    setReindexing(true);
    try {
      const res = await fetch(`${API_BASE}/admin/reindex`, {
        method: "POST",
        headers: { "X-Admin-Key": sessionStorage.getItem("adminKey") || "" },
      });
      if (!res.ok) throw new Error((await res.json()).detail);
      alert("Reindex started in background. Takes ~30s to complete.");
    } catch (e) { alert(e.message); }
    setReindexing(false);
  };

  const login = () => {
    if (!keyInput.trim()) { setAuthErr("Enter the admin key."); return; }
    sessionStorage.setItem("adminKey", keyInput.trim());
    setAuthed(true);
  };

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/products`);
      setProducts(await res.json());
    } catch {}
    setLoading(false);
  };

  useEffect(() => { if (authed) fetchProducts(); }, [authed]);

  const handleStockUpdate = (updated) => {
    setProducts(ps => ps.map(p => p.id === updated.id ? updated : p));
  };

  const handleAdded = (p) => setProducts(ps => [p, ...ps]);
  const handleSaved = (p) => setProducts(ps => ps.map(x => x.id === p.id ? p : x));

  const handleDelete = async (id) => {
    if (!window.confirm(`Delete product ${id}? This cannot be undone.`)) return;
    setDeleting(id);
    try {
      const res = await fetch(`${API_BASE}/products/${id}`, {
        method: "DELETE",
        headers: { "X-Admin-Key": sessionStorage.getItem("adminKey") || "" },
      });
      if (!res.ok) throw new Error((await res.json()).detail);
      setProducts(ps => ps.filter(p => p.id !== id));
    } catch (e) { alert(e.message); }
    setDeleting(null);
  };

  const filtered = products.filter(p => {
    const q = filter.toLowerCase();
    const matchesSearch = !q || p.name.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q) || p.id.toLowerCase().includes(q);
    const matchesCat    = catFilter === "All" || p.category === catFilter;
    const matchesLow    = !lowStockOnly || p.stock <= LOW_STOCK;
    return matchesSearch && matchesCat && matchesLow;
  });

  const lowStockCount = products.filter(p => p.stock <= LOW_STOCK).length;

  if (!authed) return (
    <div className="adm-login">
      <div className="adm-login-card">
        <div className="adm-login-icon">🔐</div>
        <h2>Admin access</h2>
        <p>Enter your admin key to continue</p>
        <input
          type="password" value={keyInput} onChange={e => setKeyInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && login()}
          placeholder="Admin key"
          className="adm-key-input"
        />
        {authErr && <div className="adm-error">{authErr}</div>}
        <button className="adm-btn green wide" onClick={login}>Login</button>
      </div>
    </div>
  );

  return (
    <div className="adm-shell">
      {/* Header */}
      <div className="adm-topbar">
        <div>
          <h1 className="adm-title">Admin Panel</h1>
          <p className="adm-sub">{products.length} products · {lowStockCount > 0 && <span className="adm-low-count">⚠ {lowStockCount} low stock</span>}</p>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          {adminTab === "inventory" && <>
            <button className="adm-btn gray" onClick={fetchProducts}>↺ Refresh</button>
            <button className="adm-btn gray" onClick={handleReindex} disabled={reindexing}>
              {reindexing ? "Reindexing…" : "⚙ Reindex AI"}
            </button>
            <button className="adm-btn green" onClick={() => setShowAdd(true)}>+ Add product</button>
          </>}
          {adminTab === "metrics" &&
            <button className="adm-btn green" onClick={fetchMetrics} disabled={metricsLoading}>
              {metricsLoading ? "Loading…" : "↺ Fetch metrics"}
            </button>
          }
        </div>
      </div>

      {/* Admin tabs */}
      <div className="adm-tabs">
        <button className={`adm-tab${adminTab==="inventory"?" adm-tab-active":""}`} onClick={()=>setAdminTab("inventory")}>
          📦 Inventory
        </button>
        <button className={`adm-tab${adminTab==="metrics"?" adm-tab-active":""}`} onClick={()=>{setAdminTab("metrics");fetchMetrics();}}>
          📊 Metrics
        </button>
      </div>

      {/* ── INVENTORY TAB ── */}
      {adminTab === "inventory" && <>
        {/* Low-stock alert strip */}
        {lowStockCount > 0 && (
          <div className="adm-alert-strip">
            <span>⚠ {lowStockCount} product{lowStockCount > 1 ? "s are" : " is"} running low on stock (≤{LOW_STOCK} units)</span>
            <button className="adm-alert-btn" onClick={() => setLowStockOnly(l => !l)}>
              {lowStockOnly ? "Show all" : "Show low stock only"}
            </button>
          </div>
        )}

        {/* Toolbar */}
        <div className="adm-toolbar">
          <input className="adm-search" placeholder="Search by name, brand, or ID…"
            value={filter} onChange={e => setFilter(e.target.value)} />
          <select className="adm-select" value={catFilter} onChange={e => setCatFilter(e.target.value)}>
            <option>All</option>
            {CATEGORIES.map(c => <option key={c}>{c}</option>)}
          </select>
          <span className="adm-count">{filtered.length} shown</span>
        </div>

        {/* Table */}
        {loading ? (
          <div className="adm-loading">Loading products…</div>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>ID</th><th>Product</th><th>Category</th>
                  <th>Price</th><th>Rating</th><th>Stock</th>
                  <th>Adjust stock</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <tr key={p.id} className={p.stock <= LOW_STOCK ? "row-low" : ""}>
                    <td className="adm-id">{p.id}</td>
                    <td>
                      <div className="adm-pname">{p.name}</div>
                      <div className="adm-brand">{p.brand}</div>
                    </td>
                    <td><span className="adm-cat">{p.category}</span></td>
                    <td>₹{parseFloat(p.price).toLocaleString()}</td>
                    <td>⭐ {parseFloat(p.rating).toFixed(1)}</td>
                    <td><StockBadge stock={p.stock} /></td>
                    <td><StockControls product={p} onUpdate={handleStockUpdate} /></td>
                    <td>
                      <div style={{ display:"flex", gap:6 }}>
                        <button className="adm-icon-btn edit" onClick={() => setEditProd(p)} title="Edit">✏️</button>
                        <button className="adm-icon-btn del" onClick={() => handleDelete(p.id)}
                          disabled={deleting === p.id} title="Delete">🗑️</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>}

      {/* ── METRICS TAB ── */}
      {adminTab === "metrics" && (
        <div>
          {!metrics && !metricsLoading && (
            <div style={{textAlign:"center",padding:"3rem",color:"var(--mt)"}}>
              <div style={{fontSize:40,marginBottom:12}}>📊</div>
              <p>Click "Fetch metrics" to load live stats from your API.</p>
            </div>
          )}
          {metricsLoading && <div className="adm-loading">Fetching metrics…</div>}
          {metrics && (
            <>
              {/* Cache explanation banner */}
              <div className="adm-info-strip">
                <strong>What is caching?</strong> Constraint extraction (parsing price/category/features from a query) calls Mistral LLM and takes ~1s.
                Results are cached in memory keyed by query string — identical queries skip the LLM call entirely and reuse the extracted constraints.
                Cache is in-memory only and resets on server restart.
              </div>
              <div className="adm-mgrid">
                {[
                  {l:"Total requests",    v:metrics.total_requests,           note:"All HTTP requests to the API"},
                  {l:"Recommend calls",   v:metrics.recommend_requests,       note:"/recommend endpoint hits"},
                  {l:"Compare calls",     v:metrics.compare_requests,         note:"/compare endpoint hits"},
                  {l:"Errors",            v:metrics.errors,                   note:"Failed requests (5xx)"},
                  {l:"Cache hits",        v:metrics.cache_hits,               note:"Queries served from constraint cache"},
                  {l:"Cache misses",      v:metrics.cache_misses,             note:"Queries that called Mistral for extraction"},
                  {l:"Cache hit rate",    v:`${metrics.cache_hit_rate_pct}%`, note:"Higher = fewer LLM calls"},
                  {l:"Avg latency",       v:`${metrics.avg_latency_ms}ms`,    note:"Average across all endpoints"},
                  {l:"Rec latency",       v:`${metrics.avg_recommend_latency_ms}ms`, note:"Average /recommend response time"},
                  {l:"Cmp latency",       v:`${metrics.avg_compare_latency_ms}ms`,  note:"Average /compare response time"},
                  {l:"Cached queries",    v:metrics.constraint_cache_size,    note:"Unique queries stored in memory"},
                ].map(m=>(
                  <div key={m.l} className="adm-mcard">
                    <div className="adm-mlbl">{m.l}</div>
                    <div className="adm-mval">{m.v}</div>
                    <div className="adm-mnote">{m.note}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {showAdd && <AddProductModal onClose={() => setShowAdd(false)} onAdded={handleAdded} />}
      {editProd && <EditModal product={editProd} onClose={() => setEditProd(null)} onSaved={handleSaved} />}
    </div>
  );
}