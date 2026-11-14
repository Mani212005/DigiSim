/**
 * @file yoloClassMap.test.ts
 * @description Contract test: the generated frontend YOLO class map must equal ml/classes.yaml,
 * the single source of truth shared with the backend detector.
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { YOLO_CLASS_ALIASES, YOLO_CLASS_MAP, YOLO_CLASS_NAMES, resolveYoloClassName } from './yoloDetector';

interface SchemaClass {
  name: string;
  id: number;
  tier: string;
  node_type: string;
}

interface Schema {
  classes: SchemaClass[];
  aliases: Record<string, string>;
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

  it('resolves legacy gate-era names so old weights still load', () => {
    ['AND', 'OR', 'NOT', 'NAND', 'NOR', 'XOR', 'XNOR'].forEach((n) => expect(resolveYoloClassName(n)).toBe(n));
    expect(resolveYoloClassName('SWITCH')).toBe('INPUT_PORT');
    expect(resolveYoloClassName('input')).toBe('INPUT_PORT');
    expect(resolveYoloClassName('LED')).toBe('OUTPUT_PORT');
    expect(resolveYoloClassName('Junction')).toBe('JUNCTION');
    expect(resolveYoloClassName('not-a-class')).toBeNull();
  });

  it('covers the transistor-first vocabulary', () => {
    expect(YOLO_CLASS_MAP.NMOS).toBe('nmos');
    expect(YOLO_CLASS_MAP.PMOS).toBe('pmos');
    expect(YOLO_CLASS_MAP.VDD).toBe('vsource');
    expect(YOLO_CLASS_MAP.GND).toBe('ground');
  });
});
