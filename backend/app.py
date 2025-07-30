import os
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from inference_sdk import InferenceHTTPClient
import tempfile

load_dotenv()

app = Flask(__name__)
CORS(app) # This enables Cross-Origin Resource Sharing

# Initialize the Roboflow client
CLIENT = InferenceHTTPClient(
    api_url="https://serverless.roboflow.com",
    api_key=os.getenv("ROBOFLOW_API_KEY")
)

# Your Roboflow model ID
MODEL_ID = "my-first-project-yz9wf/1"

@app.route("/detect_gates", methods=["POST"])
def detect_gates():
    if "image" not in request.files:
        return jsonify({"error": "No image provided"}), 400

    image_file = request.files["image"]

    # The SDK needs a file path, so we save the uploaded file temporarily
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as temp_image:
            image_file.save(temp_image.name)
            temp_image_path = temp_image.name

        # Perform inference
        result = CLIENT.infer(temp_image_path, model_id=MODEL_ID)

        # Clean up the temporary file
        os.remove(temp_image_path)

        # The SDK returns a dictionary, which we can directly return as JSON
        return jsonify(result)

    except Exception as e:
        # Clean up the temp file in case of an error
        if 'temp_image_path' in locals() and os.path.exists(temp_image_path):
            os.remove(temp_image_path)
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5001)))