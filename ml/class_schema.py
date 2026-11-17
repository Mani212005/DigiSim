"""
Module: class_schema.py
Purpose: Loads and validates ml/classes.yaml (the single source of truth for the detector
         class vocabulary) and generates everything derived from it: the backend
         CLASS_TO_NODE_TYPE map, the frontend YOLO_CLASS_MAP, and YOLO dataset data.yaml
         files. Also exposes a `check` mode so contract tests and CI can verify that the
         generated files on disk are not stale.

Usage:
    cd ml
    uv run python class_schema.py generate                # rewrite the generated backend + frontend files
    uv run python class_schema.py check                   # exit 1 if a generated file is stale
    uv run python class_schema.py data-yaml --path DIR    # print a YOLO data.yaml (tier A by default)
"""

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path

import yaml

ML_DIR = Path(__file__).resolve().parent
REPO_ROOT = ML_DIR.parent
SCHEMA_PATH = ML_DIR / "classes.yaml"
BACKEND_MAP_PATH = REPO_ROOT / "backend" / "pipeline" / "class_map.py"
FRONTEND_MAP_PATH = REPO_ROOT / "frontend" / "src" / "logic" / "vision" / "yoloClassMap.generated.ts"

TIER_ORDER: tuple[str, ...] = ("A", "B")
SCHEMA_VERSION = 1


@dataclass(frozen=True)
class ClassSpec:
    """One detector class as declared in classes.yaml."""

    name: str
    id: int
    tier: str
    node_type: str
    terminals: tuple[str, ...]
    default_size: tuple[int, int]


@dataclass(frozen=True)
class ClassSchema:
    """The validated class vocabulary: ordered classes plus legacy aliases."""

    classes: tuple[ClassSpec, ...]
    aliases: dict[str, str]
    legacy_order: tuple[str, ...]

    @property
    def names(self) -> tuple[str, ...]:
        """
        Canonical class names ordered by YOLO id.

        Returns:
            Tuple of class names where index equals the YOLO class id.
        """
        return tuple(c.name for c in self.classes)

    def node_type_map(self) -> dict[str, str]:
        """
        Class name to frontend node type, canonical names first, then legacy aliases.

        Returns:
            Ordered dict covering every canonical name and every alias.
        """
        by_name = {c.name: c.node_type for c in self.classes}
        mapping = dict(by_name)
        for alias, canonical in self.aliases.items():
            mapping[alias] = by_name[canonical]
        return mapping

    def classes_up_to(self, max_tier: str) -> tuple[ClassSpec, ...]:
        """
        Classes whose tier is at or below max_tier.

        Args:
            max_tier: Highest tier to include ('A' or 'B').
        Returns:
            Classes in YOLO id order; ids stay contiguous from 0 because tiers are id-ordered.
        Raises:
            ValueError: If max_tier is not a known tier.
        """
        if max_tier not in TIER_ORDER:
            raise ValueError(f"Unknown tier {max_tier!r}; expected one of {TIER_ORDER}")
        limit = TIER_ORDER.index(max_tier)
        return tuple(c for c in self.classes if TIER_ORDER.index(c.tier) <= limit)


def load_schema(path: Path = SCHEMA_PATH) -> ClassSchema:
    """
    Load and validate the class schema.

    Args:
        path: Path to classes.yaml.
    Returns:
        The validated ClassSchema.
    Raises:
        FileNotFoundError: If the schema file does not exist.
        ValueError: If the schema is malformed (duplicate names or ids, non-contiguous ids,
            tiers out of order, bad terminals or size, aliases that do not resolve).
    """
    if not path.exists():
        raise FileNotFoundError(f"Class schema not found: {path}")
    raw = yaml.safe_load(path.read_text())
    if not isinstance(raw, dict) or raw.get("version") != SCHEMA_VERSION:
        raise ValueError(f"{path}: expected a mapping with version: {SCHEMA_VERSION}")

    classes: list[ClassSpec] = []
    for entry in raw.get("classes") or []:
        try:
            size = tuple(int(v) for v in entry["default_size"])
            spec = ClassSpec(
                name=str(entry["name"]),
                id=int(entry["id"]),
                tier=str(entry["tier"]),
                node_type=str(entry["node_type"]),
                terminals=tuple(str(t) for t in entry["terminals"]),
                default_size=(size[0], size[1]),
            )
        except (KeyError, TypeError, ValueError, IndexError) as exc:
            raise ValueError(f"{path}: malformed class entry {entry!r}: {exc}") from exc
        classes.append(spec)

    aliases = {str(k): str(v) for k, v in (raw.get("aliases") or {}).items()}
    legacy_order = tuple(str(n) for n in raw.get("legacy_order") or [])
    schema = ClassSchema(classes=tuple(classes), aliases=aliases, legacy_order=legacy_order)
    _validate(schema)
    return schema


def _validate(schema: ClassSchema) -> None:
    """
    Enforce the schema invariants.

    Args:
        schema: Schema to check.
    Raises:
        ValueError: On the first violated invariant.
    """
    if not schema.classes:
        raise ValueError("classes.yaml declares no classes")
    names = schema.names
    if len(set(names)) != len(names):
        raise ValueError("Duplicate class names in classes.yaml")
    if [c.id for c in schema.classes] != list(range(len(schema.classes))):
        raise ValueError("Class ids must be contiguous from 0 and listed in id order")
    tier_ranks = [TIER_ORDER.index(c.tier) if c.tier in TIER_ORDER else -1 for c in schema.classes]
    if -1 in tier_ranks:
        raise ValueError(f"Every class tier must be one of {TIER_ORDER}")
    if tier_ranks != sorted(tier_ranks):
        raise ValueError("Classes must be ordered by tier so a tier prefix has contiguous ids")
    for c in schema.classes:
        if not c.node_type or not c.terminals or any(v <= 0 for v in c.default_size):
            raise ValueError(f"Class {c.name}: node_type, terminals and a positive default_size are required")
    upper_names = {n.upper() for n in names}
    for alias, canonical in schema.aliases.items():
        if canonical not in names:
            raise ValueError(f"Alias {alias} points at unknown class {canonical}")
        if alias.upper() in upper_names:
            raise ValueError(f"Alias {alias} collides with a canonical class name")
    known = set(names) | set(schema.aliases)
    if len(set(schema.legacy_order)) != len(schema.legacy_order):
        raise ValueError("Duplicate names in legacy_order")
    for name in schema.legacy_order:
        if name not in known:
            raise ValueError(f"legacy_order entry {name} is neither a class nor an alias")


def _py_tuple(items: tuple[str, ...]) -> str:
    """
    Python source of a tuple of strings, formatted the way ruff format writes it.

    Args:
        items: Strings.
    Returns:
        Source text such as ("a",) or ("a", "b").
    """
    quoted = ", ".join(f'"{t}"' for t in items)
    return f"({quoted},)" if len(items) == 1 else f"({quoted})"


def render_backend_map(schema: ClassSchema) -> str:
    """
    Render backend/pipeline/class_map.py (ruff-format clean).

    Args:
        schema: Validated schema.
    Returns:
        Full file text.
    """
    lines = [
        '"""',
        "Module: class_map.py",
        "Purpose: AUTO-GENERATED from ml/classes.yaml by ml/class_schema.py - do not edit by hand.",
        "         Class vocabulary data for the detector: canonical names by YOLO id, legacy aliases",
        "         that old weights still predict, the class-to-frontend-node-type map and the",
        "         terminal names of each class (the net tracer's pin vocabulary).",
        "         Regenerate with `cd ml && uv run python class_schema.py generate`.",
        '"""',
        "",
        "# Canonical class names; the index is the YOLO class id.",
        "CLASS_NAMES: tuple[str, ...] = (",
        *[f'    "{n}",' for n in schema.names],
        ")",
        "",
        "# Legacy (gate-era) class names -> canonical class, so old weights keep resolving.",
        "CLASS_ALIASES: dict[str, str] = {",
        *[f'    "{a}": "{c}",' for a, c in schema.aliases.items()],
        "}",
        "",
        "# Class name (canonical and legacy) -> ReactFlow node type used by the frontend.",
        "CLASS_TO_NODE_TYPE: dict[str, str] = {",
        *[f'    "{n}": "{t}",' for n, t in schema.node_type_map().items()],
        "}",
        "",
        "# Canonical class name -> terminal names, in the frontend handle naming (t:<name> / s:<name>).",
        "CLASS_TERMINALS: dict[str, tuple[str, ...]] = {",
        *[f'    "{c.name}": {_py_tuple(c.terminals)},' for c in schema.classes],
        "}",
        "",
    ]
    return "\n".join(lines)


def render_frontend_map(schema: ClassSchema) -> str:
    """
    Render frontend/src/logic/vision/yoloClassMap.generated.ts.

    Args:
        schema: Validated schema.
    Returns:
        Full file text.
    """
    lines = [
        "/**",
        " * @file yoloClassMap.generated.ts",
        " * @description AUTO-GENERATED from ml/classes.yaml by ml/class_schema.py - do not edit by hand.",
        " * Detector class vocabulary: canonical names by YOLO id, legacy aliases that old weights still",
        " * predict, and the class-to-node-type map. Regenerate with `cd ml && uv run python class_schema.py generate`.",
        " */",
        "",
        "import type { YoloNodeType } from '../../types';",
        "",
        "/** Canonical class names; the index is the YOLO class id. */",
        "export const YOLO_CLASS_NAMES: readonly string[] = [",
        *[f"  '{n}'," for n in schema.names],
        "];",
        "",
        "/** Class order of the 12-class gate-era weights; the index is their YOLO class id. */",
        "export const YOLO_LEGACY_CLASS_NAMES: readonly string[] = [",
        *[f"  '{n}'," for n in schema.legacy_order],
        "];",
        "",
        "/** Legacy (gate-era) class names mapped to their canonical class. */",
        "export const YOLO_CLASS_ALIASES: Record<string, string> = {",
        *[f"  {a}: '{c}'," for a, c in schema.aliases.items()],
        "};",
        "",
        "/** Class name (canonical and legacy) mapped to the DigiSim ReactFlow node type. */",
        "export const YOLO_CLASS_MAP: Record<string, YoloNodeType> = {",
        *[f"  {n}: '{t}'," for n, t in schema.node_type_map().items()],
        "};",
        "",
    ]
    return "\n".join(lines)


def render_data_yaml(schema: ClassSchema, dataset_root: Path, max_tier: str = "A") -> str:
    """
    Render a YOLO dataset data.yaml for the classes up to max_tier.

    Args:
        schema: Validated schema.
        dataset_root: Dataset root directory written into the `path:` key.
        max_tier: Highest tier to include ('A' or 'B').
    Returns:
        YAML text with train/val/test split dirs, nc and id-ordered names.
    Raises:
        ValueError: If max_tier is unknown.
    """
    selected = schema.classes_up_to(max_tier)
    doc = {
        "path": str(dataset_root.resolve()),
        "train": "images/train",
        "val": "images/valid",
        "test": "images/test",
        "nc": len(selected),
        "names": [c.name for c in selected],
    }
    return yaml.safe_dump(doc, sort_keys=False)


def generated_files(schema: ClassSchema) -> dict[Path, str]:
    """
    Every generated file and its expected content.

    Args:
        schema: Validated schema.
    Returns:
        Mapping of absolute path to the text it must contain.
    """
    return {
        BACKEND_MAP_PATH: render_backend_map(schema),
        FRONTEND_MAP_PATH: render_frontend_map(schema),
    }


def stale_files(schema: ClassSchema) -> list[Path]:
    """
    Generated files whose on-disk content differs from the schema.

    Args:
        schema: Validated schema.
    Returns:
        Paths that are missing or out of date.
    """
    return [p for p, text in generated_files(schema).items() if not p.exists() or p.read_text() != text]


def main(argv: list[str] | None = None) -> int:
    """
    CLI entry point.

    Args:
        argv: Argument list (defaults to sys.argv[1:]).
    Returns:
        Process exit code: 0 on success, 1 when `check` finds stale files.
    """
    parser = argparse.ArgumentParser(description="DigiSim class schema tooling")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("generate", help="rewrite the generated backend and frontend files")
    sub.add_parser("check", help="exit 1 if a generated file is stale")
    dy = sub.add_parser("data-yaml", help="print a YOLO data.yaml")
    dy.add_argument("--path", type=Path, required=True, help="dataset root directory")
    dy.add_argument("--tier", default="A", choices=TIER_ORDER, help="highest tier to include")
    args = parser.parse_args(argv)

    schema = load_schema()
    if args.command == "generate":
        for path, text in generated_files(schema).items():
            path.write_text(text)
            print(f"wrote {path.relative_to(REPO_ROOT)}")
        return 0
    if args.command == "check":
        stale = stale_files(schema)
        for path in stale:
            print(f"stale: {path.relative_to(REPO_ROOT)} (run: cd ml && uv run python class_schema.py generate)")
        return 1 if stale else 0
    sys.stdout.write(render_data_yaml(schema, args.path, args.tier))
    return 0


if __name__ == "__main__":
    sys.exit(main())
