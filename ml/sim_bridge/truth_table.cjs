/**
 * @file truth_table.cjs
 * @description Node bridge from the Python evaluation harness (ml/eval_netlist.py) to DigiSim's own
 * simulator. Reads {"circuits": [{"id", "nodes", "edges"}]} as JSON on stdin (ReactFlow-shaped nodes and
 * edges), enumerates every combination of the circuit's `input` nodes, runs simulate() from
 * frontend/src/logic/simulation for each one, and writes {"<id>": {"inputs", "outputs", "rows"} | {"error"}}
 * to stdout. It contains no simulation logic itself (that lives only in src/logic/simulation/); it is a
 * driver. Needs `cd frontend && npm install` first (uses the transpiler bundled with react-scripts).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const FRONTEND_DIR = path.resolve(__dirname, '..', '..', 'frontend');
const MAX_INPUTS = 10;

/** Minimal in-memory localStorage: simulation modules read custom components from it. */
const memoryStorage = (() => {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
    clear: () => { store.clear(); },
  };
})();

/**
 * Load the simulation entry point by transpiling the TypeScript sources on the fly.
 * @returns {Function} simulate(nodes, edges, timeSeconds)
 */
function loadSimulate() {
  global.localStorage = memoryStorage;
  const sucraseRegister = require.resolve('sucrase/register', { paths: [FRONTEND_DIR] });
  require(sucraseRegister);
  return require(path.join(FRONTEND_DIR, 'src', 'logic', 'simulation', 'index.ts')).simulate;
}

/**
 * Truth table of one circuit, enumerating every assignment of its `input` nodes.
 * @param {Function} simulate - DigiSim simulate()
 * @param {{nodes: object[], edges: object[]}} circuit - ReactFlow-shaped circuit
 * @returns {{inputs: string[], outputs: string[], rows: Array<Array<string|number>>} | {error: string}}
 */
function truthTable(simulate, circuit) {
  const inputs = circuit.nodes.filter((n) => n.type === 'input').map((n) => n.id).sort();
  const outputs = circuit.nodes.filter((n) => n.type === 'output').map((n) => n.id).sort();
  if (inputs.length === 0 || outputs.length === 0) return { error: 'circuit needs at least one input and one output' };
  if (inputs.length > MAX_INPUTS) return { error: `more than ${MAX_INPUTS} inputs` };
  const rows = [];
  for (let mask = 0; mask < (1 << inputs.length); mask++) {
    const nodes = circuit.nodes.map((n) => {
      const bit = inputs.indexOf(n.id);
      const data = { ...(n.data || {}) };
      if (bit >= 0) data.value = (mask >> (inputs.length - 1 - bit)) & 1;
      return { ...n, position: n.position || { x: 0, y: 0 }, data };
    });
    const solved = simulate(nodes, circuit.edges);
    const byId = new Map(solved.map((n) => [n.id, n]));
    const bits = inputs.map((_, i) => (mask >> (inputs.length - 1 - i)) & 1);
    const outs = outputs.map((id) => {
      const v = byId.get(id) && byId.get(id).data.value;
      return v === undefined || v === null ? 'Z' : v;
    });
    rows.push([...bits, ...outs]);
  }
  return { inputs, outputs, rows };
}

/**
 * Entry point: stdin JSON in, stdout JSON out.
 * @returns {void}
 */
function main() {
  const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
  const warn = console.warn;
  console.warn = () => {};
  const simulate = loadSimulate();
  const result = {};
  for (const circuit of payload.circuits) {
    try {
      result[circuit.id] = truthTable(simulate, circuit);
    } catch (err) {
      result[circuit.id] = { error: String(err && err.message ? err.message : err) };
    }
  }
  console.warn = warn;
  process.stdout.write(JSON.stringify(result));
}

main();
