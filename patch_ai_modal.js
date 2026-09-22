const fs = require('fs');
const file = 'frontend/src/components/AIVisionIntakeModal.tsx';
let content = fs.readFileSync(file, 'utf8');

const interfaceStr = `
interface AIResult {
  componentName?: string;
  category?: string;
  confidence: number;
  unverifiedPins?: string[];
  pins: any[];
  subcircuit: { nodes: any[]; edges: any[] };
}
`;
content = content.replace("const [result, setResult] = useState<Record<string, unknown> | null>(null);", "const [result, setResult] = useState<AIResult | null>(null);");

content = content.replace("import type { CustomComponentDefinition } from '../types';", "import type { CustomComponentDefinition, DigiNode, DigiEdge } from '../types';\n" + 
`
interface AIResult {
  componentName?: string;
  category?: string;
  confidence: number;
  unverifiedPins?: string[];
  pins: CustomComponentDefinition['pins'];
  subcircuit: { nodes: DigiNode[]; edges: DigiEdge[] };
}
`);

fs.writeFileSync(file, content);
