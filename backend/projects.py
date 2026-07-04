"""
Module: projects.py
Purpose: Project-folder API for DigiSim — persistent, user-scoped workspaces.
         Each folder stores its circuit state (ReactFlow nodes/edges) as a JSON
         blob in SQLite alongside name/description metadata. All routes require
         a full account (require_user): guests share one anonymous token, so
         guest folders could not be scoped safely.
"""

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from flask import Blueprint, Response, g, jsonify, request

from auth import require_user

projects_bp = Blueprint("projects", __name__)

_DB_PATH = Path(__file__).resolve().parent / "data" / "users.db"
_EMPTY_STATE = '{"nodes": [], "edges": []}'
_MAX_STATE_BYTES = 1_000_000
_MAX_NAME_LEN = 120


def _get_db() -> sqlite3.Connection:
    """
    Open the app database, creating the folders schema on first use.

    Returns:
        SQLite connection with the folders table present.
    """
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(_DB_PATH)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS folders ("
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "  user_id INTEGER NOT NULL,"
        "  name TEXT NOT NULL,"
        "  description TEXT NOT NULL DEFAULT '',"
        f"  state TEXT NOT NULL DEFAULT '{_EMPTY_STATE}',"
        "  created_at TEXT NOT NULL,"
        "  updated_at TEXT NOT NULL"
        ")"
    )
    return conn


def _now() -> str:
    """
    Current UTC timestamp in ISO format.

    Returns:
        ISO-8601 timestamp string.
    """
    return datetime.now(timezone.utc).isoformat()


def _folder_json(row: tuple, with_state: bool = False) -> dict:
    """
    Convert a folders row into an API response dict.

    Args:
        row: (id, name, description, created_at, updated_at[, state]) row.
        with_state: Include the parsed circuit state blob.
    Returns:
        JSON-serializable folder representation.
    """
    folder = {
        "id": row[0],
        "name": row[1],
        "description": row[2],
        "created_at": row[3],
        "updated_at": row[4],
    }
    if with_state:
        try:
            folder["state"] = json.loads(row[5])
        except (json.JSONDecodeError, TypeError):
            folder["state"] = {"nodes": [], "edges": []}
    return folder


def _validate_name(payload: dict, required: bool) -> tuple[str | None, str | None]:
    """
    Extract and validate the folder name from a request payload.

    Args:
        payload: Parsed JSON body.
        required: Whether a missing name is an error.
    Returns:
        (name, error) — exactly one is None. name is None with no error when
        the field is absent and not required.
    """
    if "name" not in payload:
        return (None, "A folder name is required") if required else (None, None)
    name = str(payload.get("name", "")).strip()
    if not name:
        return None, "Folder name cannot be empty"
    if len(name) > _MAX_NAME_LEN:
        return None, f"Folder name must be {_MAX_NAME_LEN} characters or fewer"
    return name, None


def _user_id() -> int:
    """
    Database id of the authenticated (non-guest) user.

    Returns:
        Integer user id from the verified JWT claims on flask.g.
    """
    return int(g.user["sub"])


@projects_bp.route("/projects", methods=["GET"])
@require_user
def list_projects() -> tuple:
    """
    List the user's folders (metadata only — no circuit state).

    Returns:
        200 with {"projects": [...]}, newest-updated first.
    """
    conn = _get_db()
    try:
        rows = conn.execute(
            "SELECT id, name, description, created_at, updated_at FROM folders"
            " WHERE user_id = ? ORDER BY updated_at DESC",
            (_user_id(),),
        ).fetchall()
    finally:
        conn.close()
    return jsonify({"projects": [_folder_json(row) for row in rows]}), 200


@projects_bp.route("/projects", methods=["POST"])
@require_user
def create_project() -> tuple:
    """
    Create a folder with an empty circuit state.

    Returns:
        201 with the new folder, 400 on a missing/invalid name.
    """
    payload = request.get_json(silent=True) or {}
    name, error = _validate_name(payload, required=True)
    if error:
        return jsonify({"error": error}), 400
    description = str(payload.get("description", "")).strip()

    now = _now()
    conn = _get_db()
    try:
        cur = conn.execute(
            "INSERT INTO folders (user_id, name, description, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?)",
            (_user_id(), name, description, now, now),
        )
        conn.commit()
        folder_id = cur.lastrowid
    finally:
        conn.close()
    return (
        jsonify(_folder_json((folder_id, name, description, now, now))),
        201,
    )


@projects_bp.route("/projects/<int:folder_id>", methods=["GET"])
@require_user
def get_project(folder_id: int) -> tuple:
    """
    Fetch one folder including its saved circuit state.

    Args:
        folder_id: Folder to fetch.
    Returns:
        200 with the folder + state, 404 when it doesn't exist or belongs to
        another user.
    """
    conn = _get_db()
    try:
        row = conn.execute(
            "SELECT id, name, description, created_at, updated_at, state"
            " FROM folders WHERE id = ? AND user_id = ?",
            (folder_id, _user_id()),
        ).fetchone()
    finally:
        conn.close()
    if row is None:
        return jsonify({"error": "Folder not found"}), 404
    return jsonify(_folder_json(row, with_state=True)), 200


@projects_bp.route("/projects/<int:folder_id>", methods=["PUT"])
@require_user
def update_project(folder_id: int) -> tuple:
    """
    Update a folder's name, description, and/or circuit state (autosave).

    Args:
        folder_id: Folder to update.
    Returns:
        200 with the updated metadata, 400 on invalid fields, 404 when the
        folder doesn't exist or belongs to another user, 413 when the state
        blob exceeds the size cap.
    """
    payload = request.get_json(silent=True) or {}
    name, error = _validate_name(payload, required=False)
    if error:
        return jsonify({"error": error}), 400

    updates: dict[str, str] = {}
    if name is not None:
        updates["name"] = name
    if "description" in payload:
        updates["description"] = str(payload.get("description", "")).strip()
    if "state" in payload:
        state_json = json.dumps(payload["state"])
        if len(state_json.encode()) > _MAX_STATE_BYTES:
            return jsonify({"error": "Circuit state is too large to save"}), 413
        updates["state"] = state_json
    if not updates:
        return jsonify({"error": "Nothing to update"}), 400
    updates["updated_at"] = _now()

    assignments = ", ".join(f"{column} = ?" for column in updates)
    conn = _get_db()
    try:
        cur = conn.execute(
            f"UPDATE folders SET {assignments} WHERE id = ? AND user_id = ?",  # noqa: S608
            (*updates.values(), folder_id, _user_id()),
        )
        conn.commit()
        if cur.rowcount == 0:
            return jsonify({"error": "Folder not found"}), 404
        row = conn.execute(
            "SELECT id, name, description, created_at, updated_at"
            " FROM folders WHERE id = ?",
            (folder_id,),
        ).fetchone()
    finally:
        conn.close()
    return jsonify(_folder_json(row)), 200


@projects_bp.route("/projects/<int:folder_id>", methods=["DELETE"])
@require_user
def delete_project(folder_id: int) -> tuple | Response:
    """
    Delete a folder and its stored circuit state.

    Args:
        folder_id: Folder to delete.
    Returns:
        200 on success, 404 when the folder doesn't exist or belongs to
        another user.
    """
    conn = _get_db()
    try:
        cur = conn.execute(
            "DELETE FROM folders WHERE id = ? AND user_id = ?",
            (folder_id, _user_id()),
        )
        conn.commit()
    finally:
        conn.close()
    if cur.rowcount == 0:
        return jsonify({"error": "Folder not found"}), 404
    return jsonify({"ok": True}), 200
