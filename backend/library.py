"""
Module: library.py
Purpose: Component library + project inventory API for open-set recognition.
         The shared global library stores component identities (names, aliases,
         pin maps, sim models) and quality-checked reference images with visual
         embeddings; per-project inventories bind a folder's parts list to
         library entries. Enrollment replaces training: a reference image is
         embedded once (pipeline_v2) and immediately usable for retrieval.
"""

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from flask import Blueprint, Response, g, jsonify, request, send_file
from rapidfuzz import fuzz

from auth import require_auth, require_user
from pipeline_v2.embedder import cosine_similarity, get_embedder
from pipeline_v2.enrollment import enroll_image
from pipeline_v2.matcher import MatchTarget

library_bp = Blueprint("library", __name__)

_DATA_DIR = Path(__file__).resolve().parent / "data"
_DB_PATH = _DATA_DIR / "users.db"
_UPLOADS_DIR = _DATA_DIR / "uploads" / "library"
_SEED_PATH = _DATA_DIR / "seed_components.json"

_DUPLICATE_SIMILARITY = 0.985
_SEARCH_MIN_SCORE = 45.0
_SEARCH_LIMIT = 20
_MAX_NAME_LEN = 120


def _now() -> str:
    """
    Current UTC timestamp in ISO format.

    Returns:
        ISO-8601 timestamp string.
    """
    return datetime.now(timezone.utc).isoformat()


def _get_db() -> sqlite3.Connection:
    """
    Open the app database, creating the library schema and seeding the catalog
    on first use.

    Returns:
        SQLite connection with library_components, component_images, and
        project_inventory tables present.
    """
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(_DB_PATH)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS library_components ("
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "  canonical_name TEXT NOT NULL,"
        "  aliases TEXT NOT NULL DEFAULT '[]',"
        "  category TEXT NOT NULL DEFAULT 'other',"
        "  package TEXT NOT NULL DEFAULT '',"
        "  pin_map TEXT NOT NULL DEFAULT '{\"pins\": []}',"
        "  sim_model TEXT NOT NULL DEFAULT '{}',"
        "  source TEXT NOT NULL DEFAULT 'community',"
        "  verified INTEGER NOT NULL DEFAULT 0,"
        "  created_by INTEGER,"
        "  created_at TEXT NOT NULL"
        ")"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS component_images ("
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "  library_component_id INTEGER NOT NULL,"
        "  path TEXT NOT NULL,"
        "  domain TEXT NOT NULL DEFAULT 'photo',"
        "  embedding BLOB,"
        "  quality TEXT NOT NULL DEFAULT '{}',"
        "  uploaded_by INTEGER,"
        "  consent_shared INTEGER NOT NULL DEFAULT 1,"
        "  status TEXT NOT NULL DEFAULT 'active',"
        "  created_at TEXT NOT NULL"
        ")"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS project_inventory ("
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "  folder_id INTEGER NOT NULL,"
        "  designator TEXT NOT NULL DEFAULT '',"
        "  name_raw TEXT NOT NULL,"
        "  qty INTEGER NOT NULL DEFAULT 1,"
        "  value TEXT NOT NULL DEFAULT '',"
        "  library_component_id INTEGER,"
        "  created_at TEXT NOT NULL"
        ")"
    )
    _seed_catalog(conn)
    return conn


def _seed_catalog(conn: sqlite3.Connection) -> None:
    """
    Load the curated seed catalog into an empty library table.

    Args:
        conn: Open database connection (commits when seeding happens).
    """
    (count,) = conn.execute("SELECT COUNT(*) FROM library_components").fetchone()
    if count > 0 or not _SEED_PATH.exists():
        return
    try:
        seed = json.loads(_SEED_PATH.read_text())
    except (json.JSONDecodeError, OSError):
        return
    now = _now()
    for entry in seed.get("components", []):
        conn.execute(
            "INSERT INTO library_components (canonical_name, aliases, category,"
            " package, pin_map, sim_model, source, verified, created_by, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?, 'seed', 1, NULL, ?)",
            (
                entry["canonical_name"],
                json.dumps(entry.get("aliases", [])),
                entry.get("category", "other"),
                entry.get("package", ""),
                json.dumps(entry.get("pin_map", {"pins": []})),
                json.dumps(entry.get("sim_model", {})),
                now,
            ),
        )
    conn.commit()


def _component_json(row: tuple, image_count: int | None = None) -> dict:
    """
    Convert a library_components row into an API response dict.

    Args:
        row: (id, canonical_name, aliases, category, package, pin_map,
             sim_model, source, verified) row.
        image_count: Optional active-image count to include.
    Returns:
        JSON-serializable component representation.
    """
    component = {
        "id": row[0],
        "canonical_name": row[1],
        "aliases": json.loads(row[2]),
        "category": row[3],
        "package": row[4],
        "pin_map": json.loads(row[5]),
        "sim_model": json.loads(row[6]),
        "source": row[7],
        "verified": bool(row[8]),
    }
    if image_count is not None:
        component["image_count"] = image_count
    return component


_COMPONENT_COLS = (
    "id, canonical_name, aliases, category, package, pin_map, sim_model,"
    " source, verified"
)


def _user_id() -> int:
    """
    Database id of the authenticated (non-guest) user.

    Returns:
        Integer user id from the verified JWT claims on flask.g.
    """
    return int(g.user["sub"])


def _own_folder(conn: sqlite3.Connection, folder_id: int) -> bool:
    """
    Check that a folder exists and belongs to the current user.

    Args:
        conn: Open database connection.
        folder_id: Folder to check.
    Returns:
        True when the folder is owned by the requesting user.
    """
    row = conn.execute(
        "SELECT 1 FROM folders WHERE id = ? AND user_id = ?",
        (folder_id, _user_id()),
    ).fetchone()
    return row is not None


# ---------------------------------------------------------------------------
# Library: components
# ---------------------------------------------------------------------------


@library_bp.route("/library/components", methods=["GET"])
@require_auth
def list_components() -> tuple:
    """
    List library components (optionally filtered by category) with image counts.

    Returns:
        200 with {"components": [...]}, verified/seed entries first.
    """
    category = request.args.get("category")
    where = "WHERE category = ?" if category else ""
    params: tuple = (category,) if category else ()
    conn = _get_db()
    try:
        rows = conn.execute(
            f"SELECT {_COMPONENT_COLS},"  # noqa: S608 — where is a fixed literal
            " (SELECT COUNT(*) FROM component_images ci"
            "   WHERE ci.library_component_id = library_components.id"
            "   AND ci.status = 'active') AS image_count"
            f" FROM library_components {where}"
            " ORDER BY verified DESC, canonical_name",
            params,
        ).fetchall()
    finally:
        conn.close()
    return (
        jsonify({"components": [_component_json(r[:9], r[9]) for r in rows]}),
        200,
    )


@library_bp.route("/library/search", methods=["GET"])
@require_auth
def search_components() -> tuple:
    """
    Fuzzy-search components by name and aliases (rapidfuzz token matching).

    Returns:
        200 with {"results": [{...component, score}]}, best matches first;
        400 when the q parameter is missing.
    """
    query = request.args.get("q", "").strip().lower()
    if not query:
        return jsonify({"error": "Query parameter 'q' is required"}), 400

    conn = _get_db()
    try:
        rows = conn.execute(
            f"SELECT {_COMPONENT_COLS},"
            " (SELECT COUNT(*) FROM component_images ci"
            "   WHERE ci.library_component_id = library_components.id"
            "   AND ci.status = 'active') AS image_count"
            " FROM library_components"
        ).fetchall()
    finally:
        conn.close()

    scored: list[tuple[float, tuple]] = []
    for row in rows:
        candidates = [row[1], *json.loads(row[2])]
        score = max(fuzz.token_set_ratio(query, c.lower()) for c in candidates)
        if score >= _SEARCH_MIN_SCORE:
            scored.append((score, row))
    scored.sort(key=lambda pair: (-pair[0], pair[1][1]))

    results = [
        {**_component_json(row[:9], row[9]), "score": round(score, 1)}
        for score, row in scored[:_SEARCH_LIMIT]
    ]
    return jsonify({"results": results}), 200


@library_bp.route("/library/components/<int:component_id>", methods=["GET"])
@require_auth
def get_component(component_id: int) -> tuple:
    """
    Fetch one component with its active reference-image metadata.

    Args:
        component_id: Library component to fetch.
    Returns:
        200 with the component + images list, 404 when it doesn't exist.
    """
    conn = _get_db()
    try:
        row = conn.execute(
            f"SELECT {_COMPONENT_COLS} FROM library_components WHERE id = ?",
            (component_id,),
        ).fetchone()
        if row is None:
            return jsonify({"error": "Component not found"}), 404
        image_rows = conn.execute(
            "SELECT id, domain, quality, consent_shared, created_at"
            " FROM component_images"
            " WHERE library_component_id = ? AND status = 'active'"
            " ORDER BY created_at DESC",
            (component_id,),
        ).fetchall()
    finally:
        conn.close()

    component = _component_json(row, len(image_rows))
    component["images"] = [
        {
            "id": r[0],
            "domain": r[1],
            "quality": json.loads(r[2]),
            "consent_shared": bool(r[3]),
            "created_at": r[4],
        }
        for r in image_rows
    ]
    return jsonify(component), 200


@library_bp.route("/library/components", methods=["POST"])
@require_user
def create_component() -> tuple:
    """
    Create a community library component (unverified until curated).

    Returns:
        201 with the new component, 400 on a missing/invalid name.
    """
    payload = request.get_json(silent=True) or {}
    name = str(payload.get("canonical_name", "")).strip()
    if not name or len(name) > _MAX_NAME_LEN:
        return (
            jsonify({"error": f"canonical_name is required (≤ {_MAX_NAME_LEN} chars)"}),
            400,
        )
    aliases = payload.get("aliases", [])
    if not isinstance(aliases, list) or not all(isinstance(a, str) for a in aliases):
        return jsonify({"error": "aliases must be an array of strings"}), 400
    pin_map = payload.get("pin_map", {"pins": []})
    if not isinstance(pin_map, dict):
        return jsonify({"error": "pin_map must be an object"}), 400

    conn = _get_db()
    try:
        cur = conn.execute(
            "INSERT INTO library_components (canonical_name, aliases, category,"
            " package, pin_map, sim_model, source, verified, created_by, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?, 'community', 0, ?, ?)",
            (
                name,
                json.dumps(aliases),
                str(payload.get("category", "other")),
                str(payload.get("package", "")),
                json.dumps(pin_map),
                json.dumps(payload.get("sim_model", {})),
                _user_id(),
                _now(),
            ),
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {_COMPONENT_COLS} FROM library_components WHERE id = ?",
            (cur.lastrowid,),
        ).fetchone()
    finally:
        conn.close()
    return jsonify(_component_json(row, 0)), 201


# ---------------------------------------------------------------------------
# Library: reference images (enrollment)
# ---------------------------------------------------------------------------


@library_bp.route("/library/components/<int:component_id>/images", methods=["POST"])
@require_user
def upload_component_image(component_id: int) -> tuple:
    """
    Enroll a reference image: quality-check, store, embed, and dedup-warn.

    Multipart body: 'image' file; optional form fields 'consent_shared'
    ("0"/"1", default 1) and 'domain' ('photo'|'symbol', default 'photo').

    Args:
        component_id: Library component the image belongs to.
    Returns:
        201 with {image, quality, warnings}; 400 on invalid input;
        404 when the component doesn't exist.
    """
    if "image" not in request.files:
        return jsonify({"error": "No image provided"}), 400
    domain = request.form.get("domain", "photo")
    if domain not in ("photo", "symbol"):
        return jsonify({"error": "domain must be 'photo' or 'symbol'"}), 400
    consent = request.form.get("consent_shared", "1") == "1"

    conn = _get_db()
    try:
        exists = conn.execute(
            "SELECT 1 FROM library_components WHERE id = ?", (component_id,)
        ).fetchone()
        if exists is None:
            return jsonify({"error": "Component not found"}), 404

        try:
            stored = enroll_image(
                request.files["image"].read(), _UPLOADS_DIR / str(component_id)
            )
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400

        warnings = list(stored.quality["warnings"])
        embedding_blob: bytes | None = None
        embedder = get_embedder()
        if embedder is None:
            warnings.append("embedding_unavailable")
        else:
            vector = embedder.embed_path(stored.path)
            embedding_blob = vector.tobytes()
            # Near-duplicate check against this component's existing gallery.
            existing = conn.execute(
                "SELECT id, embedding FROM component_images"
                " WHERE library_component_id = ? AND status = 'active'"
                " AND embedding IS NOT NULL",
                (component_id,),
            ).fetchall()
            for image_id, blob in existing:
                other = np.frombuffer(blob, dtype=np.float32)
                if cosine_similarity(vector, other) >= _DUPLICATE_SIMILARITY:
                    warnings.append(f"near_duplicate_of_{image_id}")
                    break

        quality = {**stored.quality, "warnings": warnings}
        cur = conn.execute(
            "INSERT INTO component_images (library_component_id, path, domain,"
            " embedding, quality, uploaded_by, consent_shared, status, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)",
            (
                component_id,
                str(stored.path.relative_to(_UPLOADS_DIR)),
                domain,
                embedding_blob,
                json.dumps(quality),
                _user_id(),
                int(consent),
                _now(),
            ),
        )
        conn.commit()
        image_id = cur.lastrowid
    finally:
        conn.close()

    return (
        jsonify(
            {
                "image": {
                    "id": image_id,
                    "domain": domain,
                    "quality": quality,
                    "consent_shared": consent,
                },
                "warnings": warnings,
            }
        ),
        201,
    )


@library_bp.route("/library/images/<int:image_id>", methods=["GET"])
@require_auth
def get_component_image(image_id: int) -> Response | tuple:
    """
    Stream a stored reference image.

    Args:
        image_id: Image row id.
    Returns:
        The JPEG file, or 404 when missing/inactive.
    """
    conn = _get_db()
    try:
        row = conn.execute(
            "SELECT path FROM component_images WHERE id = ? AND status = 'active'",
            (image_id,),
        ).fetchone()
    finally:
        conn.close()
    if row is None:
        return jsonify({"error": "Image not found"}), 404
    path = (_UPLOADS_DIR / row[0]).resolve()
    if not path.is_relative_to(_UPLOADS_DIR.resolve()) or not path.exists():
        return jsonify({"error": "Image not found"}), 404
    return send_file(path, mimetype="image/jpeg", conditional=True)


# ---------------------------------------------------------------------------
# Match-target builders (consumed by the /detect_v2 recognition pipeline)
# ---------------------------------------------------------------------------


def _component_gallery(conn: sqlite3.Connection, component_id: int) -> list[np.ndarray]:
    """
    Load a component's active reference-image embeddings.

    Args:
        conn: Open database connection.
        component_id: Library component to load.
    Returns:
        L2-normalised float32 vectors (possibly empty).
    """
    rows = conn.execute(
        "SELECT embedding FROM component_images"
        " WHERE library_component_id = ? AND status = 'active'"
        " AND embedding IS NOT NULL",
        (component_id,),
    ).fetchall()
    return [np.frombuffer(blob, dtype=np.float32) for (blob,) in rows]


def load_inventory_targets(folder_id: int, user_id: int) -> list["MatchTarget"]:
    """
    Build match targets from a project's inventory, expanded by quantity.

    Args:
        folder_id: Project folder whose inventory to load.
        user_id: Owner — folders belonging to other users yield no targets.
    Returns:
        One MatchTarget per inventory slot (a qty-3 row yields 3 slots); rows
        bound to a library component carry its embedding gallery and aliases,
        unbound rows are OCR-only targets.
    """
    from pipeline_v2.matcher import MatchTarget

    conn = _get_db()
    try:
        owner = conn.execute(
            "SELECT 1 FROM folders WHERE id = ? AND user_id = ?",
            (folder_id, user_id),
        ).fetchone()
        if owner is None:
            return []
        rows = conn.execute(
            "SELECT id, designator, name_raw, qty, library_component_id"
            " FROM project_inventory WHERE folder_id = ? ORDER BY id",
            (folder_id,),
        ).fetchall()

        targets: list[MatchTarget] = []
        for item_id, designator, name_raw, qty, component_id in rows:
            names = [name_raw]
            embeddings: list[np.ndarray] = []
            label = name_raw
            if component_id is not None:
                comp = conn.execute(
                    "SELECT canonical_name, aliases FROM library_components"
                    " WHERE id = ?",
                    (component_id,),
                ).fetchone()
                if comp is not None:
                    label = comp[0]
                    names = [name_raw, comp[0], *json.loads(comp[1])]
                embeddings = _component_gallery(conn, component_id)
            display = f"{designator} · {label}" if designator else label
            for slot in range(max(1, int(qty))):
                targets.append(
                    MatchTarget(
                        target_id=f"inv{item_id}#{slot}",
                        label=display,
                        component_id=component_id,
                        names=names,
                        embeddings=embeddings,
                        inventory_item_id=item_id,
                    )
                )
        return targets
    finally:
        conn.close()


def load_global_targets() -> list["MatchTarget"]:
    """
    Build match targets from the whole shared library (one slot per component).

    Used when no project inventory is available (e.g. guests): quantities are
    unknown, so each component can be matched at most once per image.

    Returns:
        One MatchTarget per library component.
    """
    from pipeline_v2.matcher import MatchTarget

    conn = _get_db()
    try:
        rows = conn.execute(
            "SELECT id, canonical_name, aliases FROM library_components"
        ).fetchall()
        targets: list[MatchTarget] = []
        for component_id, name, aliases in rows:
            targets.append(
                MatchTarget(
                    target_id=f"lib{component_id}",
                    label=name,
                    component_id=component_id,
                    names=[name, *json.loads(aliases)],
                    embeddings=_component_gallery(conn, component_id),
                    inventory_item_id=None,
                )
            )
        return targets
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Project inventory
# ---------------------------------------------------------------------------

_INVENTORY_COLS = (
    "id, folder_id, designator, name_raw, qty, value, library_component_id"
)


def _inventory_json(row: tuple) -> dict:
    """
    Convert a project_inventory row into an API response dict.

    Args:
        row: (id, folder_id, designator, name_raw, qty, value,
             library_component_id) row.
    Returns:
        JSON-serializable inventory item.
    """
    return {
        "id": row[0],
        "folder_id": row[1],
        "designator": row[2],
        "name_raw": row[3],
        "qty": row[4],
        "value": row[5],
        "library_component_id": row[6],
    }


def _validate_item(payload: dict) -> tuple[dict | None, str | None]:
    """
    Validate one inventory item payload.

    Args:
        payload: {designator?, name, qty?, value?, library_component_id?}.
    Returns:
        (clean_item, error) — exactly one is None.
    """
    name = str(payload.get("name", "")).strip()
    if not name or len(name) > _MAX_NAME_LEN:
        return None, f"Each item needs a name (≤ {_MAX_NAME_LEN} chars)"
    try:
        qty = int(payload.get("qty", 1))
    except (TypeError, ValueError):
        return None, "qty must be an integer"
    if not 1 <= qty <= 999:
        return None, "qty must be between 1 and 999"
    lib_id = payload.get("library_component_id")
    if lib_id is not None and not isinstance(lib_id, int):
        return None, "library_component_id must be an integer or null"
    return (
        {
            "designator": str(payload.get("designator", "")).strip()[:24],
            "name": name,
            "qty": qty,
            "value": str(payload.get("value", "")).strip()[:64],
            "library_component_id": lib_id,
        },
        None,
    )


@library_bp.route("/projects/<int:folder_id>/inventory", methods=["GET"])
@require_user
def list_inventory(folder_id: int) -> tuple:
    """
    List a folder's inventory items.

    Args:
        folder_id: Project folder.
    Returns:
        200 with {"items": [...]}, 404 for folders the user doesn't own.
    """
    conn = _get_db()
    try:
        if not _own_folder(conn, folder_id):
            return jsonify({"error": "Folder not found"}), 404
        rows = conn.execute(
            f"SELECT {_INVENTORY_COLS} FROM project_inventory"
            " WHERE folder_id = ? ORDER BY id",
            (folder_id,),
        ).fetchall()
    finally:
        conn.close()
    return jsonify({"items": [_inventory_json(r) for r in rows]}), 200


@library_bp.route("/projects/<int:folder_id>/inventory", methods=["POST"])
@require_user
def add_inventory(folder_id: int) -> tuple:
    """
    Add inventory items — a single item object or {"items": [...]} bulk body
    (bulk is what the netlist import step sends).

    Args:
        folder_id: Project folder.
    Returns:
        201 with the created items, 400 on invalid input, 404 for folders the
        user doesn't own.
    """
    payload = request.get_json(silent=True) or {}
    raw_items = payload.get("items", [payload])
    if not isinstance(raw_items, list) or not raw_items:
        return jsonify({"error": "Provide an item or a non-empty items array"}), 400

    cleaned: list[dict] = []
    for raw in raw_items:
        item, error = _validate_item(raw if isinstance(raw, dict) else {})
        if error:
            return jsonify({"error": error}), 400
        cleaned.append(item)

    now = _now()
    conn = _get_db()
    try:
        if not _own_folder(conn, folder_id):
            return jsonify({"error": "Folder not found"}), 404
        created: list[dict] = []
        for item in cleaned:
            cur = conn.execute(
                "INSERT INTO project_inventory (folder_id, designator, name_raw,"
                " qty, value, library_component_id, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    folder_id,
                    item["designator"],
                    item["name"],
                    item["qty"],
                    item["value"],
                    item["library_component_id"],
                    now,
                ),
            )
            created.append(
                _inventory_json(
                    (
                        cur.lastrowid,
                        folder_id,
                        item["designator"],
                        item["name"],
                        item["qty"],
                        item["value"],
                        item["library_component_id"],
                    )
                )
            )
        conn.commit()
    finally:
        conn.close()
    return jsonify({"items": created}), 201


@library_bp.route("/projects/<int:folder_id>/inventory/<int:item_id>", methods=["PUT"])
@require_user
def update_inventory(folder_id: int, item_id: int) -> tuple:
    """
    Update one inventory item.

    Args:
        folder_id: Project folder.
        item_id: Inventory row to update.
    Returns:
        200 with the updated item, 400 on invalid input, 404 when the folder or
        item isn't the user's.
    """
    payload = request.get_json(silent=True) or {}
    conn = _get_db()
    try:
        if not _own_folder(conn, folder_id):
            return jsonify({"error": "Folder not found"}), 404
        row = conn.execute(
            f"SELECT {_INVENTORY_COLS} FROM project_inventory"
            " WHERE id = ? AND folder_id = ?",
            (item_id, folder_id),
        ).fetchone()
        if row is None:
            return jsonify({"error": "Inventory item not found"}), 404

        merged = {
            "designator": payload.get("designator", row[2]),
            "name": payload.get("name", row[3]),
            "qty": payload.get("qty", row[4]),
            "value": payload.get("value", row[5]),
            "library_component_id": payload.get("library_component_id", row[6]),
        }
        item, error = _validate_item(merged)
        if error:
            return jsonify({"error": error}), 400
        conn.execute(
            "UPDATE project_inventory SET designator = ?, name_raw = ?, qty = ?,"
            " value = ?, library_component_id = ? WHERE id = ?",
            (
                item["designator"],
                item["name"],
                item["qty"],
                item["value"],
                item["library_component_id"],
                item_id,
            ),
        )
        conn.commit()
    finally:
        conn.close()
    return (
        jsonify(
            _inventory_json(
                (
                    item_id,
                    folder_id,
                    item["designator"],
                    item["name"],
                    item["qty"],
                    item["value"],
                    item["library_component_id"],
                )
            )
        ),
        200,
    )


@library_bp.route(
    "/projects/<int:folder_id>/inventory/<int:item_id>", methods=["DELETE"]
)
@require_user
def delete_inventory(folder_id: int, item_id: int) -> tuple:
    """
    Delete one inventory item.

    Args:
        folder_id: Project folder.
        item_id: Inventory row to delete.
    Returns:
        200 on success, 404 when the folder or item isn't the user's.
    """
    conn = _get_db()
    try:
        if not _own_folder(conn, folder_id):
            return jsonify({"error": "Folder not found"}), 404
        cur = conn.execute(
            "DELETE FROM project_inventory WHERE id = ? AND folder_id = ?",
            (item_id, folder_id),
        )
        conn.commit()
    finally:
        conn.close()
    if cur.rowcount == 0:
        return jsonify({"error": "Inventory item not found"}), 404
    return jsonify({"ok": True}), 200
