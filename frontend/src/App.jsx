import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import AdminPage from "./AdminPage.jsx";
import CheckoutModal from "./CheckoutModal.jsx";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";
const LOW_STOCK_THRESHOLD = 5;

// ── Helpers ───────────────────────────────────────────────────────────────────
const stars = (r) => {
  const full = Math.floor(r), half = r % 1 >= 0.5;
  return "★".repeat(full) + (half ? "½" : "") + "☆".repeat(5 - Math.ceil(r));
};
const CAT_COLOR = {
  Footwear:"#6366f1",Clothing:"#ec4899",Bags:"#f59e0b",Accessories:"#10b981",
  Fitness:"#ef4444",Camping:"#84cc16",Electronics:"#3b82f6",
  Equipment:"#8b5cf6",Sports:"#f97316",Travel:"#06b6d4"
};
const CAT_ICON = {
  Footwear:"👟",Clothing:"🧥",Bags:"🎒",Accessories:"🧢",
  Fitness:"💪",Camping:"⛺",Electronics:"📱",Equipment:"🔧",Sports:"🚴",Travel:"✈️",All:"🛍️"
};
const CATEGORIES = ["All","Footwear","Clothing","Bags","Accessories","Fitness","Camping","Electronics","Equipment","Sports","Travel"];
const cc = (cat) => CAT_COLOR[cat] || "#6366f1";

// ── Stock pill ────────────────────────────────────────────────────────────────
function StockPill({ stock }) {
  if (stock === 0)        return <span className="spill out">Out of stock</span>;
  if (stock <= LOW_STOCK_THRESHOLD) return <span className="spill low">Only {stock} left!</span>;
  return null;
}

// ── Product Card ──────────────────────────────────────────────────────────────
function ProductCard({ p, onAskAI, onAddToCart, inCart }) {
  const isLow = p.stock !== undefined && p.stock <= LOW_STOCK_THRESHOLD;
  const isOut = p.stock === 0;
  return (
    <div className={`pcard${isLow ? " pcard-low" : ""}`}>
      <div className="pcard-img" style={{ background:`linear-gradient(135deg,${cc(p.category)}22,${cc(p.category)}44)` }}>
        <span className="pcard-emoji">{CAT_ICON[p.category]}</span>
        <span className="pcard-cat" style={{ background:cc(p.category) }}>{p.category}</span>
        {isLow && !isOut && <span className="pcard-low-flag">⚠ Low stock</span>}
        {isOut && <span className="pcard-out-flag">Out of stock</span>}
      </div>
      <div className="pcard-body">
        <p className="pcard-brand">{p.brand}</p>
        <h3 className="pcard-name">{p.name}</h3>
        <div className="pcard-stars"><span className="st">{stars(p.rating)}</span><span className="rn">{p.rating}</span></div>
        <div className="pcard-tags">{(p.features||[]).slice(0,3).map(f=><span key={f} className="tag">{f}</span>)}</div>
        <p className="pcard-desc">{(p.description||"").slice(0,80)}…</p>
        <StockPill stock={p.stock} />
        <div className="pcard-foot">
          <span className="pcard-price">₹{Number(p.price).toLocaleString()}</span>
          <button className="btn-ai" onClick={()=>onAskAI(p.name)}>Ask AI ✦</button>
        </div>
        <button
          className={`btn-cart${inCart ? " btn-cart-in" : ""}${isOut ? " btn-cart-out" : ""}`}
          onClick={() => !isOut && onAddToCart(p)}
          disabled={isOut}
        >
          {isOut ? "Out of stock" : inCart ? "✓ In cart" : "+ Add to cart"}
        </button>
      </div>
    </div>
  );
}

// ── AI Result Card ────────────────────────────────────────────────────────────
function AICard({ rec, rank }) {
  const [open, setOpen] = useState(false);
  const sb = rec.score_breakdown;
  return (
    <div className="aicard" style={{ animationDelay:`${rank*60}ms` }}>
      <div className="aicard-rank" style={{ background:cc(rec.category) }}>#{rank+1}</div>
      <div className="aicard-body">
        <div className="aicard-top">
          <div>
            <span className="aicat" style={{ background:cc(rec.category) }}>{rec.category}</span>
            <h3 className="aicard-name">{rec.name}</h3>
            <p className="aicard-brand">{rec.brand}</p>
          </div>
          <div className="aicard-right">
            <div className="aicard-price">₹{Number(rec.price).toLocaleString()}</div>
            <div className="aicard-stars"><span className="st">{stars(rec.rating)}</span> {rec.rating}</div>
          </div>
        </div>
        <p className="aicard-expl">{rec.explanation}</p>
        <div className="pcard-tags">{(rec.features||[]).slice(0,5).map(f=><span key={f} className="tag">{f}</span>)}</div>
        <button className="score-btn" onClick={()=>setOpen(!open)}>{open?"▲ Hide scores":"▼ Score breakdown"}</button>
        {open && (
          <div className="score-bars">
            {[["Semantic",sb.semantic,"#6366f1"],["Price fit",sb.price_fit,"#10b981"],["Features",sb.feature_match,"#f59e0b"],["Rating",sb.rating,"#ec4899"]].map(([l,v,c])=>(
              <div key={l} className="srow">
                <span>{l}</span>
                <div className="btrack"><div className="bfill" style={{ width:`${Math.min(v*100,100)}%`,background:c }}/></div>
                <span>{(v*100).toFixed(0)}%</span>
              </div>
            ))}
            <div className="final-sc">Final: {(sb.final_score*100).toFixed(1)}</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Compare Card ──────────────────────────────────────────────────────────────
function CmpCard({ e, isWinner }) {
  return (
    <div className={`cmpcard${isWinner?" cmpwinner":""}`}>
      {isWinner && <div className="winner-lbl">🏆 Best pick</div>}
      <h3 className="cmp-name">{e.product_name}</h3>
      <div className="cmp-meta">
        <span className="cmp-price">₹{Number(e.price||0).toLocaleString()}</span>
        <span className="cmp-rat"><span className="st">{stars(Math.round((e.rating||0)*2)/2)}</span> {e.rating}</span>
      </div>
      <span className={`fit fit-${(e.use_case_fit||"").toLowerCase()}`}>{e.use_case_fit} fit</span>
      <div className="cmp-pros">{(e.pros||[]).map((p,i)=><div key={i}>✓ {p}</div>)}</div>
      <div className="cmp-cons">{(e.cons||[]).map((c,i)=><div key={i}>✗ {c}</div>)}</div>
      <p className="cmp-verdict">{e.verdict}</p>
    </div>
  );
}

// ── Low-stock banner (customer-facing) ───────────────────────────────────────
function LowStockBanner({ items }) {
  const [open, setOpen] = useState(true);
  if (!items.length || !open) return null;
  return (
    <div className="ls-banner">
      <span className="ls-icon">⚠</span>
      <span className="ls-text">
        <strong>{items.length} item{items.length>1?"s are":" is"} running low:</strong>{" "}
        {items.slice(0,4).map(i=>`${i.name} (${i.stock} left)`).join(" · ")}
        {items.length>4 && ` · +${items.length-4} more`}
      </span>
      <button className="ls-close" onClick={()=>setOpen(false)}>✕</button>
    </div>
  );
}

// ── Cart Drawer ───────────────────────────────────────────────────────────────
function CartDrawer({ cart, onClose, onQtyChange, onRemove, onBuyNow, buying }) {
  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const totalItems = cart.reduce((s, i) => s + i.qty, 0);
  return (
    <>
      <div className="cart-overlay" onClick={onClose} />
      <div className="cart-drawer">
        <div className="cart-header">
          <h2 className="cart-title">🛒 Your Cart <span className="cart-count">{totalItems}</span></h2>
          <button className="cart-close" onClick={onClose}>✕</button>
        </div>

        {cart.length === 0 ? (
          <div className="cart-empty">
            <div style={{fontSize:48,marginBottom:12}}>🛍️</div>
            <p>Your cart is empty</p>
            <p style={{fontSize:13,marginTop:6}}>Add products from the shop</p>
          </div>
        ) : (
          <>
            <div className="cart-items">
              {cart.map(item => (
                <div key={item.id} className="cart-item">
                  <div className="cart-item-icon" style={{background:`linear-gradient(135deg,${item.color}22,${item.color}44)`}}>
                    <span style={{fontSize:28}}>{item.emoji}</span>
                  </div>
                  <div className="cart-item-info">
                    <p className="cart-item-name">{item.name}</p>
                    <p className="cart-item-brand">{item.brand}</p>
                    <p className="cart-item-price">₹{Number(item.price).toLocaleString()} each</p>
                    {item.stock <= 5 && item.stock > 0 &&
                      <p className="cart-item-warn">⚠ Only {item.stock} in stock</p>
                    }
                  </div>
                  <div className="cart-item-right">
                    <div className="cart-qty">
                      <button className="qty-btn" onClick={() => onQtyChange(item.id, item.qty - 1)}>−</button>
                      <span className="qty-val">{item.qty}</span>
                      <button className="qty-btn"
                        onClick={() => onQtyChange(item.id, item.qty + 1)}
                        disabled={item.qty >= item.stock}>+</button>
                    </div>
                    <p className="cart-item-subtotal">₹{Number(item.price * item.qty).toLocaleString()}</p>
                    <button className="cart-remove" onClick={() => onRemove(item.id)}>Remove</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="cart-footer">
              <div className="cart-summary">
                <div className="cart-summary-row">
                  <span>Subtotal ({totalItems} item{totalItems > 1 ? "s" : ""})</span>
                  <span>₹{total.toLocaleString()}</span>
                </div>
                <div className="cart-summary-row" style={{color:"var(--mt)",fontSize:13}}>
                  <span>Shipping</span><span>Free</span>
                </div>
                <div className="cart-summary-row cart-total">
                  <span>Total</span>
                  <span>₹{total.toLocaleString()}</span>
                </div>
              </div>
              <button className="cart-buy-btn" onClick={onBuyNow} disabled={buying}>
                {buying ? <><span className="spinner"/>Processing…</> : `Buy Now — ₹${total.toLocaleString()}`}
              </button>
              <p className="cart-disclaimer">Stock will be deducted on purchase</p>
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ── Order success toast ───────────────────────────────────────────────────────
function Toast({ msg, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t); }, [onClose]);
  return <div className="toast">{msg}</div>;
}


export default function App() {
  const [page, setPage]           = useState("home");
  const [mobileNav, setMobileNav] = useState(false);

  // Cart
  const [cart, setCart]               = useState([]);
  const [cartOpen, setCartOpen]       = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [toast, setToast]             = useState("");
  const cartCount = cart.reduce((s, i) => s + i.qty, 0);

  const addToCart = (p) => {
    if (p.stock === 0) return;
    setCart(prev => {
      const exists = prev.find(i => i.id === p.id);
      if (exists) {
        if (exists.qty >= p.stock) return prev;
        return prev.map(i => i.id === p.id ? { ...i, qty: i.qty + 1 } : i);
      }
      return [...prev, {
        id: p.id, name: p.name, brand: p.brand, price: p.price,
        stock: p.stock, qty: 1,
        emoji: CAT_ICON[p.category] || "📦",
        color: cc(p.category),
      }];
    });
    setToast(`${p.name} added to cart`);
  };

  const changeQty = (id, qty) => {
    if (qty <= 0) { removeFromCart(id); return; }
    setCart(prev => prev.map(i => i.id === id ? { ...i, qty } : i));
  };

  const removeFromCart = (id) => setCart(prev => prev.filter(i => i.id !== id));

  const handleOrderSuccess = () => {
    setCart([]);
    setCartOpen(false);
    setToast("✅ Order placed! Confirmation email sent.");
    fetchProducts();
  };

  // Products from DB
  const [products, setProducts]   = useState([]);
  const [dbLoaded, setDbLoaded]   = useState(false);
  const [lowStock, setLowStock]   = useState([]);

  // Catalog filters
  const [cat, setCat]   = useState("All");
  const [sort, setSort] = useState("rating");
  const [q, setQ]       = useState("");

  // AI search
  const [aiQuery, setAiQuery]   = useState("");
  const [topN, setTopN]         = useState(3);
  const [aiResult, setAiResult] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError]   = useState("");
  const searchRef = useRef(null);

  // Compare
  const [cmpNames, setCmpNames]     = useState("");
  const [cmpUse, setCmpUse]         = useState("");
  const [cmpResult, setCmpResult]   = useState(null);
  const [cmpLoading, setCmpLoading] = useState(false);
  const [cmpError, setCmpError]     = useState("");

  // Metrics
  const [metrics, setMetrics]         = useState(null);
  const [metricsLoading, setMetricsLoading] = useState(false);

  // Fetch products from DB on mount
  const fetchProducts = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/products`);
      if (!res.ok) return;
      const data = await res.json();
      setProducts(data);
      setLowStock(data.filter(p => p.stock !== undefined && p.stock <= LOW_STOCK_THRESHOLD));
    } catch {}
    setDbLoaded(true);
  }, []);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  // Also poll low-stock endpoint every 60s
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/products/low-stock`);
        if (res.ok) setLowStock(await res.json());
      } catch {}
    };
    const id = setInterval(poll, 60000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() => {
    let list = products;
    if (cat !== "All") list = list.filter(p=>p.category===cat);
    if (q.trim()) {
      const lq = q.toLowerCase();
      list = list.filter(p=>
        p.name.toLowerCase().includes(lq) ||
        p.brand.toLowerCase().includes(lq) ||
        (p.features||[]).some(f=>f.toLowerCase().includes(lq))
      );
    }
    if (sort==="rating")      list=[...list].sort((a,b)=>b.rating-a.rating);
    if (sort==="price-asc")   list=[...list].sort((a,b)=>a.price-b.price);
    if (sort==="price-desc")  list=[...list].sort((a,b)=>b.price-a.price);
    if (sort==="stock-asc")   list=[...list].sort((a,b)=>(a.stock||0)-(b.stock||0));
    return list;
  }, [products, cat, sort, q]);

  const askAI = (name) => { setAiQuery(`Tell me about ${name} and similar products`); setPage("search"); setTimeout(()=>searchRef.current?.focus(),100); };

  const handleSearch = async () => {
    if (!aiQuery.trim()) return;
    setAiLoading(true); setAiError(""); setAiResult(null);
    try {
      const res = await fetch(`${API_BASE}/recommend`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:aiQuery.trim(),top_n:topN})});
      if (!res.ok) throw new Error((await res.json()).detail||"Failed");
      setAiResult(await res.json());
    } catch(e){ setAiError(e.message); }
    setAiLoading(false);
  };

  const handleCompare = async () => {
    const names = cmpNames.split(",").map(s=>s.trim()).filter(Boolean);
    if (names.length<2){setCmpError("Enter at least 2 names.");return;}
    if (!cmpUse.trim()){setCmpError("Describe the use case.");return;}
    setCmpLoading(true); setCmpError(""); setCmpResult(null);
    try {
      const res = await fetch(`${API_BASE}/compare`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({product_names:names,use_case:cmpUse.trim()})});
      if (!res.ok) throw new Error((await res.json()).detail||"Failed");
      setCmpResult(await res.json());
    } catch(e){ setCmpError(e.message); }
    setCmpLoading(false);
  };

  const handleMetrics = async () => {
    setMetricsLoading(true);
    try { const res=await fetch(`${API_BASE}/metrics`); setMetrics(await res.json()); } catch {}
    setMetricsLoading(false);
  };

  const NAV = [
    {id:"home",label:"🛍️ Shop"},
    {id:"search",label:"✦ AI Search"},
    {id:"compare",label:"⚖️ Compare"},
    {id:"admin",label:"🔐 Admin"},
  ];

  return (
    <>
    <style>{`
      *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
      :root{
        --bg:#0f0f0f;--sur:#1a1a1a;--sur2:#242424;
        --bd:rgba(255,255,255,0.08);--bd2:rgba(255,255,255,0.14);
        --tx:#f0f0ef;--mt:#88887f;--mt2:#55554f;
        --ac:#7c6ef5;--ac2:#a89af8;--gr:#22c55e;--re:#ef4444;
        --r:12px;--rs:7px;
      }
      body{background:var(--bg);color:var(--tx);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;min-height:100vh}

      /* NAV */
      nav{position:sticky;top:0;z-index:100;background:rgba(15,15,15,0.93);backdrop-filter:blur(14px);border-bottom:.5px solid var(--bd)}
      .nav-in{max-width:1200px;margin:0 auto;padding:0 1.5rem;height:60px;display:flex;align-items:center;gap:12px}
      .logo{display:flex;align-items:center;gap:10px;cursor:pointer;flex-shrink:0}
      .logo-ic{width:34px;height:34px;border-radius:9px;background:var(--ac);display:flex;align-items:center;justify-content:center;font-size:17px}
      .logo-tx{font-size:18px;font-weight:700;letter-spacing:-.5px}
      .logo-su{font-size:11px;color:var(--mt);margin-top:-2px}
      .nav-links{display:flex;gap:2px;flex:1;justify-content:center}
      .nl{padding:7px 13px;border-radius:var(--rs);font-size:13px;cursor:pointer;border:none;background:transparent;color:var(--mt);font-family:inherit;transition:all .15s;font-weight:500;white-space:nowrap}
      .nl:hover{color:var(--tx);background:var(--sur2)}
      .nl.active{color:var(--tx);background:var(--sur2)}
      .nl.admin-nl{color:#f59e0b}
      .nl.admin-nl.active{background:#f59e0b18}
      .hamburger{display:none;flex-direction:column;gap:4px;cursor:pointer;padding:8px;border:none;background:transparent;margin-left:auto}
      .hamburger span{width:20px;height:2px;background:var(--tx);border-radius:2px}
      @media(max-width:700px){
        .nav-links{display:none}
        .nav-links.open{display:flex;flex-direction:column;position:absolute;top:60px;left:0;right:0;background:rgba(15,15,15,.98);border-bottom:.5px solid var(--bd);padding:12px;gap:2px;z-index:200}
        .hamburger{display:flex}
      }

      /* LOW STOCK BANNER */
      .ls-banner{display:flex;align-items:center;gap:12px;background:#f59e0b12;border-bottom:.5px solid #f59e0b40;padding:10px 1.5rem;font-size:13px;color:#fbbf24;flex-wrap:wrap}
      .ls-icon{font-size:16px;flex-shrink:0}
      .ls-text{flex:1}
      .ls-close{background:transparent;border:none;color:#f59e0b;cursor:pointer;font-size:16px;flex-shrink:0;padding:0 4px}

      /* HERO */
      .hero{max-width:1200px;margin:0 auto;padding:3rem 1.5rem 1rem}
      .hero h1{font-size:clamp(26px,5vw,46px);font-weight:800;letter-spacing:-1.5px;line-height:1.1;margin-bottom:12px}
      .hero-ac{color:var(--ac2)}
      .hero-sub{font-size:15px;color:var(--mt);max-width:480px;line-height:1.7;margin-bottom:24px}
      .hero-bar{display:flex;gap:8px;max-width:580px;background:var(--sur);border:1px solid var(--bd2);border-radius:50px;padding:5px 5px 5px 18px}
      .hero-bar input{flex:1;background:transparent;border:none;outline:none;font-size:15px;color:var(--tx);font-family:inherit}
      .hero-bar input::placeholder{color:var(--mt2)}
      .hero-sbtn{padding:9px 20px;background:var(--ac);color:#fff;border:none;border-radius:50px;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap}
      .hero-stats{display:flex;gap:2rem;margin-top:2rem;flex-wrap:wrap}
      .hstat span:first-child{font-size:20px;font-weight:700;display:block}
      .hstat span:last-child{font-size:12px;color:var(--mt)}

      /* CATEGORY STRIP */
      .catstrip{max-width:1200px;margin:0 auto;padding:1.25rem 1.5rem 0}
      .catscroll{display:flex;gap:7px;overflow-x:auto;padding-bottom:4px;scrollbar-width:none}
      .catscroll::-webkit-scrollbar{display:none}
      .cpill{display:flex;align-items:center;gap:5px;padding:7px 15px;border-radius:50px;border:.5px solid var(--bd2);background:var(--sur);cursor:pointer;font-size:13px;color:var(--mt);white-space:nowrap;transition:all .15s;font-family:inherit;font-weight:500}
      .cpill:hover{border-color:var(--ac);color:var(--tx)}
      .cpill.active{background:var(--ac);border-color:var(--ac);color:#fff}

      /* CATALOG */
      .catalog{max-width:1200px;margin:0 auto;padding:1.25rem 1.5rem}
      .toolbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem;flex-wrap:wrap;gap:10px}
      .tcount{font-size:13px;color:var(--mt)}
      .tright{display:flex;gap:8px;flex-wrap:wrap}
      .t-input{background:var(--sur);border:.5px solid var(--bd2);border-radius:var(--rs);padding:8px 12px;color:var(--tx);font-size:13px;font-family:inherit;outline:none;transition:border-color .15s;width:170px}
      .t-input:focus{border-color:var(--ac)}
      .t-select{background:var(--sur);border:.5px solid var(--bd2);border-radius:var(--rs);padding:8px 12px;color:var(--tx);font-size:13px;cursor:pointer;font-family:inherit}
      .pgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:15px}

      /* PRODUCT CARD */
      .pcard{background:var(--sur);border:.5px solid var(--bd);border-radius:var(--r);overflow:hidden;transition:transform .2s,border-color .2s}
      .pcard:hover{transform:translateY(-3px);border-color:var(--bd2)}
      .pcard-low{border-color:#f59e0b44}
      .pcard-img{height:135px;display:flex;align-items:center;justify-content:center;position:relative}
      .pcard-emoji{font-size:50px}
      .pcard-cat{position:absolute;top:10px;right:10px;font-size:10px;color:#fff;padding:2px 8px;border-radius:20px;font-weight:600}
      .pcard-low-flag{position:absolute;top:10px;left:10px;font-size:10px;background:#f59e0b;color:#000;padding:2px 7px;border-radius:20px;font-weight:700}
      .pcard-body{padding:13px}
      .pcard-brand{font-size:11px;color:var(--mt);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px}
      .pcard-name{font-size:14px;font-weight:600;line-height:1.3;margin-bottom:5px}
      .pcard-stars{display:flex;align-items:center;gap:5px;margin-bottom:7px}
      .st{color:#f59e0b;font-size:12px;letter-spacing:1px}
      .rn{font-size:12px;color:var(--mt)}
      .pcard-tags{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:7px}
      .tag{font-size:10px;padding:2px 7px;border-radius:12px;background:var(--sur2);color:var(--mt);border:.5px solid var(--bd)}
      .pcard-desc{font-size:12px;color:var(--mt);line-height:1.5;margin-bottom:8px}
      .pcard-foot{display:flex;justify-content:space-between;align-items:center;margin-top:10px}
      .pcard-price{font-size:16px;font-weight:700}
      .btn-ai{padding:6px 13px;background:transparent;border:.5px solid var(--ac);color:var(--ac2);border-radius:20px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s}
      .btn-ai:hover{background:var(--ac);color:#fff}

      /* STOCK PILLS */
      .spill{font-size:10px;font-weight:700;padding:3px 8px;border-radius:12px;display:inline-block;margin-bottom:6px}
      .spill.low{background:#f59e0b18;color:#fbbf24;border:.5px solid #f59e0b40}
      .spill.out{background:#ef444418;color:#f87171;border:.5px solid #ef444440}

      /* PAGE */
      .page{max-width:860px;margin:0 auto;padding:2rem 1.5rem 4rem}
      .pg-title{font-size:24px;font-weight:700;letter-spacing:-.5px;margin-bottom:6px}
      .pg-sub{font-size:14px;color:var(--mt);margin-bottom:1.75rem}

      /* SEARCH */
      .sbox{background:var(--sur);border:.5px solid var(--bd2);border-radius:var(--r);padding:1.25rem;margin-bottom:1.5rem}
      .srow{display:flex;gap:10px}
      .sinput{flex:1;background:var(--sur2);border:.5px solid var(--bd2);border-radius:var(--rs);padding:11px 14px;font-size:15px;color:var(--tx);font-family:inherit;outline:none;transition:border-color .15s}
      .sinput:focus{border-color:var(--ac)}
      .ssel{background:var(--sur2);border:.5px solid var(--bd2);border-radius:var(--rs);padding:11px 12px;color:var(--tx);font-size:14px;cursor:pointer;font-family:inherit}
      .pbtn{padding:11px 22px;background:var(--ac);color:#fff;border:none;border-radius:var(--rs);font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap;transition:opacity .15s}
      .pbtn:hover{opacity:.88}
      .pbtn:disabled{opacity:.45;cursor:not-allowed}
      .err{background:#ef444412;color:#f87171;font-size:13px;padding:10px 14px;border-radius:var(--rs);margin-top:10px}
      .rmeta{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:16px;font-size:13px;color:var(--mt)}
      .cpill2{font-size:11px;padding:3px 9px;border-radius:12px}
      .hit{background:#22c55e18;color:#4ade80}
      .miss{background:#6366f118;color:#a5b4fc}

      /* AI CARD */
      .aicard{display:flex;background:var(--sur);border:.5px solid var(--bd);border-radius:var(--r);overflow:hidden;margin-bottom:12px;animation:su .3s ease both}
      @keyframes su{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
      .aicard-rank{width:44px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;font-weight:700;flex-shrink:0}
      .aicard-body{flex:1;padding:1.1rem 1.25rem;min-width:0}
      .aicard-top{display:flex;justify-content:space-between;gap:12px;margin-bottom:10px;flex-wrap:wrap}
      .aicat{font-size:10px;color:#fff;padding:2px 8px;border-radius:12px;font-weight:600;display:inline-block;margin-bottom:4px}
      .aicard-name{font-size:16px;font-weight:700;line-height:1.3}
      .aicard-brand{font-size:12px;color:var(--mt);margin-top:2px}
      .aicard-right{text-align:right;flex-shrink:0}
      .aicard-price{font-size:18px;font-weight:700;color:var(--ac2)}
      .aicard-stars{font-size:12px;color:var(--mt);margin-top:3px}
      .aicard-expl{font-size:14px;line-height:1.65;color:#ccc;margin:8px 0 10px}
      .score-btn{background:transparent;border:.5px solid var(--bd2);border-radius:var(--rs);padding:5px 12px;font-size:12px;color:var(--mt);cursor:pointer;font-family:inherit}
      .score-btn:hover{background:var(--sur2)}
      .score-bars{margin-top:10px;border-top:.5px solid var(--bd);padding-top:10px}
      .srow2{display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:12px;color:var(--mt)}
      .srow2>span:first-child{width:70px;flex-shrink:0}
      .srow2>span:last-child{width:32px;text-align:right;flex-shrink:0}
      .btrack{flex:1;height:4px;background:var(--sur2);border-radius:4px;overflow:hidden}
      .bfill{height:100%;border-radius:4px;transition:width .5s}
      .final-sc{font-size:13px;font-weight:600;color:var(--ac2);margin-top:8px}

      /* COMPARE */
      .cmpgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px}
      .cmpcard{background:var(--sur);border:.5px solid var(--bd);border-radius:var(--r);padding:1.25rem}
      .cmpwinner{border:1.5px solid var(--ac)}
      .winner-lbl{font-size:12px;font-weight:600;color:var(--ac2);margin-bottom:8px}
      .cmp-name{font-size:15px;font-weight:700;margin-bottom:8px;line-height:1.3}
      .cmp-meta{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px}
      .cmp-price{font-size:17px;font-weight:700;color:var(--ac2)}
      .cmp-rat{font-size:12px;color:var(--mt)}
      .fit{font-size:11px;font-weight:600;padding:3px 9px;border-radius:12px;display:inline-block;margin-bottom:10px}
      .fit-high{background:#22c55e18;color:#4ade80}
      .fit-medium{background:#f59e0b18;color:#fbbf24}
      .fit-low{background:#ef444418;color:#f87171}
      .cmp-pros{font-size:13px;color:#4ade80;margin-bottom:4px}
      .cmp-cons{font-size:13px;color:#f87171;margin-bottom:4px}
      .cmp-verdict{font-size:13px;color:var(--mt);font-style:italic;border-top:.5px solid var(--bd);padding-top:10px;margin-top:8px}
      .cmp-summary{background:var(--sur);border:.5px solid var(--bd);border-radius:var(--r);padding:1.25rem;margin-bottom:14px;font-size:14px;line-height:1.7;color:#ccc}
      .cmp-winner-note{font-size:13px;color:var(--mt);margin-top:10px;border-top:.5px solid var(--bd);padding-top:10px}

      /* METRICS */
      .mgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:12px;margin-top:1.25rem}
      .mcard{background:var(--sur);border:.5px solid var(--bd);border-radius:var(--r);padding:1rem 1.1rem}
      .mlbl{font-size:11px;color:var(--mt);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}
      .mval{font-size:24px;font-weight:700}

      /* ADMIN shell styles */
      .adm-shell{max-width:1200px;margin:0 auto;padding:2rem 1.5rem 4rem}
      .adm-topbar{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:1rem;flex-wrap:wrap}
      .adm-title{font-size:24px;font-weight:700;letter-spacing:-.5px}
      .adm-sub{font-size:14px;color:var(--mt);margin-top:4px}
      .adm-low-count{color:#fbbf24;font-weight:600}
      .adm-alert-strip{display:flex;align-items:center;gap:12px;background:#f59e0b12;border:.5px solid #f59e0b40;border-radius:var(--rs);padding:10px 14px;font-size:13px;color:#fbbf24;margin-bottom:1rem;flex-wrap:wrap}
      .adm-alert-btn{background:#f59e0b;color:#000;border:none;border-radius:var(--rs);padding:5px 12px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap}
      .adm-toolbar{display:flex;gap:10px;margin-bottom:1rem;flex-wrap:wrap;align-items:center}
      .adm-search{flex:1;min-width:180px;background:var(--sur);border:.5px solid var(--bd2);border-radius:var(--rs);padding:9px 13px;color:var(--tx);font-size:14px;font-family:inherit;outline:none}
      .adm-search:focus{border-color:var(--ac)}
      .adm-select{background:var(--sur);border:.5px solid var(--bd2);border-radius:var(--rs);padding:9px 12px;color:var(--tx);font-size:13px;cursor:pointer;font-family:inherit}
      .adm-count{font-size:13px;color:var(--mt);white-space:nowrap}
      .adm-table-wrap{overflow-x:auto;border:.5px solid var(--bd);border-radius:var(--r)}
      .adm-table{width:100%;border-collapse:collapse;font-size:13px}
      .adm-table th{background:var(--sur2);padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--mt);white-space:nowrap;border-bottom:.5px solid var(--bd)}
      .adm-table td{padding:10px 14px;border-bottom:.5px solid var(--bd);vertical-align:middle}
      .adm-table tr:last-child td{border-bottom:none}
      .adm-table tr:hover td{background:var(--sur2)}
      .row-low td{background:#f59e0b06}
      .adm-id{font-size:12px;color:var(--mt);font-family:monospace}
      .adm-pname{font-weight:600;font-size:13px}
      .adm-brand{font-size:11px;color:var(--mt)}
      .adm-cat{font-size:11px;background:var(--sur2);border:.5px solid var(--bd2);border-radius:12px;padding:2px 8px;color:var(--mt)}
      .adm-badge{font-size:11px;font-weight:700;padding:3px 9px;border-radius:12px;display:inline-block}
      .adm-badge.ok{background:#22c55e18;color:#4ade80}
      .adm-badge.low{background:#f59e0b18;color:#fbbf24}
      .adm-badge.out{background:#ef444418;color:#f87171}
      .stock-controls{display:flex;gap:5px;align-items:center}
      .qty-input{width:56px;background:var(--sur2);border:.5px solid var(--bd2);border-radius:var(--rs);padding:6px 8px;color:var(--tx);font-size:13px;font-family:inherit;outline:none;text-align:center}
      .adm-btn{padding:7px 13px;border:none;border-radius:var(--rs);font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap;transition:opacity .15s}
      .adm-btn:disabled{opacity:.45;cursor:not-allowed}
      .adm-btn.green{background:#22c55e;color:#000}
      .adm-btn.red{background:#ef4444;color:#fff}
      .adm-btn.gray{background:var(--sur2);color:var(--tx);border:.5px solid var(--bd2)}
      .adm-btn.wide{width:100%;padding:11px}
      .adm-btn.green:hover{opacity:.88}
      .adm-icon-btn{background:transparent;border:.5px solid var(--bd2);border-radius:var(--rs);padding:5px 9px;cursor:pointer;font-size:14px;transition:background .15s}
      .adm-icon-btn:hover{background:var(--sur2)}
      .adm-tabs{display:flex;gap:4px;background:var(--sur2);border-radius:10px;padding:4px;margin-bottom:1.25rem;width:fit-content}
      .adm-tab{padding:8px 20px;border:none;background:transparent;cursor:pointer;border-radius:7px;font-size:14px;color:var(--mt);font-family:inherit;font-weight:500;transition:all .15s}
      .adm-tab:hover{color:var(--tx)}
      .adm-tab-active{background:var(--sur);color:var(--tx);box-shadow:0 1px 3px rgba(0,0,0,.2)}
      .adm-info-strip{background:#6366f112;border:.5px solid #6366f130;border-radius:var(--rs);padding:12px 16px;font-size:13px;color:#a5b4fc;line-height:1.7;margin-bottom:1.25rem}
      .adm-mgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}
      .adm-mcard{background:var(--sur);border:.5px solid var(--bd);border-radius:var(--r);padding:1rem 1.1rem}
      .adm-mlbl{font-size:11px;color:var(--mt);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}
      .adm-mval{font-size:26px;font-weight:700;margin-bottom:4px}
      .adm-mnote{font-size:11px;color:var(--mt2);line-height:1.4}
      .adm-error{background:#ef444412;color:#f87171;font-size:13px;padding:10px 14px;border-radius:var(--rs);margin-top:10px}
      .adm-login{display:flex;align-items:center;justify-content:center;min-height:60vh;padding:2rem}
      .adm-login-card{background:var(--sur);border:.5px solid var(--bd2);border-radius:var(--r);padding:2.5rem;width:100%;max-width:380px;text-align:center}
      .adm-login-icon{font-size:40px;margin-bottom:1rem}
      .adm-login-card h2{font-size:20px;font-weight:700;margin-bottom:6px}
      .adm-login-card p{font-size:14px;color:var(--mt);margin-bottom:1.5rem}
      .adm-key-input{width:100%;background:var(--sur2);border:.5px solid var(--bd2);border-radius:var(--rs);padding:11px 14px;font-size:14px;color:var(--tx);font-family:inherit;outline:none;margin-bottom:10px;text-align:center}
      .adm-key-input:focus{border-color:var(--ac)}
      /* MODAL */
      .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:1000;display:flex;align-items:center;justify-content:center;padding:1rem}
      .modal{background:var(--sur);border:.5px solid var(--bd2);border-radius:var(--r);width:100%;max-width:560px;max-height:90vh;display:flex;flex-direction:column}
      .modal-header{display:flex;justify-content:space-between;align-items:center;padding:1.25rem 1.5rem;border-bottom:.5px solid var(--bd)}
      .modal-header h2{font-size:18px;font-weight:700}
      .modal-close{background:transparent;border:none;color:var(--mt);font-size:20px;cursor:pointer;padding:0 4px}
      .modal-body{padding:1.25rem 1.5rem;overflow-y:auto;flex:1}
      .modal-footer{padding:1rem 1.5rem;border-top:.5px solid var(--bd);display:flex;justify-content:flex-end;gap:8px}
      .form-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}
      .form-field{display:flex;flex-direction:column;gap:5px}
      .form-field.full{margin-bottom:12px}
      .form-field label{font-size:12px;color:var(--mt);font-weight:500}
      .form-field input,.form-field select,.form-field textarea{background:var(--sur2);border:.5px solid var(--bd2);border-radius:var(--rs);padding:9px 12px;color:var(--tx);font-size:13px;font-family:inherit;outline:none;transition:border-color .15s}
      .form-field input:focus,.form-field select:focus,.form-field textarea:focus{border-color:var(--ac)}
      .form-field textarea{resize:vertical}

      /* MISC */
      .adm-loading{padding:2rem;text-align:center;color:var(--mt)}
      .empty{text-align:center;padding:4rem 1rem;color:var(--mt)}
      .empty .big{font-size:48px;margin-bottom:12px}
      .spinner{display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite;vertical-align:-2px;margin-right:6px}
      @keyframes spin{to{transform:rotate(360deg)}}
      footer{border-top:.5px solid var(--bd);padding:2rem 1.5rem;text-align:center;color:var(--mt2);font-size:13px}
      .foot-in{max-width:1200px;margin:0 auto}
      .tbadges{display:flex;justify-content:center;gap:7px;flex-wrap:wrap;margin-top:10px}
      .tbadge{font-size:11px;padding:3px 10px;border-radius:12px;border:.5px solid var(--bd2);color:var(--mt)}
      /* CART */
      .cart-icon-btn{position:relative;background:var(--sur2);border:.5px solid var(--bd2);border-radius:var(--rs);padding:8px 14px;color:var(--tx);cursor:pointer;font-size:18px;font-family:inherit;transition:background .15s;display:flex;align-items:center;gap:6px;flex-shrink:0}
      .cart-icon-btn:hover{background:var(--sur)}
      .cart-badge{background:var(--ac);color:#fff;font-size:11px;font-weight:700;border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;position:absolute;top:-6px;right:-6px}
      .cart-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:200;backdrop-filter:blur(2px)}
      .cart-drawer{position:fixed;top:0;right:0;height:100vh;width:100%;max-width:420px;background:var(--sur);border-left:.5px solid var(--bd2);z-index:201;display:flex;flex-direction:column;animation:slideIn .25s ease}
      @keyframes slideIn{from{transform:translateX(100%)}to{transform:none}}
      .cart-header{display:flex;justify-content:space-between;align-items:center;padding:1.25rem 1.5rem;border-bottom:.5px solid var(--bd)}
      .cart-title{font-size:18px;font-weight:700;display:flex;align-items:center;gap:8px}
      .cart-count{background:var(--ac);color:#fff;font-size:12px;font-weight:700;border-radius:12px;padding:2px 8px}
      .cart-close{background:transparent;border:none;color:var(--mt);font-size:20px;cursor:pointer;padding:4px}
      .cart-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--mt);padding:2rem}
      .cart-items{flex:1;overflow-y:auto;padding:1rem 1.5rem;display:flex;flex-direction:column;gap:12px}
      .cart-item{display:flex;gap:12px;align-items:flex-start;background:var(--sur2);border-radius:var(--r);padding:12px;border:.5px solid var(--bd)}
      .cart-item-icon{width:56px;height:56px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
      .cart-item-info{flex:1;min-width:0}
      .cart-item-name{font-size:14px;font-weight:600;line-height:1.3;margin-bottom:2px}
      .cart-item-brand{font-size:12px;color:var(--mt);margin-bottom:2px}
      .cart-item-price{font-size:12px;color:var(--mt)}
      .cart-item-warn{font-size:11px;color:#fbbf24;margin-top:3px}
      .cart-item-right{display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0}
      .cart-qty{display:flex;align-items:center;gap:6px;background:var(--sur);border:.5px solid var(--bd2);border-radius:var(--rs);padding:3px 6px}
      .qty-btn{background:transparent;border:none;color:var(--tx);cursor:pointer;font-size:16px;width:22px;height:22px;display:flex;align-items:center;justify-content:center;border-radius:4px;transition:background .15s}
      .qty-btn:hover:not(:disabled){background:var(--sur2)}
      .qty-btn:disabled{opacity:.35;cursor:not-allowed}
      .qty-val{font-size:14px;font-weight:600;min-width:20px;text-align:center}
      .cart-item-subtotal{font-size:14px;font-weight:700;color:var(--ac2)}
      .cart-remove{background:transparent;border:none;color:var(--mt);font-size:12px;cursor:pointer;text-decoration:underline;padding:0}
      .cart-remove:hover{color:var(--re)}
      .cart-footer{padding:1.25rem 1.5rem;border-top:.5px solid var(--bd);background:var(--sur)}
      .cart-summary{margin-bottom:1rem}
      .cart-summary-row{display:flex;justify-content:space-between;font-size:14px;margin-bottom:6px}
      .cart-total{font-size:17px;font-weight:700;border-top:.5px solid var(--bd);padding-top:10px;margin-top:6px}
      .cart-buy-btn{width:100%;padding:14px;background:var(--ac);color:#fff;border:none;border-radius:var(--r);font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;transition:opacity .15s}
      .cart-buy-btn:hover{opacity:.88}
      .cart-buy-btn:disabled{opacity:.5;cursor:not-allowed}
      .cart-disclaimer{font-size:12px;color:var(--mt);text-align:center;margin-top:8px}
      /* Add to cart btn */
      .btn-cart{width:100%;margin-top:8px;padding:9px;background:var(--sur2);border:.5px solid var(--bd2);border-radius:var(--rs);color:var(--tx);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s}
      .btn-cart:hover:not(:disabled){background:var(--ac);border-color:var(--ac);color:#fff}
      .btn-cart-in{background:#22c55e18;border-color:#22c55e40;color:#4ade80}
      .btn-cart-out{opacity:.4;cursor:not-allowed}
      .pcard-out-flag{position:absolute;top:10px;left:10px;font-size:10px;background:#ef4444;color:#fff;padding:2px 7px;border-radius:20px;font-weight:700}
      /* Toast */
      .toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--sur);border:.5px solid var(--bd2);color:var(--tx);padding:12px 24px;border-radius:50px;font-size:14px;font-weight:500;z-index:300;box-shadow:0 8px 32px rgba(0,0,0,.4);animation:toastIn .25s ease;white-space:nowrap}
      @keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
    `}</style>

      {/* NAV */}
      <nav>
        <div className="nav-in">
          <div className="logo" onClick={()=>{setPage("home");setMobileNav(false)}}>
            <div className="logo-ic">🛒</div>
            <div><div className="logo-tx">ShopLens</div><div className="logo-su">RAG Shopping</div></div>
          </div>
          <div className={`nav-links${mobileNav?" open":""}`}>
            {NAV.map(n=>(
              <button key={n.id} className={`nl${page===n.id?" active":""}${n.id==="admin"?" admin-nl":""}`}
                onClick={()=>{setPage(n.id);setMobileNav(false)}}>
                {n.label}
              </button>
            ))}
          </div>
          <button className="cart-icon-btn" onClick={()=>setCartOpen(true)}>
            🛒
            {cartCount > 0 && <span className="cart-badge">{cartCount}</span>}
          </button>
          <button className="hamburger" onClick={()=>setMobileNav(!mobileNav)} aria-label="Menu">
            <span/><span/><span/>
          </button>
        </div>
      </nav>

      {/* LOW STOCK BANNER — shown on non-admin pages */}
      {page !== "admin" && <LowStockBanner items={lowStock} />}

      {/* ── HOME ── */}
      {page==="home" && (
        <>
          <div className="hero">
            <h1>Shop smarter with<br/><span className="hero-ac">AI-powered search</span></h1>
            <p className="hero-sub">Describe what you need in plain English — hybrid RAG finds the best match.</p>
            <div className="hero-bar">
              <input placeholder='Try "waterproof hiking boots under ₹2000"…'
                value={aiQuery} onChange={e=>setAiQuery(e.target.value)}
                onKeyDown={e=>{if(e.key==="Enter"&&e.target.value.trim())setPage("search")}} />
              <button className="hero-sbtn" onClick={()=>{if(aiQuery.trim())setPage("search")}}>Search with AI →</button>
            </div>
            <div className="hero-stats">
              <div className="hstat"><span>{products.length||40}</span><span>Products</span></div>
              <div className="hstat"><span>10</span><span>Categories</span></div>
              <div className="hstat"><span>BM25 + pgvector</span><span>Hybrid retrieval</span></div>
              <div className="hstat"><span>RRF</span><span>Rank fusion</span></div>
            </div>
          </div>

          <div className="catstrip">
            <div className="catscroll">
              {CATEGORIES.map(c=>(
                <button key={c} className={`cpill${cat===c?" active":""}`} onClick={()=>setCat(c)}>
                  {CAT_ICON[c]} {c}
                </button>
              ))}
            </div>
          </div>

          <div className="catalog">
            <div className="toolbar">
              <span className="tcount">{filtered.length} products{cat!=="All"?` in ${cat}`:""}{q?` for "${q}"`:""}</span>
              <div className="tright">
                <input className="t-input" placeholder="Filter…" value={q} onChange={e=>setQ(e.target.value)} />
                <select className="t-select" value={sort} onChange={e=>setSort(e.target.value)}>
                  <option value="rating">Top rated</option>
                  <option value="price-asc">Price: low → high</option>
                  <option value="price-desc">Price: high → low</option>
                  <option value="stock-asc">Stock: low → high</option>
                </select>
              </div>
            </div>
            {!dbLoaded ? (
              <div className="empty"><div className="big">⏳</div><p>Loading products from database…</p></div>
            ) : filtered.length===0 ? (
              <div className="empty"><div className="big">🔍</div><p>No products match your filter.</p></div>
            ) : (
              <div className="pgrid">
                {filtered.map(p=>(
                  <ProductCard key={p.id} p={p} onAskAI={askAI}
                    onAddToCart={addToCart}
                    inCart={cart.some(i=>i.id===p.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── AI SEARCH ── */}
      {page==="search" && (
        <div className="page">
          <h1 className="pg-title">AI Search</h1>
          <p className="pg-sub">Describe what you need — RAG pipeline handles the rest.</p>
          <div className="sbox">
            <div className="srow">
              <input ref={searchRef} className="sinput" value={aiQuery}
                onChange={e=>setAiQuery(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&handleSearch()}
                placeholder='e.g. "waterproof camping gear under ₹1500"' />
              <select className="ssel" value={topN} onChange={e=>setTopN(Number(e.target.value))}>
                {[1,2,3,4,5].map(n=><option key={n} value={n}>Top {n}</option>)}
              </select>
              <button className="pbtn" onClick={handleSearch} disabled={aiLoading||!aiQuery.trim()}>
                {aiLoading?<><span className="spinner"/>Searching…</>:"Search ✦"}
              </button>
            </div>
            {aiError && <div className="err">{aiError}</div>}
          </div>
          {aiResult && (
            <>
              <div className="rmeta">
                <span>Results for: <strong>{aiResult.query}</strong></span>
                <span className={`cpill2 ${aiResult.cache_hit?"hit":"miss"}`}>
                  {aiResult.cache_hit?"💾 cache hit":"🔄 fresh"}
                </span>
                {aiResult.extracted_constraints?.max_price && <span>Budget: ₹{aiResult.extracted_constraints.max_price}</span>}
              </div>
              {aiResult.recommendations.map((r,i)=><AICard key={r.id} rec={r} rank={i}/>)}
            </>
          )}
          {!aiResult&&!aiLoading&&<div className="empty"><div className="big">✦</div><p>Enter a query to get AI recommendations.</p></div>}
        </div>
      )}

      {/* ── COMPARE ── */}
      {page==="compare" && (
        <div className="page">
          <h1 className="pg-title">Compare Products</h1>
          <p className="pg-sub">Compare 2–4 products side by side for your use case.</p>
          <div className="sbox">
            <div style={{marginBottom:12}}>
              <label style={{fontSize:13,color:"var(--mt)",display:"block",marginBottom:6,fontWeight:500}}>Product names (comma-separated)</label>
              <input className="sinput" style={{width:"100%"}} value={cmpNames} onChange={e=>setCmpNames(e.target.value)}
                placeholder="e.g. AquaShield Hiking Boots, CloudWalk Running Shoes" />
              <p style={{fontSize:12,color:"var(--mt2)",marginTop:4}}>Use partial names — we'll match them from the catalog</p>
            </div>
            <div>
              <label style={{fontSize:13,color:"var(--mt)",display:"block",marginBottom:6,fontWeight:500}}>Use case</label>
              <div className="srow">
                <input className="sinput" value={cmpUse} onChange={e=>setCmpUse(e.target.value)}
                  placeholder="e.g. monsoon trekking in the Himalayas" />
                <button className="pbtn" onClick={handleCompare} disabled={cmpLoading}>
                  {cmpLoading?<><span className="spinner"/>Comparing…</>:"Compare ⚖️"}
                </button>
              </div>
            </div>
            {cmpError&&<div className="err">{cmpError}</div>}
          </div>
          {cmpResult&&(
            <>
              {cmpResult.comparison?.summary&&(
                <div className="cmp-summary">
                  {cmpResult.comparison.summary}
                  {cmpResult.comparison.winner&&(
                    <div className="cmp-winner-note">🏆 Best overall: <strong>{cmpResult.comparison.winner.product_id}</strong> — {cmpResult.comparison.winner.reason}</div>
                  )}
                </div>
              )}
              <div className="cmpgrid">
                {cmpResult.comparison?.comparison_table?.map(e=>(
                  <CmpCard key={e.product_id} e={e} isWinner={e.product_id===cmpResult.comparison.winner?.product_id}/>
                ))}
              </div>
            </>
          )}
          {!cmpResult&&!cmpLoading&&<div className="empty"><div className="big">⚖️</div><p>Enter product names to compare.</p></div>}
        </div>
      )}

      {/* ── ADMIN ── */}
      {page==="admin" && <AdminPage onProductsChanged={fetchProducts}/>}

      <footer>
        <div className="foot-in">
          <p>ShopLens · RAG shopping assistant — FastAPI · LangChain · pgvector · BM25 · Mistral AI · Supabase</p>
          <div className="tbadges">
            {["FastAPI","LangChain","pgvector","BM25 + RRF","Mistral AI","Supabase","React + Vite","Render","Vercel"].map(t=>(
              <span key={t} className="tbadge">{t}</span>
            ))}
          </div>
        </div>
      </footer>

      {/* CART DRAWER */}
      {cartOpen && (
        <CartDrawer
          cart={cart}
          onClose={()=>setCartOpen(false)}
          onQtyChange={changeQty}
          onRemove={removeFromCart}
          onBuyNow={()=>{ setCartOpen(false); setCheckoutOpen(true); }}
          buying={false}
        />
      )}

      {/* CHECKOUT MODAL */}
      {checkoutOpen && (
        <CheckoutModal
          cart={cart}
          total={cart.reduce((s,i)=>s+i.price*i.qty,0)}
          onClose={()=>setCheckoutOpen(false)}
          onSuccess={handleOrderSuccess}
        />
      )}

      {/* TOAST */}
      {toast && <Toast msg={toast} onClose={()=>setToast("")}/>}
    </>
  );
}