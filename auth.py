"""
auth.py
-------
Supabase Auth integration for ShopLens.
Handles signup, login, logout and session verification
using Supabase's built-in auth REST API.

How it works:
  - Signup/Login call Supabase Auth REST API
  - Supabase returns an access_token (JWT) + refresh_token
  - We store the access_token in an HTTP-only cookie on the response
  - Every protected request sends the cookie → we verify it with Supabase
  - Logout clears the cookie
"""

import os
import json
import urllib.request
import urllib.error
from typing import Optional, Dict, Any
from dotenv import load_dotenv

load_dotenv()

COOKIE_NAME     = "shoplens_session"
COOKIE_MAX_AGE  = 60 * 60 * 24 * 7   # 7 days


def _get_config():
    url     = os.getenv("SUPABASE_URL", "").rstrip("/")
    anon    = os.getenv("SUPABASE_ANON_KEY", "")
    if not url or not anon:
        raise ValueError("SUPABASE_URL and SUPABASE_ANON_KEY must be set.")
    return url, anon


def _supabase_post(path: str, payload: dict, token: Optional[str] = None) -> Dict:
    url, anon = _get_config()
    data = json.dumps(payload).encode("utf-8")
    headers = {
        "Content-Type":  "application/json",
        "apikey":        anon,
        "User-Agent":    "ShopLens/1.0",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    else:
        headers["Authorization"] = f"Bearer {anon}"

    req = urllib.request.Request(
        f"{url}/auth/v1/{path}",
        data=data,
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = json.loads(e.read().decode())
        raise ValueError(body.get("msg") or body.get("message") or body.get("error_description") or "Auth error")


def _supabase_get(path: str, token: str) -> Dict:
    url, anon = _get_config()
    req = urllib.request.Request(
        f"{url}/auth/v1/{path}",
        headers={
            "apikey":        anon,
            "Authorization": f"Bearer {token}",
            "User-Agent":    "ShopLens/1.0",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = json.loads(e.read().decode())
        raise ValueError(body.get("msg") or body.get("message") or "Session expired")


# ── Public auth functions ──────────────────────────────────────────────────────

def signup(email: str, password: str, full_name: str) -> Dict[str, Any]:
    """
    Creates a new user in Supabase Auth.
    Returns user info + access_token.
    """
    result = _supabase_post("signup", {
        "email":    email,
        "password": password,
        "data":     {"full_name": full_name},
    })
    if not result.get("access_token"):
        # Supabase may require email confirmation depending on settings
        # Check Supabase → Auth → Settings → disable "Confirm email" for demo
        raise ValueError("Signup succeeded but no session returned. Check if email confirmation is required in Supabase Auth settings.")
    return {
        "user": {
            "id":        result["user"]["id"],
            "email":     result["user"]["email"],
            "full_name": result["user"].get("user_metadata", {}).get("full_name", ""),
        },
        "access_token":  result["access_token"],
        "refresh_token": result.get("refresh_token", ""),
    }


def login(email: str, password: str) -> Dict[str, Any]:
    """
    Authenticates user with email + password.
    Returns user info + access_token.
    """
    result = _supabase_post("token?grant_type=password", {
        "email":    email,
        "password": password,
    })
    if not result.get("access_token"):
        raise ValueError("Invalid email or password.")
    return {
        "user": {
            "id":        result["user"]["id"],
            "email":     result["user"]["email"],
            "full_name": result["user"].get("user_metadata", {}).get("full_name", ""),
        },
        "access_token":  result["access_token"],
        "refresh_token": result.get("refresh_token", ""),
    }


def get_user_from_token(token: str) -> Dict[str, Any]:
    """
    Verifies JWT token with Supabase and returns user info.
    Raises ValueError if token is invalid or expired.
    """
    result = _supabase_get("user", token)
    return {
        "id":        result["id"],
        "email":     result["email"],
        "full_name": result.get("user_metadata", {}).get("full_name", ""),
    }


def refresh_session(refresh_token: str) -> Dict[str, Any]:
    """Refreshes an expired access token using the refresh token."""
    result = _supabase_post("token?grant_type=refresh_token", {
        "refresh_token": refresh_token,
    })
    if not result.get("access_token"):
        raise ValueError("Session expired. Please log in again.")
    return {
        "access_token":  result["access_token"],
        "refresh_token": result.get("refresh_token", refresh_token),
    }