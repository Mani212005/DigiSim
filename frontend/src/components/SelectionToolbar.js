/**
 * @file SelectionToolbar.js
 * @description Floating contextual toolbar shown near the bounding box of the
 * current multi-node selection — offers Delete and Duplicate bulk actions.
 * Position is derived from the selection rect projected into screen space, so
 * it follows the selection through pan/zoom (App passes the live viewport).
 */

import React from 'react';
import { getRectOfNodes } from 'reactflow';

/**
 * Floating toolbar for the current selection.
 * @param {{ selectedNodes: object[], viewport: { x: number, y: number, zoom: number },
 *   onDelete: () => void, onDuplicate: () => void }} props - Selection state and actions
 * @returns {React.ReactElement|null} Rendered toolbar, or null without a selection
 */
function SelectionToolbar({ selectedNodes, viewport, onDelete, onDuplicate }) {
  if (selectedNodes.length < 1) return null;

  const rect = getRectOfNodes(selectedNodes);
  // Project flow coordinates into wrapper-relative screen space.
  const screenX = (rect.x + rect.width / 2) * viewport.zoom + viewport.x;
  const screenY = rect.y * viewport.zoom + viewport.y;

  return (
    <div
      className="selection-toolbar"
      role="toolbar"
      aria-label="Selection actions"
      style={{ left: screenX, top: Math.max(8, screenY - 52) }}
    >
      <span className="selection-toolbar__count">{selectedNodes.length}</span>
      <button className="selection-toolbar__btn" onClick={onDuplicate}>
        ⧉ Duplicate
      </button>
      <button
        className="selection-toolbar__btn selection-toolbar__btn--danger"
        onClick={onDelete}
      >
        ✕ Delete
      </button>
    </div>
  );
}

export default SelectionToolbar;
