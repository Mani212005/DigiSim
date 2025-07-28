# DigiSim: Logic Gate Circuit Simulator

## Project Purpose
DigiSim is a digital logic circuit simulator that offers two primary methods for circuit creation:
1.  **Manual Drag-and-Drop**: Users can build circuits interactively on a canvas using a drag-and-drop interface.
2.  **Automated Gate Detection**: The application can detect logic gates from uploaded images and automatically construct the corresponding circuit on the canvas.

## Features
*   **Interactive Canvas**: Build and simulate logic circuits using a user-friendly drag-and-drop interface.
*   **Variety of Logic Gates**: Includes common logic gates such as AND, OR, NOT, XOR, NAND, XNOR, along with Input and Output nodes.
*   **Real-time Simulation**: Observe the logic states (ON/OFF) of gates and outputs in real-time.
*   **Image-to-Circuit Conversion**: Upload an image of a logic circuit, and the system will detect the gates and reconstruct the circuit on the canvas.
*   **Sample Circuits**: Load pre-defined sample circuits via a convenient dropdown menu.
*   **Clear Canvas**: Easily clear the current circuit to start fresh.

## Technologies Used

### Frontend
*   **React**: A JavaScript library for building user interfaces.
*   **ReactFlow**: A library for building node-based editors and interactive diagrams.
*   **HTML/CSS**: For structuring and styling the web application.

### Backend (Image Processor)
*   **Python**: The programming language used for the image processing logic.
*   **Roboflow**: Used for object detection (logic gates) in images.

## Setup and Installation

To set up and run the project locally, follow these steps:

### 1. Clone the Repository

```bash
git clone https://github.com/Mani212005/DigiSim.git
cd DigiSim
```

### 2. Frontend Setup

Navigate to the `frontend` directory and install the necessary Node.js packages:

```bash
cd frontend
npm install
```

### 3. Backend (Image Processor) Setup

Navigate to the `image_processor` directory. It's recommended to use a Python virtual environment.

```bash
cd ../image_processor
python -m venv venv
# On Windows:
.\venv\Scripts\activate
# On macOS/Linux:
source venv/bin/activate
```

Install the Python dependencies:

```bash
pip install -r requirements.txt # You might need to create this file if it doesn't exist
```
*(Note: If `requirements.txt` does not exist, you will need to create it by listing the Python packages used in the image processor, e.g., `pip freeze > requirements.txt` after installing them manually.)*

### 4. API Key Configuration (for Roboflow)

The image processor uses Roboflow for gate detection. You will need to obtain your Roboflow API key and configure it. **Do NOT commit your API key to version control.**

*   Create a `.env` file in the `image_processor` directory.
*   Add your Roboflow API key to this file:
    ```
    ROBOFLOW_API_KEY=YOUR_ROBOFLOW_API_KEY
    ```
    Replace `YOUR_ROBOFLOW_API_KEY` with your actual key.

## Running the Application

### 1. Start the Backend (Image Processor)

From the `image_processor` directory (with your virtual environment activated):

```bash
python app.py # Or whatever your main backend script is named
```
*(Note: You might need to adjust `app.py` to the actual name of your backend script.)*

### 2. Start the Frontend

Open a new terminal, navigate to the `frontend` directory, and start the React development server:

```bash
cd frontend
npm start
```

The frontend application should open in your browser, usually at `http://localhost:3000`.

## Usage
*   **Add Gates**: Use the buttons in the sidebar to add Input, Output, and various logic gates to the canvas.
*   **Connect Gates**: Drag from the output handle of one node to the input handle of another to create connections.
*   **Toggle Inputs**: Click on Input nodes to change their value (0 or 1).
*   **Image Upload**: Use the "Image Upload" section to upload an image of a circuit. The system will attempt to detect and draw the gates.
*   **Sample Circuits**: Select a sample circuit from the dropdown to load a pre-defined example.
*   **Clear Canvas**: Click the "Clear Canvas" button to remove all nodes and edges.

## Future Enhancements
*   Saving and loading custom circuits.
*   More advanced simulation features (e.g., timing diagrams).
*   Improved UI/UX for complex circuits.
*   Integration with a more robust backend for persistent storage.
