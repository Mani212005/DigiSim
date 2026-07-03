"""
Module: auth.py
Purpose: JWT session auth for DigiSim — signup/login/logout/me endpoints backed by
         a SQLite user store with bcrypt-hashed passwords. Tokens are issued as
         httpOnly cookies (never exposed to JS) and verified by the require_auth
         decorator that protects the detection endpoints.
"""

import os
import sqlite3
from datetime import datetime, timedelta, timezone
from functools import wraps
from pathlib import Path
from typing import Callable

import bcrypt
import jwt
from flask import Blueprint, g, jsonify, make_response, request

auth_bp = Blueprint("auth", __name__)

_DB_PATH = Path(__file__).resolve().parent / "data" / "users.db"
_JWT_SECRET = os.getenv("JWT_SECRET_KEY", "digisim-dev-secret-change-me")
_JWT_ALGO = "HS256"
_TOKEN_TTL = timedelta(days=7)
_COOKIE_NAME = "digisim_token"


def _get_db() -> sqlite3.Connection:
    """
    Open the user database, creating the schema on first use.

    Returns:
        SQLite connection with the users table present.
    """
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(_DB_PATH)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS users ("
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "  email TEXT UNIQUE NOT NULL,"
        "  password_hash BLOB NOT NULL,"
        "  created_at TEXT NOT NULL"
        ")"
    )
    return conn


def _issue_token(user_id: int, email: str) -> str:
    """
    Create a signed JWT for a user.

    Args:
        user_id: Database id of the user.
        email: User email embedded as a convenience claim.
    Returns:
        Encoded JWT string.
    """
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {"sub": str(user_id), "email": email, "iat": now, "exp": now + _TOKEN_TTL},
        _JWT_SECRET,
        algorithm=_JWT_ALGO,
    )


def _auth_response(user_id: int, email: str, status: int = 200):
    """
    Build a JSON response carrying the auth cookie.

    Args:
        user_id: Database id of the user.
        email: User email echoed in the body.
        status: HTTP status code.
    Returns:
        Flask response with the httpOnly session cookie set.
    """
    resp = make_response(jsonify({"user": {"id": user_id, "email": email}}), status)
    resp.set_cookie(
        _COOKIE_NAME,
        _issue_token(user_id, email),
        max_age=int(_TOKEN_TTL.total_seconds()),
        httponly=True,
        samesite="Lax",
        secure=os.getenv("COOKIE_SECURE", "0") == "1",
    )
    return resp


def require_auth(fn: Callable) -> Callable:
    """
    Decorator that rejects requests without a valid session cookie.

    Args:
        fn: Flask view function to protect.
    Returns:
        Wrapped view that returns 401 for missing/invalid tokens and stores
        the decoded claims on flask.g.user.
    """

    @wraps(fn)
    def wrapper(*args: object, **kwargs: object):
        """Validate the JWT cookie before invoking the protected view."""
        token = request.cookies.get(_COOKIE_NAME)
        if not token:
            return jsonify({"error": "Authentication required"}), 401
        try:
            g.user = jwt.decode(token, _JWT_SECRET, algorithms=[_JWT_ALGO])
        except jwt.InvalidTokenError:
            return jsonify({"error": "Invalid or expired session"}), 401
        return fn(*args, **kwargs)

    return wrapper


def _validate_credentials(payload: dict | None) -> tuple[str, str] | None:
    """
    Extract and sanity-check email/password from a request payload.

    Args:
        payload: Parsed JSON body.
    Returns:
        (email, password) when valid, otherwise None.
    """
    if not payload:
        return None
    email = str(payload.get("email", "")).strip().lower()
    password = str(payload.get("password", ""))
    if "@" not in email or len(email) > 254 or len(password) < 6:
        return None
    return email, password


@auth_bp.route("/auth/signup", methods=["POST"])
def signup() -> tuple:
    """
    Create an account and start a session.

    Returns:
        201 with user JSON + session cookie, 400 on bad input,
        409 when the email is already registered.
    """
    creds = _validate_credentials(request.get_json(silent=True))
    if creds is None:
        return (
            jsonify({"error": "Valid email and a password of 6+ characters required"}),
            400,
        )
    email, password = creds
    pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt())

    conn = _get_db()
    try:
        cur = conn.execute(
            "INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)",
            (email, pw_hash, datetime.now(timezone.utc).isoformat()),
        )
        conn.commit()
        return _auth_response(cur.lastrowid, email, 201)
    except sqlite3.IntegrityError:
        return jsonify({"error": "An account with this email already exists"}), 409
    finally:
        conn.close()


@auth_bp.route("/auth/login", methods=["POST"])
def login() -> tuple:
    """
    Verify credentials and start a session.

    Returns:
        200 with user JSON + session cookie, 401 on bad credentials.
    """
    creds = _validate_credentials(request.get_json(silent=True))
    if creds is None:
        return jsonify({"error": "Email and password required"}), 401
    email, password = creds

    conn = _get_db()
    try:
        row = conn.execute(
            "SELECT id, password_hash FROM users WHERE email = ?", (email,)
        ).fetchone()
    finally:
        conn.close()

    if row is None or not bcrypt.checkpw(password.encode(), row[1]):
        return jsonify({"error": "Incorrect email or password"}), 401
    return _auth_response(row[0], email)


@auth_bp.route("/auth/logout", methods=["POST"])
def logout() -> tuple:
    """
    End the session by clearing the auth cookie.

    Returns:
        200 with a confirmation body.
    """
    resp = make_response(jsonify({"ok": True}))
    resp.delete_cookie(_COOKIE_NAME)
    return resp, 200


@auth_bp.route("/auth/me", methods=["GET"])
@require_auth
def me() -> tuple:
    """
    Return the authenticated user for session restoration on page load.

    Returns:
        200 with user claims from the verified token.
    """
    return (
        jsonify({"user": {"id": int(g.user["sub"]), "email": g.user["email"]}}),
        200,
    )
