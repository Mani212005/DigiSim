"""
Module: circuit_ai.py
Purpose: Blueprint for multimodal AI circuit generation.
"""

from flask import Blueprint, jsonify, request

from services.ai_circuit_service import generate_subcircuit_from_photo

circuit_ai_bp = Blueprint("circuit_ai", __name__, url_prefix="/api/circuit")

@circuit_ai_bp.route("/photo-to-subcircuit", methods=["POST"])
def photo_to_subcircuit() -> tuple:
    """
    Accepts an image and an optional prompt, returning a synthesized CustomComponentDefinition.
    """
    data = request.json or {}
    image_b64 = data.get("image")
    prompt = data.get("prompt", "")
    
    if not image_b64:
        return jsonify({"error": "No image provided"}), 400
        
    # Strip data URL prefix if present
    if "," in image_b64:
        image_b64 = image_b64.split(",")[1]
        
    result = generate_subcircuit_from_photo(image_b64, prompt)
    return jsonify(result), 200
