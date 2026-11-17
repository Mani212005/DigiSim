/**
 * @file yoloClassMap.test.ts
 * @description Contract test: the generated frontend YOLO class map must equal ml/classes.yaml,
 * the single source of truth shared with the backend detector.
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import {
  YOLO_CLASS_ALIASES,
  YOLO_CLASS_MAP,
  YOLO_CLASS_NAMES,
  YOLO_LEGACY_CLASS_NAMES,
} from './yoloDetector';

interface SchemaClass {
  name: string;
  id: number;
  tier: string;
  node_type: string;
}

interface Schema {
  classes: SchemaClass[];
  aliases: Record<string, string>;
  legacy_order: string[];
}

/**
 * Load and parse ml/classes.yaml from the repo root.
 * @returns The parsed schema document
 */
function loadSchema(): Schema {
  const file = path.resolve(__dirname, '../../../../ml/classes.yaml');
  return yaml.load(fs.readFileSync(file, 'utf8')) as Schema;
}

describe('YOLO class map matches ml/classes.yaml', () => {
  const schema = loadSchema();

  it('lists canonical class names in YOLO id order', () => {
    const ordered = [...schema.classes].sort((a, b) => a.id - b.id).map((c) => c.name);
    expect([...YOLO_CLASS_NAMES]).toEqual(ordered);
    schema.classes.forEach((c) => expect(YOLO_CLASS_NAMES[c.id]).toBe(c.name));
  });

  it('maps every canonical class and every legacy alias to the YAML node type', () => {
    const expected: Record<string, string> = {};
    schema.classes.forEach((c) => {
      expected[c.name] = c.node_type;
    });
    Object.entries(schema.aliases).forEach(([alias, canonical]) => {
      expected[alias] = expected[canonical];
    });
    expect(YOLO_CLASS_MAP).toEqual(expected);
  });

  it('keeps the legacy aliases from the YAML', () => {
    expect(YOLO_CLASS_ALIASES).toEqual(schema.aliases);
  });

  it('keeps the legacy class order from the YAML', () => {
    expect([...YOLO_LEGACY_CLASS_NAMES]).toEqual(schema.legacy_order);
  });

  it('keeps every legacy gate-era class name resolvable to its node type', () => {
    const legacy = ['AND', 'OR', 'NOT', 'NAND', 'NOR', 'XOR', 'XNOR', 'SWITCH', 'INPUT', 'OUTPUT', 'LED', 'JUNCTION'];
    legacy.forEach((n) => expect(YOLO_CLASS_MAP[n]).toBeDefined());
    expect(YOLO_CLASS_MAP.AND).toBe('andGate');
    expect(YOLO_CLASS_MAP.SWITCH).toBe('input');
    expect(YOLO_CLASS_MAP.INPUT).toBe('input');
    expect(YOLO_CLASS_MAP.OUTPUT).toBe('output');
    expect(YOLO_CLASS_MAP.LED).toBe('output');
    expect(YOLO_CLASS_MAP.JUNCTION).toBe('junction');
  });

  it('covers the transistor-first vocabulary', () => {
    expect(YOLO_CLASS_MAP.NMOS).toBe('nmos');
    expect(YOLO_CLASS_MAP.PMOS).toBe('pmos');
    expect(YOLO_CLASS_MAP.VDD).toBe('vsource');
    expect(YOLO_CLASS_MAP.GND).toBe('ground');
  });
});
