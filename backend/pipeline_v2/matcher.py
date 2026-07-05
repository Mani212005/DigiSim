"""
Module: matcher.py
Purpose: Identity assignment for open-set recognition — scores every detected
         proposal against every inventory slot (visual embedding similarity +
         OCR text match) and solves the global assignment with the Hungarian
         algorithm, using inventory quantities as hard multiset constraints
         (a BOM listing 3 resistors gets at most 3 resistor assignments).
         Low scores and small top1–top2 margins are flagged for human review —
         nothing ambiguous lands on the canvas silently.
"""

from dataclasses import dataclass, field

import numpy as np
from rapidfuzz import fuzz
from scipy.optimize import linear_sum_assignment

# Combined-score weights (visual dominates; OCR breaks look-alike ties).
W_VISUAL = 0.75
W_OCR = 0.25
# Assignments below this combined score are rejected outright.
ASSIGN_MIN_SCORE = 0.45
# Assignments below this score are kept but flagged for review.
REVIEW_SCORE = 0.70
# Top1−top2 candidate margins below this flag the proposal for review.
REVIEW_MARGIN = 0.08
TOP_K = 3
# Without a visual signal, only a near-exact OCR hit counts as identity
# evidence; fuzzy text overlap ("esp32-wr00m" vs "esp8266") is scaled far
# below the assignment threshold instead of leaking through.
OCR_ONLY_STRONG = 0.85
OCR_ONLY_CAP = 0.85
OCR_ONLY_WEAK_CAP = 0.4


@dataclass
class MatchTarget:
    """One assignable inventory slot (an inventory row expanded by qty)."""

    target_id: str
    label: str
    component_id: int | None
    # Names + aliases + raw inventory name, all matched against OCR text.
    names: list[str]
    embeddings: list[np.ndarray]
    inventory_item_id: int | None = None


@dataclass
class CandidateScore:
    """How well one target explains one proposal."""

    target_id: str
    label: str
    component_id: int | None
    inventory_item_id: int | None
    score: float
    visual: float
    ocr: float


@dataclass
class ProposalMatch:
    """Assignment outcome for one proposal."""

    proposal_index: int
    assigned: CandidateScore | None
    candidates: list[CandidateScore]
    needs_review: bool
    reasons: list[str] = field(default_factory=list)


@dataclass
class MatchResult:
    """Full assignment outcome for one image."""

    matches: list[ProposalMatch]
    missing_labels: list[str]


def _visual_score(embedding: np.ndarray | None, target: MatchTarget) -> float:
    """
    Max cosine similarity between a proposal crop and a target's gallery.

    Args:
        embedding: L2-normalised crop embedding (None when unavailable).
        target: Candidate inventory slot.
    Returns:
        Similarity in [0, 1] (negative cosines clamp to 0); 0 when either side
        has no embeddings.
    """
    if embedding is None or not target.embeddings:
        return 0.0
    best = max(float(np.dot(embedding, ref)) for ref in target.embeddings)
    return max(0.0, best)


def _ocr_score(texts: list[str], target: MatchTarget) -> float:
    """
    Best fuzzy match between OCR fragments and the target's names.

    Fragment-friendly partial matching for real part names; short aliases
    (e.g. "led") use strict full-string similarity so they can't hide inside
    unrelated silkscreen text.

    Args:
        texts: Lowercased OCR fragments from the crop.
        target: Candidate inventory slot.
    Returns:
        Match strength in [0, 1]; 0 when there is no text.
    """
    if not texts or not target.names:
        return 0.0
    best = 0.0
    for text in texts:
        for name in target.names:
            lowered = name.lower()
            if len(lowered) < 4:
                score = fuzz.ratio(text, lowered)
            else:
                score = fuzz.partial_ratio(text, lowered)
            best = max(best, score)
    return best / 100.0


def score_pair(
    embedding: np.ndarray | None, texts: list[str], target: MatchTarget
) -> tuple[float, float, float]:
    """
    Combined identity score for one proposal/target pair.

    Args:
        embedding: Crop embedding (None when the embedder is offline).
        texts: OCR fragments from the crop.
        target: Candidate inventory slot.
    Returns:
        (combined, visual, ocr) — combined is the weighted sum, renormalised
        over the signals that are actually available so a missing signal
        doesn't unfairly cap the score.
    """
    visual = _visual_score(embedding, target)
    ocr = _ocr_score(texts, target)
    weights = 0.0
    total = 0.0
    if embedding is not None and target.embeddings:
        weights += W_VISUAL
        total += W_VISUAL * visual
    if texts:
        weights += W_OCR
        total += W_OCR * ocr
    combined = total / weights if weights > 0 else 0.0
    if embedding is None or not target.embeddings:
        # OCR-only evidence: a near-exact text hit stays assignable (capped);
        # fuzzy overlap is scaled below the assignment threshold entirely.
        cap = OCR_ONLY_CAP if ocr >= OCR_ONLY_STRONG else OCR_ONLY_WEAK_CAP
        combined *= cap
    return combined, visual, ocr


def match_proposals(
    embeddings: list[np.ndarray | None],
    ocr_texts: list[list[str]],
    targets: list[MatchTarget],
) -> MatchResult:
    """
    Globally assign proposals to inventory slots.

    Args:
        embeddings: One (possibly None) crop embedding per proposal.
        ocr_texts: One OCR-fragment list per proposal.
        targets: Inventory slots (rows already expanded by quantity).
    Returns:
        MatchResult with per-proposal assignments/candidates/review flags and
        the labels of inventory slots that were never found in the image.
    """
    n_proposals = len(embeddings)
    matches: list[ProposalMatch] = []
    if n_proposals == 0:
        return MatchResult(matches=[], missing_labels=_label_counts(targets, set()))

    # Score matrix + per-proposal candidate lists (best score per distinct label).
    scores = np.zeros((n_proposals, max(len(targets), 1)), dtype=np.float64)
    details: list[list[CandidateScore]] = []
    for i in range(n_proposals):
        row: list[CandidateScore] = []
        for j, target in enumerate(targets):
            combined, visual, ocr = score_pair(embeddings[i], ocr_texts[i], target)
            scores[i, j] = combined
            row.append(
                CandidateScore(
                    target_id=target.target_id,
                    label=target.label,
                    component_id=target.component_id,
                    inventory_item_id=target.inventory_item_id,
                    score=round(combined, 4),
                    visual=round(visual, 4),
                    ocr=round(ocr, 4),
                )
            )
        details.append(row)

    # Hungarian assignment (maximise total score) with qty as a hard constraint:
    # each target slot is one column, so a 3× resistor row yields 3 columns.
    assigned_slot: dict[int, int] = {}
    if targets:
        rows, cols = linear_sum_assignment(scores, maximize=True)
        for i, j in zip(rows, cols):
            if scores[i, j] >= ASSIGN_MIN_SCORE:
                assigned_slot[int(i)] = int(j)

    used_slots = set(assigned_slot.values())
    for i in range(n_proposals):
        # Candidates: best score per distinct label, top-K.
        by_label: dict[str, CandidateScore] = {}
        for candidate in details[i]:
            existing = by_label.get(candidate.label)
            if existing is None or candidate.score > existing.score:
                by_label[candidate.label] = candidate
        candidates = sorted(by_label.values(), key=lambda c: -c.score)[:TOP_K]

        slot = assigned_slot.get(i)
        assigned = details[i][slot] if slot is not None else None
        reasons: list[str] = []
        if assigned is None:
            reasons.append("no_confident_match")
        else:
            if assigned.score < REVIEW_SCORE:
                reasons.append("low_score")
            if (
                len(candidates) > 1
                and candidates[0].score - candidates[1].score < REVIEW_MARGIN
            ):
                reasons.append("small_margin")
            if assigned.visual == 0.0:
                # Identity rests on silkscreen text alone — always confirm.
                reasons.append("ocr_only")
        if embeddings[i] is None:
            reasons.append("no_embedding")

        matches.append(
            ProposalMatch(
                proposal_index=i,
                assigned=assigned,
                candidates=candidates,
                needs_review=len(reasons) > 0,
                reasons=reasons,
            )
        )

    return MatchResult(
        matches=matches, missing_labels=_label_counts(targets, used_slots)
    )


def _label_counts(targets: list[MatchTarget], used_slots: set[int]) -> list[str]:
    """
    Human-readable labels of unassigned inventory slots.

    Args:
        targets: All inventory slots.
        used_slots: Column indexes consumed by the assignment.
    Returns:
        Labels like "Resistor ×2" for slots never matched in the image.
    """
    counts: dict[str, int] = {}
    for j, target in enumerate(targets):
        if j not in used_slots:
            counts[target.label] = counts.get(target.label, 0) + 1
    return [
        label if count == 1 else f"{label} ×{count}" for label, count in counts.items()
    ]
