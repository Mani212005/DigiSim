/**
 * @file SampleImages.js
 * @description Dropdown selector that lets the user pick a pre-loaded sample circuit image.
 */

import React from 'react';

/**
 * Renders a dropdown of sample circuit images and fires onImageSelect with the chosen URL.
 * @param {{ images: string[], onImageSelect: (url: string) => void }} props
 * @returns {React.ReactElement} Rendered sample image selector
 */
const SampleImages = ({ images, onImageSelect }) => {
  return (
    <div className="sample-images">
      <h3>Sample Circuits</h3>
      <select onChange={(e) => onImageSelect(`/samples/${e.target.value}`)} className="sample-dropdown">
        <option value="">Select a sample circuit</option>
        {images.map((image, index) => (
          <option key={index} value={image}>
            Sample Circuit ${index + 1}
          </option>
        ))}
      </select>
    </div>
  );
};

export default SampleImages;
