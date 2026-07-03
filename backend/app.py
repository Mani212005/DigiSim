"""
Module: app.py
Purpose: Flask entry point for DigiSim backend — exposes gate detection and
         circuit pipeline endpoints.
"""

import os
import tempfile
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS
from inference_sdk import InferenceHTTPClient

from auth import auth_bp, require_auth
from pipeline.circuit_exporter import CircuitExporter
from pipeline.detector import GateDetector
from pipeline.graph_builder import GraphBuilder
from pipeline.wire_extractor import WireExtractor

load_dotenv()

app = Flask(__name__)
# Credentialed CORS so the httpOnly session cookie flows to the frontend origin.
CORS(
    app,
    supports_credentials=True,
    origins=os.getenv("FRONTEND_ORIGIN", "http://localhost:3000").split(","),
)
app.register_blueprint(auth_bp)

_CLIENT = InferenceHTTPClient(
    api_url="https://serverless.roboflow.com",
    api_key=os.getenv("ROBOFLOW_API_KEY"),
)

MODEL_ID = "my-first-project-yz9wf/1"

_BACKEND_DIR = Path(__file__).resolve().parent
_WEIGHTS_PATH = Path(
    os.getenv("MODEL_WEIGHTS_PATH", _BACKEND_DIR / "model" / "weights" / "best.pt")
)
_CONFIDENCE = float(os.getenv("DETECTION_CONFIDENCE_THRESHOLD", "0.35"))

_detector: GateDetector | None = None


def _get_detector() -> GateDetector | None:
    """
    Lazily load the local YOLO detector once weights exist.

    Returns:
        A cached GateDetector, or None while weights are missing.
    """
    global _detector
    if _detector is None and _WEIGHTS_PATH.exists():
        _detector = GateDetector(_WEIGHTS_PATH, _CONFIDENCE)
    return _detector


@app.route("/health", methods=["GET"])
def health() -> tuple:
    """
    Return service health status.

    Returns:
        JSON response with status ok and HTTP 200.
    """
    return jsonify({"status": "ok"}), 200


@app.route("/detect_gates", methods=["POST"])
@require_auth
def detect_gates() -> tuple:
    """
    Run gate detection on an uploaded circuit image via Roboflow cloud inference.

    Returns:
        JSON with a 'detections' list on success, or an 'error' key on failure.
    Raises:
        400: When no image file is included in the request.
        500: When inference or file I/O fails.
    """
    if "image" not in request.files:
        return jsonify({"error": "No image provided"}), 400

    image_file = request.files["image"]
    temp_path: Path | None = None

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as tmp:
            image_file.save(tmp.name)
            temp_path = Path(tmp.name)

        result = _CLIENT.infer(str(temp_path), model_id=MODEL_ID)
        return jsonify(result), 200

    except (OSError, ValueError, RuntimeError) as exc:
        return jsonify({"error": str(exc)}), 500

    finally:
        if temp_path is not None and temp_path.exists():
            temp_path.unlink()


@app.route("/detect_circuit", methods=["POST"])
@app.route("/api/detect-circuit", methods=["POST"])
@require_auth
def detect_circuit() -> tuple:
    """
    Run the full local pipeline: detection → wire extraction → graph → JSON export.

    Returns:
        JSON with 'components' and 'connections' (CircuitExportJSON) on success,
        503 while model weights are missing, or an 'error' key on failure.
    Raises:
        400: When no image file is included in the request.
        500: When any pipeline stage fails.
    """
    detector = _get_detector()
    if detector is None:
        return (
            jsonify(
                {
                    "status": "pipeline_not_ready",
                    "message": (
                        f"Model weights not found at {_WEIGHTS_PATH}. "
                        "Train with ml/train.py, or use /detect_gates for "
                        "cloud inference."
                    ),
                }
            ),
            503,
        )

    if "image" not in request.files:
        return jsonify({"error": "No image provided"}), 400

    image_file = request.files["image"]
    temp_path: Path | None = None

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as tmp:
            image_file.save(tmp.name)
            temp_path = Path(tmp.name)

        detections = detector.detect(temp_path)
        gate_boxes = [d.box for d in detections if d.class_name != "JUNCTION"]
        wires = WireExtractor().extract(temp_path, exclude_boxes=gate_boxes)
        graph = GraphBuilder().build(detections, wires)
        payload = CircuitExporter().export(graph)
        payload["status"] = "ok"
        payload["detections"] = [
            {
                "class": d.class_name,
                "confidence": round(d.confidence, 3),
                "x": round(d.x, 1),
                "y": round(d.y, 1),
                "width": round(d.width, 1),
                "height": round(d.height, 1),
            }
            for d in detections
        ]
        return jsonify(payload), 200

    except (OSError, ValueError, RuntimeError) as exc:
        return jsonify({"error": str(exc)}), 500

    finally:
        if temp_path is not None and temp_path.exists():
            temp_path.unlink()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    app.run(host="0.0.0.0", port=port)
