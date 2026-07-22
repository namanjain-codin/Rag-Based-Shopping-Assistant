import { useState } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function AuthPage({ onAuth }) {
  const [mode, setMode]         = useState("login"); // login | signup
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [showPass, setShowPass] = useState(false);

  const handleSubmit = async () => {
    setError(""); setLoading(true);
    try {
      const endpoint = mode === "login" ? "/auth/login" : "/auth/signup";
      const body     = mode === "login"
        ? { email, password }
        : { email, password, full_name: fullName };

      const res = await fetch(`${API_BASE}${endpoint}`, {
        method:      "POST",
        headers:     { "Content-Type": "application/json" },
        credentials: "include",   // ← sends/receives cookies
        body:        JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Something went wrong.");
      onAuth(data.user);
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  return (
    <>
      <style>{`
        .auth-bg{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f0f0f;padding:1.5rem}
        .auth-card{background:#1a1a1a;border:.5px solid rgba(255,255,255,.1);border-radius:16px;width:100%;max-width:400px;padding:2.5rem;animation:authIn .3s ease}
        @keyframes authIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
        .auth-logo{display:flex;align-items:center;gap:10px;margin-bottom:2rem}
        .auth-logo-ic{width:38px;height:38px;border-radius:10px;background:#7c6ef5;display:flex;align-items:center;justify-content:center;font-size:18px}
        .auth-logo-tx{font-size:20px;font-weight:800;letter-spacing:-.5px;color:#f0f0ef}
        .auth-logo-su{font-size:11px;color:#88887f}
        .auth-title{font-size:22px;font-weight:700;color:#f0f0ef;margin-bottom:6px;letter-spacing:-.5px}
        .auth-sub{font-size:14px;color:#88887f;margin-bottom:1.75rem;line-height:1.6}
        .auth-field{margin-bottom:14px}
        .auth-label{display:block;font-size:12px;color:#88887f;font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}
        .auth-input{width:100%;background:#242424;border:.5px solid rgba(255,255,255,.1);border-radius:9px;padding:12px 14px;font-size:14px;color:#f0f0ef;font-family:inherit;outline:none;transition:border-color .15s}
        .auth-input:focus{border-color:#7c6ef5}
        .auth-input-wrap{position:relative}
        .auth-input-wrap .auth-input{padding-right:44px}
        .auth-eye{position:absolute;right:12px;top:50%;transform:translateY(-50%);background:transparent;border:none;color:#88887f;cursor:pointer;font-size:16px;padding:4px}
        .auth-btn{width:100%;padding:13px;background:#7c6ef5;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;transition:opacity .15s;margin-top:6px;display:flex;align-items:center;justify-content:center;gap:8px}
        .auth-btn:hover{opacity:.88}
        .auth-btn:disabled{opacity:.45;cursor:not-allowed}
        .auth-spinner{width:16px;height:16px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite}
        @keyframes spin{to{transform:rotate(360deg)}}
        .auth-err{background:#ef444412;color:#f87171;font-size:13px;padding:10px 14px;border-radius:8px;margin-bottom:14px;line-height:1.5}
        .auth-switch{text-align:center;margin-top:1.25rem;font-size:13px;color:#88887f}
        .auth-switch button{background:transparent;border:none;color:#a89af8;cursor:pointer;font-size:13px;font-family:inherit;text-decoration:underline;margin-left:4px}
        .auth-divider{display:flex;align-items:center;gap:12px;margin:1.25rem 0;color:#55554f;font-size:12px}
        .auth-divider::before,.auth-divider::after{content:'';flex:1;height:.5px;background:rgba(255,255,255,.08)}
        .auth-hint{font-size:12px;color:#55554f;margin-top:4px}
        .auth-strength{height:3px;border-radius:3px;margin-top:6px;transition:all .3s}
      `}</style>

      <div className="auth-bg">
        <div className="auth-card">
          {/* Logo */}
          <div className="auth-logo">
            <div className="auth-logo-ic">🛒</div>
            <div>
              <div className="auth-logo-tx">ShopLens</div>
              <div className="auth-logo-su">RAG Shopping Assistant</div>
            </div>
          </div>

          {/* Title */}
          <h1 className="auth-title">
            {mode === "login" ? "Welcome back" : "Create your account"}
          </h1>
          <p className="auth-sub">
            {mode === "login"
              ? "Sign in to access your personalised shopping experience."
              : "Join ShopLens to start shopping with AI-powered recommendations."}
          </p>

          {/* Error */}
          {error && <div className="auth-err">⚠ {error}</div>}

          {/* Full name — signup only */}
          {mode === "signup" && (
            <div className="auth-field">
              <label className="auth-label">Full name</label>
              <input className="auth-input" type="text" value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="Naman Jain" autoComplete="name" />
            </div>
          )}

          {/* Email */}
          <div className="auth-field">
            <label className="auth-label">Email address</label>
            <input className="auth-input" type="email" value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSubmit()}
              placeholder="you@example.com" autoComplete="email" />
          </div>

          {/* Password */}
          <div className="auth-field">
            <label className="auth-label">Password</label>
            <div className="auth-input-wrap">
              <input className="auth-input" type={showPass ? "text" : "password"}
                value={password} onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSubmit()}
                placeholder={mode === "signup" ? "Min 6 characters" : "Your password"}
                autoComplete={mode === "login" ? "current-password" : "new-password"} />
              <button className="auth-eye" onClick={() => setShowPass(!showPass)}>
                {showPass ? "🙈" : "👁️"}
              </button>
            </div>
            {mode === "signup" && password && (
              <>
                <div className="auth-strength" style={{
                  width: `${Math.min(password.length / 12 * 100, 100)}%`,
                  background: password.length < 6 ? "#ef4444" : password.length < 10 ? "#f59e0b" : "#22c55e"
                }} />
                <p className="auth-hint">
                  {password.length < 6 ? "Too short" : password.length < 10 ? "Could be stronger" : "Strong password ✓"}
                </p>
              </>
            )}
          </div>

          {/* Submit */}
          <button className="auth-btn" onClick={handleSubmit} disabled={loading || !email || !password || (mode === "signup" && !fullName)}>
            {loading
              ? <><div className="auth-spinner" />{mode === "login" ? "Signing in…" : "Creating account…"}</>
              : mode === "login" ? "Sign in →" : "Create account →"
            }
          </button>

          {/* Switch mode */}
          <div className="auth-divider">or</div>
          <div className="auth-switch">
            {mode === "login" ? "Don't have an account?" : "Already have an account?"}
            <button onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }}>
              {mode === "login" ? "Sign up" : "Sign in"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}