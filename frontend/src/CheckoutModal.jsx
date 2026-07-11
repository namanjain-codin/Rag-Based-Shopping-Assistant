import { useState } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

const STEPS = ["details", "otp", "success"];

function Field({ label, type = "text", value, onChange, placeholder, error, hint }) {
  return (
    <div className="co-field">
      <label className="co-label">{label}</label>
      <input
        type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} className={`co-input${error ? " co-input-err" : ""}`}
      />
      {hint  && <p className="co-hint">{hint}</p>}
      {error && <p className="co-err-msg">{error}</p>}
    </div>
  );
}

export default function CheckoutModal({ cart, total, onClose, onSuccess }) {
  const [step, setStep]     = useState("details");
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState("");

  // Step 1 — details
  const [name, setName]       = useState("");
  const [email, setEmail]     = useState("");
  const [mobile, setMobile]   = useState("");
  const [address, setAddress] = useState("");
  const [errors, setErrors]   = useState({});

  // Step 2 — OTP
  const [otp, setOtp]         = useState("");
  const [otpError, setOtpError] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);

  // Step 3 — success
  const [orderSummary, setOrderSummary] = useState(null);

  // ── Validation ─────────────────────────────────────────────────────────────
  const validate = () => {
    const e = {};
    if (!name.trim() || name.trim().length < 2)
      e.name = "Name must be at least 2 characters.";
    if (!email.match(/^[^@]+@[^@]+\.[^@]+$/))
      e.email = "Enter a valid email address.";
    if (!mobile.match(/^[6-9]\d{9}$/))
      e.mobile = "Enter a valid 10-digit Indian mobile number.";
    if (!address.trim() || address.trim().length < 10)
      e.address = "Enter your full delivery address (min 10 chars).";
    return e;
  };

  // ── Step 1: Send OTP ───────────────────────────────────────────────────────
  const handleSendOtp = async () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setErrors({}); setApiError(""); setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/checkout/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(), email: email.trim(),
          mobile: mobile.trim(), address: address.trim(),
          items: cart.map(i => ({ id: i.id, name: i.name, qty: i.qty, price: i.price })),
          total,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to send OTP.");
      setStep("otp");
      startResendTimer();
    } catch (err) { setApiError(err.message); }
    setLoading(false);
  };

  // ── Resend cooldown timer ──────────────────────────────────────────────────
  const startResendTimer = () => {
    setResendCooldown(30);
    const id = setInterval(() => {
      setResendCooldown(c => { if (c <= 1) { clearInterval(id); return 0; } return c - 1; });
    }, 1000);
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setApiError(""); setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/checkout/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(), email: email.trim(),
          mobile: mobile.trim(), address: address.trim(),
          items: cart.map(i => ({ id: i.id, name: i.name, qty: i.qty, price: i.price })),
          total,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).detail);
      startResendTimer();
      setOtp("");
    } catch (err) { setApiError(err.message); }
    setLoading(false);
  };

  // ── Step 2: Verify OTP ─────────────────────────────────────────────────────
  const handleVerifyOtp = async () => {
    if (otp.length !== 6) { setOtpError("Enter the 6-digit OTP."); return; }
    setOtpError(""); setApiError(""); setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/checkout/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), otp: otp.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "OTP verification failed.");
      setOrderSummary(data.order_summary);
      setStep("success");
      onSuccess();
    } catch (err) { setOtpError(err.message); }
    setLoading(false);
  };

  return (
    <>
      <style>{`
        .co-overlay{position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:400;backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:1rem}
        .co-modal{background:#1a1a1a;border:.5px solid rgba(255,255,255,.12);border-radius:16px;width:100%;max-width:480px;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;animation:coIn .25s ease}
        @keyframes coIn{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:none}}
        .co-header{display:flex;justify-content:space-between;align-items:center;padding:1.25rem 1.5rem;border-bottom:.5px solid rgba(255,255,255,.08)}
        .co-title{font-size:17px;font-weight:700;display:flex;align-items:center;gap:8px}
        .co-step-badge{font-size:11px;background:#7c6ef520;color:#a89af8;border:.5px solid #7c6ef540;border-radius:12px;padding:2px 9px;font-weight:600}
        .co-close{background:transparent;border:none;color:#88887f;font-size:20px;cursor:pointer;padding:4px;line-height:1}
        .co-body{padding:1.5rem;overflow-y:auto;flex:1}
        .co-field{margin-bottom:14px}
        .co-label{display:block;font-size:12px;color:#88887f;font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}
        .co-input{width:100%;background:#242424;border:.5px solid rgba(255,255,255,.1);border-radius:8px;padding:11px 14px;font-size:14px;color:#f0f0ef;font-family:inherit;outline:none;transition:border-color .15s}
        .co-input:focus{border-color:#7c6ef5}
        .co-input-err{border-color:#ef4444!important}
        .co-err-msg{font-size:12px;color:#f87171;margin-top:4px}
        .co-hint{font-size:12px;color:#55554f;margin-top:4px}
        .co-api-err{background:#ef444412;color:#f87171;font-size:13px;padding:10px 14px;border-radius:8px;margin-bottom:14px}
        .co-footer{padding:1rem 1.5rem;border-top:.5px solid rgba(255,255,255,.08)}
        .co-primary-btn{width:100%;padding:13px;background:#7c6ef5;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;transition:opacity .15s;display:flex;align-items:center;justify-content:center;gap:8px}
        .co-primary-btn:hover{opacity:.88}
        .co-primary-btn:disabled{opacity:.45;cursor:not-allowed}
        .co-spinner{width:16px;height:16px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite}
        @keyframes spin{to{transform:rotate(360deg)}}

        /* Order summary strip */
        .co-order-strip{background:#242424;border-radius:10px;padding:14px;margin-bottom:18px}
        .co-order-title{font-size:12px;color:#88887f;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;font-weight:600}
        .co-order-item{display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;color:#ccc}
        .co-order-total{display:flex;justify-content:space-between;font-size:15px;font-weight:700;border-top:.5px solid rgba(255,255,255,.08);padding-top:10px;margin-top:6px}

        /* Steps indicator */
        .co-steps{display:flex;align-items:center;gap:8px;margin-bottom:20px}
        .co-step{display:flex;align-items:center;gap:6px;font-size:12px;color:#55554f}
        .co-step.active{color:#a89af8;font-weight:600}
        .co-step.done{color:#4ade80}
        .co-step-dot{width:20px;height:20px;border-radius:50%;border:.5px solid currentColor;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0}
        .co-step-line{flex:1;height:.5px;background:rgba(255,255,255,.08)}

        /* OTP input */
        .co-otp-wrap{display:flex;justify-content:center;gap:10px;margin:20px 0}
        .co-otp-box{width:48px;height:56px;background:#242424;border:.5px solid rgba(255,255,255,.1);border-radius:10px;font-size:24px;font-weight:700;text-align:center;color:#f0f0ef;font-family:inherit;outline:none;transition:border-color .15s}
        .co-otp-box:focus{border-color:#7c6ef5}
        .co-resend{text-align:center;font-size:13px;color:#88887f;margin-top:8px}
        .co-resend button{background:transparent;border:none;color:#a89af8;cursor:pointer;font-size:13px;font-family:inherit;text-decoration:underline}
        .co-resend button:disabled{color:#55554f;cursor:not-allowed;text-decoration:none}
        .co-email-sent{background:#7c6ef512;border:.5px solid #7c6ef530;border-radius:10px;padding:14px;font-size:13px;color:#a89af8;text-align:center;margin-bottom:18px;line-height:1.6}

        /* Success */
        .co-success{text-align:center;padding:1rem 0 .5rem}
        .co-success-icon{font-size:56px;margin-bottom:16px}
        .co-success h2{font-size:22px;font-weight:800;margin-bottom:8px;letter-spacing:-.5px}
        .co-success p{font-size:14px;color:#88887f;line-height:1.7;margin-bottom:20px}
        .co-success-detail{background:#22c55e12;border:.5px solid #22c55e30;border-radius:10px;padding:14px;text-align:left;font-size:13px;color:#4ade80;line-height:1.8;margin-bottom:20px}
      `}</style>

      <div className="co-overlay" onClick={e => e.target === e.currentTarget && step !== "success" && onClose()}>
        <div className="co-modal">

          {/* Header */}
          <div className="co-header">
            <div className="co-title">
              🛍️ Checkout
              <span className="co-step-badge">
                {step === "details" ? "Step 1 of 2" : step === "otp" ? "Step 2 of 2" : "Done"}
              </span>
            </div>
            {step !== "success" && (
              <button className="co-close" onClick={onClose}>✕</button>
            )}
          </div>

          {/* Body */}
          <div className="co-body">
            {/* Steps indicator */}
            <div className="co-steps">
              <div className={`co-step ${step === "details" ? "active" : "done"}`}>
                <div className="co-step-dot">{step !== "details" ? "✓" : "1"}</div>
                Details
              </div>
              <div className="co-step-line" />
              <div className={`co-step ${step === "otp" ? "active" : step === "success" ? "done" : ""}`}>
                <div className="co-step-dot">{step === "success" ? "✓" : "2"}</div>
                Verify Email
              </div>
              <div className="co-step-line" />
              <div className={`co-step ${step === "success" ? "done" : ""}`}>
                <div className="co-step-dot">{step === "success" ? "✓" : "3"}</div>
                Confirmed
              </div>
            </div>

            {/* ── STEP 1: Details ── */}
            {step === "details" && (
              <>
                {/* Order summary */}
                <div className="co-order-strip">
                  <p className="co-order-title">Order summary</p>
                  {cart.map(i => (
                    <div key={i.id} className="co-order-item">
                      <span>{i.name} × {i.qty}</span>
                      <span>₹{Number(i.price * i.qty).toLocaleString()}</span>
                    </div>
                  ))}
                  <div className="co-order-total">
                    <span>Total</span>
                    <span style={{ color: "#a89af8" }}>₹{Number(total).toLocaleString()}</span>
                  </div>
                </div>

                {apiError && <div className="co-api-err">{apiError}</div>}

                <Field label="Full name" value={name} onChange={setName}
                  placeholder="Naman Jain" error={errors.name} />
                <Field label="Email address" type="email" value={email} onChange={setEmail}
                  placeholder="you@example.com" error={errors.email}
                  hint="OTP will be sent here" />
                <Field label="Mobile number" type="tel" value={mobile} onChange={setMobile}
                  placeholder="9876543210" error={errors.mobile}
                  hint="10-digit Indian mobile number" />
                <Field label="Delivery address" value={address} onChange={setAddress}
                  placeholder="123, MG Road, Jaipur, Rajasthan — 302001"
                  error={errors.address} />
              </>
            )}

            {/* ── STEP 2: OTP ── */}
            {step === "otp" && (
              <>
                <div className="co-email-sent">
                  📧 OTP sent to <strong>{email}</strong><br />
                  Check your inbox (and spam folder just in case)
                </div>

                {apiError && <div className="co-api-err">{apiError}</div>}

                <p className="co-label" style={{ textAlign: "center", marginBottom: 0 }}>Enter 6-digit OTP</p>
                <div className="co-otp-wrap">
                  {Array.from({ length: 6 }, (_, i) => (
                    <input
                      key={i}
                      className="co-otp-box"
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={otp[i] || ""}
                      onChange={e => {
                        const val = e.target.value.replace(/\D/g, "");
                        const arr = otp.split("");
                        arr[i] = val;
                        const next = arr.join("").slice(0, 6);
                        setOtp(next);
                        setOtpError("");
                        // Auto-focus next box
                        if (val && i < 5) {
                          const boxes = document.querySelectorAll(".co-otp-box");
                          boxes[i + 1]?.focus();
                        }
                      }}
                      onKeyDown={e => {
                        if (e.key === "Backspace" && !otp[i] && i > 0) {
                          const boxes = document.querySelectorAll(".co-otp-box");
                          boxes[i - 1]?.focus();
                          const arr = otp.split("");
                          arr[i - 1] = "";
                          setOtp(arr.join(""));
                        }
                      }}
                    />
                  ))}
                </div>

                {otpError && <p className="co-err-msg" style={{ textAlign: "center" }}>{otpError}</p>}

                <div className="co-resend">
                  Didn't receive it?{" "}
                  <button onClick={handleResend} disabled={resendCooldown > 0 || loading}>
                    {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend OTP"}
                  </button>
                </div>
              </>
            )}

            {/* ── STEP 3: Success ── */}
            {step === "success" && orderSummary && (
              <div className="co-success">
                <div className="co-success-icon">🎉</div>
                <h2>Order Placed!</h2>
                <p>
                  Your order has been confirmed, {orderSummary.name}.<br />
                  A confirmation email has been sent to <strong>{orderSummary.email}</strong>.
                </p>
                <div className="co-success-detail">
                  📦 {orderSummary.items.length} item{orderSummary.items.length > 1 ? "s" : ""} · ₹{Number(orderSummary.total).toLocaleString()}<br />
                  📍 {orderSummary.address}<br />
                  📱 {orderSummary.mobile}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="co-footer">
            {step === "details" && (
              <button className="co-primary-btn" onClick={handleSendOtp} disabled={loading}>
                {loading ? <><div className="co-spinner" />Sending OTP…</> : "Continue — Send OTP →"}
              </button>
            )}
            {step === "otp" && (
              <button className="co-primary-btn" onClick={handleVerifyOtp} disabled={loading || otp.length !== 6}>
                {loading ? <><div className="co-spinner" />Verifying…</> : "Verify & Place Order ✓"}
              </button>
            )}
            {step === "success" && (
              <button className="co-primary-btn" style={{ background: "#22c55e" }} onClick={onClose}>
                Done — Continue Shopping 🛍️
              </button>
            )}
          </div>

        </div>
      </div>
    </>
  );
}