"""
Module: config.py
Purpose: Paths and pilot constants for the real-data ingestion: where fetched data lives (gitignored),
         which CGHD drafters make up the pilot and which split each one is assigned to, and the pinned
         upstream revision. Kept in one place so the committed manifest records exactly what was used.
"""

from pathlib import Path

ML_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = ML_DIR.parent

# Everything fetched or generated lives under DATA_ROOT, which is gitignored (see .gitignore).
DATA_ROOT = ML_DIR / "data_real"
RAW_CGHD_DIR = DATA_ROOT / "raw" / "cghd"
YOLO_DIR = DATA_ROOT / "yolo"
REVIEW_DIR = DATA_ROOT / "review"

# Committed artefacts (scripts, manifests, hashes, licences, our own labels). No images.
MANIFEST_PATH = ML_DIR / "data_manifest.json"
LICENSES_PATH = ML_DIR / "DATA_LICENSES.md"
FET_POLARITY_PATH = ML_DIR / "real_data" / "labels" / "fet_polarity.json"
SAMPLE_LABELS_PATH = ML_DIR / "real_data" / "labels" / "sample_labels.json"

ROBOFLOW_DIR = REPO_ROOT / "My First Project.yolov8"
SAMPLE_DIR = REPO_ROOT / "Sampleimages"

# CGHD on the Hugging Face mirror. The licence on the mirror card (cc-by-3.0) disagrees with the Zenodo
# record (CC BY 4.0); we follow the Zenodo terms and keep attribution (see DATA_LICENSES.md).
CGHD_HF_REPO = "lowercaseonly/cghd"
CGHD_HF_REVISION = "44a246d1dc41758ff46c26bd69dccd43d2055eba"
CGHD_ZENODO_RECORD = "https://zenodo.org/records/15333233"

# Pilot drafters and the split each is assigned to. Splits are by whole drafter, never by image: every
# drafter drew the same circuit in 2 drawings x 4 photos, so an image-level split would leak.
CGHD_PILOT_SPLITS: dict[int, str] = {
    19: "train",
    25: "train",
    16: "valid",
    20: "test",
}

# Split names as they appear on disk and in the manifest. `heldout_qual` is the four spare
# Sampleimages: real gate images that were never in the Roboflow export, kept for qualitative checks only.
SPLITS: tuple[str, ...] = ("train", "valid", "test", "heldout_qual")

# Roboflow export split directory -> our split name (the existing source-image split has no leakage).
ROBOFLOW_SPLITS: dict[str, str] = {"train": "train", "valid": "valid", "test": "test"}

# A real test class with fewer instances than this cannot support a real-image claim.
MIN_REAL_TEST_INSTANCES = 30
