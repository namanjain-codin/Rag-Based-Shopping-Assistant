"""
checkout.py  (v2 — Resend HTTP API, works on Render free tier)
---------------------------------------------------------------
Resend uses HTTPS (port 443) — never blocked by any hosting provider.
"""

import os
import random
import string
import time
import json
import urllib.request
import urllib.error
from typing import Dict, Any
from dotenv import load_dotenv

load_dotenv()

OTP_EXPIRY_SECONDS = 600
OTP_LENGTH = 6

_otp_store: Dict[str, Dict[str, Any]] = {}


def _generate_otp() -> str:
    return "".join(random.choices(string.digits, k=OTP_LENGTH))


def _send_email(to: str, subject: str, html: str):
    api_key  = os.getenv("RESEND_API_KEY")
    from_addr = os.getenv("GMAIL_USER", "ShopLens <onboarding@resend.dev>")

    if not api_key:
        raise ValueError("RESEND_API_KEY is not set in environment variables.")

    # Use resend.dev domain if no custom domain verified
    # "From" must be from a verified domain — use onboarding@resend.dev for testing
    sender = "ShopLens <onboarding@resend.dev>"

    payload = json.dumps({
        "from":    sender,
        "to":      [to],
        "subject": subject,
        "html":    html,
    }).encode("utf-8")

    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type":  "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        raise ValueError(f"Resend API error {e.code}: {body}")


# ── Send OTP ──────────────────────────────────────────────────────────────────

def send_otp(email: str, name: str, order_data: dict) -> str:
    otp = _generate_otp()
    _otp_store[email.lower()] = {
        "otp":        otp,
        "expires_at": time.time() + OTP_EXPIRY_SECONDS,
        "order_data": order_data,
        "name":       name,
    }

    html = f"""
    <div style="font-family:-apple-system,sans-serif;max-width:520px;margin:0 auto;background:#0f0f0f;color:#f0f0ef;border-radius:12px;overflow:hidden">
      <div style="background:#7c6ef5;padding:28px 32px">
        <h1 style="margin:0;font-size:22px;font-weight:800">🛒 ShopLens</h1>
        <p style="margin:6px 0 0;opacity:.85;font-size:14px">Complete your purchase</p>
      </div>
      <div style="padding:32px">
        <p style="font-size:16px;margin:0 0 8px">Hi <strong>{name}</strong>,</p>
        <p style="color:#88887f;font-size:14px;margin:0 0 28px">Use the OTP below to verify your email and place your order.</p>
        <div style="background:#1a1a1a;border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:24px;text-align:center;margin-bottom:28px">
          <p style="margin:0 0 8px;font-size:13px;color:#88887f;text-transform:uppercase;letter-spacing:.08em">Your OTP</p>
          <p style="margin:0;font-size:40px;font-weight:800;letter-spacing:10px;color:#a89af8">{otp}</p>
          <p style="margin:12px 0 0;font-size:12px;color:#55554f">Valid for 10 minutes</p>
        </div>
        <p style="font-size:13px;color:#55554f;margin:0">If you didn't request this, ignore this email.</p>
      </div>
    </div>
    """

    _send_email(email, "ShopLens — Your OTP to complete purchase", html)
    return otp


# ── Verify OTP ────────────────────────────────────────────────────────────────

def verify_otp(email: str, otp: str) -> Dict[str, Any]:
    key    = email.lower()
    record = _otp_store.get(key)

    if not record:
        raise ValueError("No OTP found for this email. Please request a new one.")
    if time.time() > record["expires_at"]:
        del _otp_store[key]
        raise ValueError("OTP has expired. Please request a new one.")
    if record["otp"] != otp.strip():
        raise ValueError("Incorrect OTP. Please try again.")

    data = record.copy()
    del _otp_store[key]
    return data


# ── Confirmation email ────────────────────────────────────────────────────────

def send_confirmation(email: str, name: str, mobile: str, address: str, items: list, total: float):
    items_html = "".join(f"""
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #2a2a2a;font-size:14px">{item['name']}</td>
          <td style="padding:10px 0;border-bottom:1px solid #2a2a2a;font-size:14px;text-align:center;color:#88887f">×{item['qty']}</td>
          <td style="padding:10px 0;border-bottom:1px solid #2a2a2a;font-size:14px;text-align:right;font-weight:600">₹{int(item['price'] * item['qty']):,}</td>
        </tr>
    """ for item in items)

    html = f"""
    <div style="font-family:-apple-system,sans-serif;max-width:520px;margin:0 auto;background:#0f0f0f;color:#f0f0ef;border-radius:12px;overflow:hidden">
      <div style="background:#22c55e;padding:28px 32px">
        <h1 style="margin:0;font-size:22px;font-weight:800">🛒 ShopLens</h1>
        <p style="margin:6px 0 0;color:#000;font-size:14px;font-weight:600">✅ Order Confirmed!</p>
      </div>
      <div style="padding:32px">
        <p style="font-size:16px;margin:0 0 6px">Hi <strong>{name}</strong>, your order is placed! 🎉</p>
        <p style="color:#88887f;font-size:14px;margin:0 0 28px">Here's your order summary:</p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
          <thead>
            <tr>
              <th style="text-align:left;font-size:11px;text-transform:uppercase;color:#55554f;padding-bottom:8px;border-bottom:1px solid #2a2a2a">Item</th>
              <th style="text-align:center;font-size:11px;text-transform:uppercase;color:#55554f;padding-bottom:8px;border-bottom:1px solid #2a2a2a">Qty</th>
              <th style="text-align:right;font-size:11px;text-transform:uppercase;color:#55554f;padding-bottom:8px;border-bottom:1px solid #2a2a2a">Price</th>
            </tr>
          </thead>
          <tbody>{items_html}</tbody>
        </table>
        <div style="display:flex;justify-content:space-between;font-size:16px;font-weight:700;margin-bottom:28px">
          <span>Total</span><span style="color:#a89af8">₹{int(total):,}</span>
        </div>
        <div style="background:#1a1a1a;border-radius:10px;padding:18px;margin-bottom:20px;font-size:13px;line-height:1.7;color:#88887f">
          <p style="margin:0 0 4px;font-weight:600;color:#f0f0ef">Delivery details</p>
          <p style="margin:0">{address}</p>
          <p style="margin:4px 0 0">📱 {mobile}</p>
        </div>
        <p style="font-size:13px;color:#55554f;margin:0">Thank you for shopping with ShopLens.</p>
      </div>
    </div>
    """

    _send_email(email, "✅ Order Confirmed — ShopLens", html)