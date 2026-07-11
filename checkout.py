"""
checkout.py
-----------
Handles OTP generation, email delivery via Gmail SMTP,
and order confirmation. OTPs stored in-memory with expiry.

"""

import os
import random
import string
import smtplib
import time
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Dict, Any
from dotenv import load_dotenv

load_dotenv()

OTP_EXPIRY_SECONDS = 600  # 10 minutes
OTP_LENGTH = 6

# In-memory OTP store: email → {otp, expires_at, order_data}
_otp_store: Dict[str, Dict[str, Any]] = {}


def _generate_otp() -> str:
    return "".join(random.choices(string.digits, k=OTP_LENGTH))


def _get_gmail_conn():
    user     = os.getenv("GMAIL_USER")
    app_pass = os.getenv("GMAIL_APP_PASS")
    if not user or not app_pass:
        raise ValueError("GMAIL_USER and GMAIL_APP_PASS must be set.")
    server = smtplib.SMTP("smtp.gmail.com", 587)
    server.ehlo()
    server.starttls()
    server.ehlo()
    server.login(user, app_pass)
    return server, user


# ── Send OTP email ─────────────────────────────────────────────────────────────

def send_otp(email: str, name: str, order_data: dict) -> str:
    """
    Generates OTP, stores it with order data, sends OTP email.
    Returns the OTP (for logging only — never send to frontend).
    """
    otp = _generate_otp()
    _otp_store[email.lower()] = {
        "otp":        otp,
        "expires_at": time.time() + OTP_EXPIRY_SECONDS,
        "order_data": order_data,
        "name":       name,
    }

    subject = "ShopLens — Your OTP to complete purchase"
    html = f"""
    <div style="font-family:-apple-system,sans-serif;max-width:520px;margin:0 auto;background:#0f0f0f;color:#f0f0ef;border-radius:12px;overflow:hidden">
      <div style="background:#7c6ef5;padding:28px 32px">
        <h1 style="margin:0;font-size:22px;font-weight:800;letter-spacing:-0.5px">🛒 ShopLens</h1>
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
        <p style="font-size:13px;color:#55554f;margin:0">If you didn't request this, ignore this email. Your account is safe.</p>
      </div>
    </div>
    """

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = os.getenv("GMAIL_USER")
    msg["To"]      = email
    msg.attach(MIMEText(html, "html"))

    server, sender = _get_gmail_conn()
    try:
        server.sendmail(sender, email, msg.as_string())
    finally:
        server.quit()

    return otp


# ── Verify OTP ─────────────────────────────────────────────────────────────────

def verify_otp(email: str, otp: str) -> Dict[str, Any]:
    """
    Verifies OTP. Returns order_data if valid.
    Raises ValueError with reason if invalid/expired.
    """
    key = email.lower()
    record = _otp_store.get(key)

    if not record:
        raise ValueError("No OTP found for this email. Please request a new one.")
    if time.time() > record["expires_at"]:
        del _otp_store[key]
        raise ValueError("OTP has expired. Please request a new one.")
    if record["otp"] != otp.strip():
        raise ValueError("Incorrect OTP. Please try again.")

    # Valid — remove from store (single use)
    data = record.copy()
    del _otp_store[key]
    return data


# ── Confirmation email ─────────────────────────────────────────────────────────

def send_confirmation(email: str, name: str, mobile: str, address: str, items: list, total: float):
    """Sends order confirmation email after successful OTP verification."""

    items_html = "".join(f"""
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #2a2a2a;font-size:14px">{item['name']}</td>
          <td style="padding:10px 0;border-bottom:1px solid #2a2a2a;font-size:14px;text-align:center;color:#88887f">×{item['qty']}</td>
          <td style="padding:10px 0;border-bottom:1px solid #2a2a2a;font-size:14px;text-align:right;font-weight:600">₹{int(item['price'] * item['qty']):,}</td>
        </tr>
    """ for item in items)

    subject = f"✅ Order Confirmed — ShopLens"
    html = f"""
    <div style="font-family:-apple-system,sans-serif;max-width:520px;margin:0 auto;background:#0f0f0f;color:#f0f0ef;border-radius:12px;overflow:hidden">
      <div style="background:#22c55e;padding:28px 32px">
        <h1 style="margin:0;font-size:22px;font-weight:800;letter-spacing:-0.5px">🛒 ShopLens</h1>
        <p style="margin:6px 0 0;color:#000;font-size:14px;font-weight:600">✅ Order Confirmed!</p>
      </div>
      <div style="padding:32px">
        <p style="font-size:16px;margin:0 0 6px">Hi <strong>{name}</strong>, your order is placed! 🎉</p>
        <p style="color:#88887f;font-size:14px;margin:0 0 28px">Here's your order summary:</p>

        <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
          <thead>
            <tr>
              <th style="text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#55554f;padding-bottom:8px;border-bottom:1px solid #2a2a2a">Item</th>
              <th style="text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#55554f;padding-bottom:8px;border-bottom:1px solid #2a2a2a">Qty</th>
              <th style="text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#55554f;padding-bottom:8px;border-bottom:1px solid #2a2a2a">Price</th>
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

        <p style="font-size:13px;color:#55554f;margin:0">Thank you for shopping with ShopLens. Your items will be delivered soon.</p>
      </div>
    </div>
    """

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = os.getenv("GMAIL_USER")
    msg["To"]      = email
    msg.attach(MIMEText(html, "html"))

    server, sender = _get_gmail_conn()
    try:
        server.sendmail(sender, email, msg.as_string())
    finally:
        server.quit()