/**
 * @file SampleImages.tsx
 * @description Thumbnail gallery of bundled hand-drawn circuit photos — clicking one
 * feeds it straight into the detection pipeline.
 */

import React from 'react';
import type { SampleImagesProps } from '../types';

/**
 * Renders clickable thumbnails of sample circuit images and fires onImageSelect
 * with the chosen URL.
 * @param props - Image filenames and the selection callback
 * @returns Rendered sample image gallery
 */
const SampleImages = ({ images, onImageSelect }: SampleImagesProps): React.ReactElement => {
  return (
    <div className="sample-images">
      <h4 className="sample-title">Sample Circuits</h4>
      <div className="sample-grid">
        {images.map((image, index) => (
          <button
            key={image}
            className="sample-thumb"
            aria-label={`Detect sample circuit ${index + 1}`}
            onClick={() => onImageSelect(`/samples/${image}`)}
          >
            <img src={`/samples/${image}`} alt={`Sample circuit ${index + 1}`} loading="lazy" />
            <span className="sample-thumb__tag">#{index + 1}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default SampleImages;
