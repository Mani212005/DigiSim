import React from 'react';

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
