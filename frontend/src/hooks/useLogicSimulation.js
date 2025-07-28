import { useCallback } from 'react';

const evaluateGate = (type, inputs) => {
  switch (type) {
    case 'andGate':
      return inputs.every(input => input === 1) ? 1 : 0;
    case 'orGate':
      return inputs.some(input => input === 1) ? 1 : 0;
    case 'notGate':
      return inputs[0] === 0 ? 1 : 0;
    case 'nandGate':
      return inputs.every(input => input === 1) ? 0 : 1;
    case 'norGate':
      return inputs.some(input => input === 1) ? 0 : 1;
    case 'xorGate':
      return (inputs[0] !== inputs[1]) ? 1 : 0;
    case 'xnorGate':
      return (inputs[0] === inputs[1]) ? 1 : 0;
    default:
      return 0;
  }
};

export const useLogicSimulation = () => {

  const simulateCircuit = useCallback((currentNodes, currentEdges) => {
    const newNodes = currentNodes.map(node => ({ ...node }));
    const nodeMap = new Map(newNodes.map(node => [node.id, node]));

    // Initialize input nodes (if not already set)
    newNodes.forEach(node => {
      if (node.type === 'input' && node.data.value === undefined) {
        node.data.value = 0; // Default input to 0
      }
    });

    // Simple topological sort (for now, assume no cycles and process in order)
    const sortedNodes = [...newNodes].sort((a, b) => {
      // Inputs should come first
      if (a.type === 'input' && b.type !== 'input') return -1;
      if (b.type === 'input' && a.type !== 'input') return 1;

      // For other nodes, try to order based on dependencies (simple heuristic)
      const aIncomingEdges = currentEdges.filter(edge => edge.target === a.id);
      const bIncomingEdges = currentEdges.filter(edge => edge.target === b.id);

      if (aIncomingEdges.some(edge => edge.source === b.id)) return 1;
      if (bIncomingEdges.some(edge => edge.source === a.id)) return -1;

      return 0;
    });

    sortedNodes.forEach(node => {
      if (node.type !== 'input') {
        const incomingEdges = currentEdges.filter(edge => edge.target === node.id);
        const inputs = incomingEdges.map(edge => {
          const sourceNode = nodeMap.get(edge.source);
          return sourceNode && sourceNode.data.value !== undefined ? sourceNode.data.value : 0;
        });

        if (node.type === 'output') {
          node.data.value = inputs.length > 0 ? inputs[0] : 0;
        } else {
          node.data.value = evaluateGate(node.type, inputs);
        }
      }
    });
    return newNodes;
  }, []);

  return { simulateCircuit };
};
