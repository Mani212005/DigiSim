
import os
from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)

ROBOFLOW_API_KEY = os.getenv("ROBOFLOW_API_KEY")
ROBOFLOW_MODEL_URL = "https://detect.roboflow.com/your-model/1" # Replace with your actual model URL

@app.route("/detect_gates", methods=["POST"])
def detect_gates():
    if "image" not in request.files:
        return jsonify({"error": "No image provided"}), 400

    image_file = request.files["image"]

    # Prepare the image for Roboflow
    image_file.seek(0)
    image_data = image_file.read()

    # Construct the Roboflow API URL
    url = f"{ROBOFLOW_MODEL_URL}?api_key={ROBOFLOW_API_KEY}"

    # Send the request to Roboflow
    try:
        response = requests.post(
            url,
            data=image_data,
            headers={"Content-Type": "application/x-www-form-urlencoded"}
        )
        response.raise_for_status()  # Raise an exception for bad status codes
        return jsonify(response.json())
    except requests.exceptions.RequestException as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5001)))
