"""
Module: evaluate_photo.py
Purpose: R2 evaluation harness for open-set photo recognition. Scores the live
         /detect_v2 endpoint against a labeled eval set of real build photos:
         proposal recall (was the part found at all), top-1 identity (was the
         best candidate the right part), and assignment accuracy (did the
         inventory-constrained Hungarian pick it). Phase gate: top-1 identity
         >= 0.90. Skips gracefully until a labeled eval set exists — collect
         ~20 photographed builds under ml/eval_photo/ (see EXPECTED_FORMAT).

         Stdlib-only HTTP client on purpose: the ml env stays training-focused
         and the metric covers the full deployed pipeline, not a re-implementation.
"""

import json
import os
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path

API_URL = os.getenv("API_URL", "http://localhost:5001")
EVAL_DIR = Path(os.getenv("PHOTO_EVAL_DIR", str(Path(__file__).parent / "eval_photo")))
LABELS_PATH = EVAL_DIR / "labels.json"
IOU_THRESHOLD = 0.5
IDENTITY_GATE = 0.90

EXPECTED_FORMAT = """\
ml/eval_photo/labels.json format:
{
  "images": [
    {
      "file": "build_001.jpg",           // photo next to labels.json
      "folder_id": 5,                    // optional: inventory-constrained run
      "components": [
        {"label": "ESP32 DevKit V1", "box": [x1, y1, x2, y2]}
      ]
    }
  ]
}"""


def _iou(a: list[float], b: list[float]) -> float:
    """
    Intersection-over-union of two [x1, y1, x2, y2] boxes.

    Args:
        a: First box.
        b: Second box.
    Returns:
        IoU in [0, 1].
    """
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    area_a = max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])
    area_b = max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def _normalize_label(label: str) -> str:
    """
    Strip the inventory designator prefix ("U1 · ESP32 ..." -> "esp32 ...").

    Args:
        label: Raw label from the API or the eval annotations.
    Returns:
        Lowercased comparable label.
    """
    if "·" in label:
        label = label.split("·", 1)[1]
    return label.strip().lower()


def _guest_cookie() -> str:
    """
    Open an anonymous guest session for authenticated endpoint access.

    Returns:
        Cookie header value for subsequent requests.
    Raises:
        urllib.error.URLError: When the backend is unreachable.
    """
    request = urllib.request.Request(f"{API_URL}/auth/guest", method="POST", data=b"{}")
    request.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(request, timeout=30) as response:
        cookies = response.headers.get_all("Set-Cookie") or []
    return "; ".join(cookie.split(";", 1)[0] for cookie in cookies)


def _detect(image_path: Path, folder_id: int | None, cookie: str) -> dict:
    """
    POST one photo to /detect_v2 as multipart form data.

    Args:
        image_path: Photo to analyse.
        folder_id: Optional project folder whose inventory constrains matching.
        cookie: Session cookie header value.
    Returns:
        Parsed /detect_v2 JSON response.
    Raises:
        urllib.error.HTTPError: On non-2xx responses.
    """
    boundary = uuid.uuid4().hex
    parts = [
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="image"; '
        f'filename="{image_path.name}"\r\n'
        "Content-Type: image/jpeg\r\n\r\n".encode()
        + image_path.read_bytes()
        + b"\r\n"
    ]
    if folder_id is not None:
        parts.append(
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="folder_id"\r\n\r\n'
            f"{folder_id}\r\n".encode()
        )
    body = b"".join(parts) + f"--{boundary}--\r\n".encode()
    request = urllib.request.Request(f"{API_URL}/detect_v2", method="POST", data=body)
    request.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    request.add_header("Cookie", cookie)
    with urllib.request.urlopen(request, timeout=300) as response:
        return json.loads(response.read())


def evaluate_image(entry: dict, cookie: str) -> dict:
    """
    Score one labeled photo: recall, top-1 identity, assignment accuracy.

    Args:
        entry: One labels.json image entry (file, optional folder_id, components).
        cookie: Session cookie header value.
    Returns:
        Per-image counters: {'gt', 'recalled', 'top1', 'assigned', 'routed_photo'}.
    """
    result = _detect(EVAL_DIR / entry["file"], entry.get("folder_id"), cookie)
    truth = entry["components"]
    counters = {
        "gt": len(truth),
        "recalled": 0,
        "top1": 0,
        "assigned": 0,
        "routed_photo": result.get("domain") == "photo",
    }
    if not counters["routed_photo"]:
        return counters

    proposals = result["proposals"]
    for component in truth:
        # Best-overlapping proposal explains this ground-truth part.
        overlaps = [
            (
                proposal,
                _iou(
                    component["box"],
                    [proposal["box"][key] for key in ("x1", "y1", "x2", "y2")],
                ),
            )
            for proposal in proposals
        ]
        best, best_iou = max(overlaps, key=lambda o: o[1], default=(None, 0.0))
        if best is None or best_iou < IOU_THRESHOLD:
            continue
        counters["recalled"] += 1
        wanted = _normalize_label(component["label"])
        candidates = best["candidates"]
        if candidates and _normalize_label(candidates[0]["label"]) == wanted:
            counters["top1"] += 1
        assigned = best["assigned"]
        if assigned and _normalize_label(assigned["label"]) == wanted:
            counters["assigned"] += 1
    return counters


def main() -> int:
    """
    Run the photo-recognition evaluation and print aggregate metrics.

    Returns:
        Process exit code (0 also when skipping for lack of eval data).
    """
    if not LABELS_PATH.exists():
        print(f"No photo eval set at {LABELS_PATH} — skipping (nothing to score).")
        print("Collect ~20 labeled build photos to arm the R2 gate.\n")
        print(EXPECTED_FORMAT)
        return 0

    try:
        entries = json.loads(LABELS_PATH.read_text())["images"]
    except (json.JSONDecodeError, KeyError) as exc:
        print(f"Malformed {LABELS_PATH}: {exc}\n\n{EXPECTED_FORMAT}")
        return 1
    if not entries:
        print(f"{LABELS_PATH} lists no images — skipping.")
        return 0

    try:
        cookie = _guest_cookie()
    except (urllib.error.URLError, OSError) as exc:
        print(f"Backend unreachable at {API_URL} ({exc}) — start it and retry.")
        return 1

    totals = {"gt": 0, "recalled": 0, "top1": 0, "assigned": 0}
    misrouted = 0
    for entry in entries:
        try:
            counters = evaluate_image(entry, cookie)
        except (urllib.error.HTTPError, urllib.error.URLError, OSError) as exc:
            print(f"{entry['file']}: request failed ({exc})")
            continue
        if not counters["routed_photo"]:
            misrouted += 1
            print(f"{entry['file']}: routed to schematic (domain router miss)")
            continue
        for key in totals:
            totals[key] += counters[key]
        print(
            f"{entry['file']}: gt={counters['gt']}"
            f" recalled={counters['recalled']}"
            f" top1={counters['top1']} assigned={counters['assigned']}"
        )

    if totals["gt"] == 0:
        print("No ground-truth components scored — nothing to report.")
        return 1
    recall = totals["recalled"] / totals["gt"]
    top1 = totals["top1"] / totals["recalled"] if totals["recalled"] else 0.0
    accuracy = totals["assigned"] / totals["gt"]
    print(
        f"\nproposal recall:     {recall:.3f} ({totals['recalled']}/{totals['gt']})"
        f"\ntop-1 identity:      {top1:.3f} ({totals['top1']}/{totals['recalled']})"
        f"\nassignment accuracy: {accuracy:.3f} ({totals['assigned']}/{totals['gt']})"
    )
    if misrouted:
        print(f"domain-router misses: {misrouted} image(s) routed to schematic")
    gate = "PASS" if top1 >= IDENTITY_GATE else "FAIL"
    print(f"R2 gate (top-1 identity >= {IDENTITY_GATE}): {gate}")
    return 0 if gate == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
