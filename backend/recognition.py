"""
Module: recognition.py
Purpose: /detect_v2 — open-set component recognition over physical-build
         photos. Routes schematics back to the classic gate pipeline, then:
         YOLOE/contour proposals → DINOv2 crop embeddings → OCR → inventory-
         constrained Hungarian matching (library.py builds the targets).
         Every proposal returns with its crop thumbnail, top candidates, and
         review flags — ambiguous results are never placed silently.
"""

import base64
import tempfile
from pathlib import Path

import cv2
import numpy as np
from flask import Blueprint, g, jsonify, request

from auth import require_auth
from library import load_global_targets, load_inventory_targets
from pipeline_v2.domain_router import classify_image
from pipeline_v2.embedder import get_embedder
from pipeline_v2.matcher import CandidateScore, match_proposals
from pipeline_v2.ocr_reader import read_text
from pipeline_v2.proposer import Proposal, get_proposer

recognition_bp = Blueprint("recognition", __name__)

_MAX_PROPOSALS = 24
_THUMB_SIZE = 160
# OCR runs on the most confident, large-enough crops only (it's ~0.5s each).
_OCR_MIN_SIDE = 64
_OCR_MAX_CROPS = 12
# Unassigned proposals kept for review (highest confidence first).
_MAX_UNKNOWN = 6


def _crop(image: np.ndarray, proposal: Proposal) -> np.ndarray:
    """
    Extract a proposal's pixels with bounds clamped to the frame.

    Args:
        image: Full BGR photo.
        proposal: Region to crop.
    Returns:
        BGR crop (at least 1×1).
    """
    height, width = image.shape[:2]
    x1 = max(0, min(width - 1, round(proposal.x1)))
    y1 = max(0, min(height - 1, round(proposal.y1)))
    x2 = max(x1 + 1, min(width, round(proposal.x2)))
    y2 = max(y1 + 1, min(height, round(proposal.y2)))
    return image[y1:y2, x1:x2]


def _thumbnail_data_uri(crop: np.ndarray) -> str:
    """
    Encode a crop as a small JPEG data URI for the review UI.

    Args:
        crop: BGR crop.
    Returns:
        data:image/jpeg;base64,… string (longest side ≤ 160px).
    """
    height, width = crop.shape[:2]
    scale = _THUMB_SIZE / max(height, width)
    if scale < 1.0:
        crop = cv2.resize(
            crop, (max(1, round(width * scale)), max(1, round(height * scale)))
        )
    ok, buffer = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 80])
    if not ok:
        return ""
    return "data:image/jpeg;base64," + base64.b64encode(buffer.tobytes()).decode()


def _candidate_json(candidate: CandidateScore) -> dict:
    """
    Serialize one candidate score for the API response.

    Args:
        candidate: Scored target.
    Returns:
        JSON-serializable candidate dict.
    """
    return {
        "target_id": candidate.target_id,
        "label": candidate.label,
        "component_id": candidate.component_id,
        "inventory_item_id": candidate.inventory_item_id,
        "score": candidate.score,
        "visual": candidate.visual,
        "ocr": candidate.ocr,
    }


@recognition_bp.route("/detect_v2", methods=["POST"])
@require_auth
def detect_v2() -> tuple:
    """
    Recognize components in a circuit image (photo path of the domain router).

    Multipart body: 'image' file; optional 'folder_id' form field — when the
    folder belongs to the (non-guest) requester, its inventory constrains the
    assignment; otherwise the whole shared library is matched one-slot-each.

    Returns:
        200 with {domain:'schematic'} (caller should use /detect_circuit), or
        {domain:'photo', proposals:[…], inventory_report:{…}}; 400 on missing/
        undecodable image.
    """
    if "image" not in request.files:
        return jsonify({"error": "No image provided"}), 400

    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as tmp:
            request.files["image"].save(tmp.name)
            temp_path = Path(tmp.name)

        try:
            decision = classify_image(temp_path)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        if decision.domain == "schematic":
            return (
                jsonify(
                    {
                        "domain": "schematic",
                        "signals": {
                            "saturated_fraction": decision.saturated_fraction,
                            "bright_fraction": decision.bright_fraction,
                        },
                    }
                ),
                200,
            )

        image = cv2.imread(str(temp_path), cv2.IMREAD_COLOR)
        proposals = get_proposer().propose(temp_path)[:_MAX_PROPOSALS]

        # Per-crop identity signals.
        crops = [_crop(image, p) for p in proposals]
        embedder = get_embedder()
        embeddings: list[np.ndarray | None] = [
            embedder.embed_bgr(c) if embedder is not None else None for c in crops
        ]
        ocr_budget = sorted(
            (
                i
                for i, c in enumerate(crops)
                if min(c.shape[0], c.shape[1]) >= _OCR_MIN_SIDE
            ),
            key=lambda i: -proposals[i].confidence,
        )[:_OCR_MAX_CROPS]
        ocr_set = set(ocr_budget)
        texts: list[list[str]] = [
            read_text(crops[i]) if i in ocr_set else [] for i in range(len(crops))
        ]

        # Inventory targets when a real user sent their folder; else global.
        folder_raw = request.form.get("folder_id", "").strip()
        targets = []
        used_inventory = False
        if folder_raw.isdigit() and not g.user.get("guest"):
            targets = load_inventory_targets(int(folder_raw), int(g.user["sub"]))
            used_inventory = len(targets) > 0
        if not targets:
            targets = load_global_targets()

        result = match_proposals(embeddings, texts, targets)

        proposal_rows: list[dict] = []
        unknown_kept = 0
        for match, proposal in zip(result.matches, proposals):
            if match.assigned is None:
                if unknown_kept >= _MAX_UNKNOWN:
                    continue
                unknown_kept += 1
            proposal_rows.append(
                {
                    "box": {
                        "x1": round(proposal.x1, 1),
                        "y1": round(proposal.y1, 1),
                        "x2": round(proposal.x2, 1),
                        "y2": round(proposal.y2, 1),
                    },
                    "confidence": round(proposal.confidence, 3),
                    "hint": proposal.hint,
                    "source": proposal.source,
                    "crop": _thumbnail_data_uri(crops[match.proposal_index]),
                    "ocr": texts[match.proposal_index],
                    "assigned": (
                        _candidate_json(match.assigned) if match.assigned else None
                    ),
                    "candidates": [_candidate_json(c) for c in match.candidates],
                    "needs_review": match.needs_review,
                    "reasons": match.reasons,
                }
            )

        matched = sum(1 for row in proposal_rows if row["assigned"] is not None)
        return (
            jsonify(
                {
                    "domain": "photo",
                    "used_inventory": used_inventory,
                    "proposals": proposal_rows,
                    "inventory_report": {
                        "matched": matched,
                        "unknown": len(proposal_rows) - matched,
                        "missing": result.missing_labels if used_inventory else [],
                    },
                    "signals": {
                        "saturated_fraction": decision.saturated_fraction,
                        "bright_fraction": decision.bright_fraction,
                    },
                }
            ),
            200,
        )

    except (OSError, ValueError, RuntimeError) as exc:
        return jsonify({"error": str(exc)}), 500

    finally:
        if temp_path is not None and temp_path.exists():
            temp_path.unlink()
