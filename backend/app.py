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

load_dotenv()

app = Flask(__name__)
CORS(app)

_CLIENT = InferenceHTTPClient(
    api_url="https://serverless.roboflow.com",
    api_key=os.getenv("ROBOFLOW_API_KEY"),
)

MODEL_ID = "my-first-project-yz9wf/1"


@app.route("/health", methods=["GET"])
def health() -> tuple:
    """
    Return service health status.

    Returns:
        JSON response with status ok and HTTP 200.
    """
    return jsonify({"status": "ok"}), 200


@app.route("/detect_gates", methods=["POST"])
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
def detect_circuit() -> tuple:
    """
    Run the full local pipeline: detection → wire extraction → graph → JSON export.

    This endpoint is a stub until Phase 1 ML training is complete and model weights
    are available at MODEL_WEIGHTS_PATH.

    Returns:
        JSON with pipeline status. Returns 503 until weights are ready.
    """
    return (
        jsonify(
            {
                "status": "pipeline_not_ready",
                "message": (
                    "Local YOLO pipeline not yet trained. "
                    "Use /detect_gates for cloud inference."
                ),
            }
        ),
        503,
    )


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    app.run(host="0.0.0.0", port=port)
