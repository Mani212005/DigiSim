# Architecture Decisions

## ADR-001: YOLOv8 over RT-DETR
Date: June 2026
Decision: Use YOLOv8n for gate detection
Reason: CPU-friendly inference, works well with limited data, faster iteration
Rejected: RT-DETR (needs more data), Faster-RCNN (too slow on CPU)
Status: Active

## ADR-002: Synthetic data as primary dataset
...