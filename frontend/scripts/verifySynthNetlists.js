/**
 * @file verifySynthNetlists.js
 * @description Checks every netlist written by backend/data_gen/generate_v2.py against
 * DigiSim's own switch-level CMOS solver (src/logic/simulation/switchLevel.ts). Transistor
 * netlists are simulated as drawn; gate-level netlists are first lowered to static CMOS
 * (NAND/NOR/INV templates, XOR from four NANDs). Every row of the reference truth table must
 * match with clean 0/1 outputs. switchLevel.ts is transpiled in memory with the frontend's
 * TypeScript compiler, so the check always runs the shipped solver code.
 *
 * Usage: node frontend/scripts/verifySynthNetlists.js <dataset-dir> [--json report.json]
 * Exit code 0 when 100% of netlists pass, 1 otherwise.
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

/**
 * Load switchLevel.ts as a CommonJS module.
 * @returns The module exports ({ solveSwitchNets, ... })
 */
function loadSolver() {
  const file = path.join(__dirname, '..', 'src', 'logic', 'simulation', 'switchLevel.ts');
  const source = fs.readFileSync(file, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
    fileName: file,
  });
  const mod = new Module(file, module);
  mod.filename = file;
  mod.paths = Module._nodeModulePaths(path.dirname(file));
  mod._compile(outputText, file);
  return mod.exports;
}

/**
 * Recursively list netlist JSON files under a directory.
 * @param dir - Directory to scan
 * @returns Sorted absolute paths of *.json files
 */
function listNetlists(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listNetlists(full));
    else if (entry.name.endsWith('.json')) out.push(full);
  }
  return out.sort();
}

/** Handle prefix and terminal names per node type, as the canvas uses them. */
const HANDLE = {
  nmos: (t) => `t:${t}`,
  pmos: (t) => `t:${t}`,
  vsource: (t) => `s:${t}`,
  ground: () => 't:gnd',
  input: () => null,
  output: () => null,
};

/**
 * Lower one gate instance to static CMOS transistors.
 * @param gate - Netlist component of a gate class
 * @param fresh - Generator of unique internal net names
 * @returns List of { type, pins } transistor records
 */
function lowerGate(gate, fresh) {
  const { a, b, out } = gate.pins;
  const inv = (x, y) => [
    { type: 'pmos', pins: { s: 'VDD', g: x, d: y } },
    { type: 'nmos', pins: { d: y, g: x, s: 'GND' } },
  ];
  const nand = (x, y, z) => {
    const m = fresh();
    return [
      { type: 'pmos', pins: { s: 'VDD', g: x, d: z } },
      { type: 'pmos', pins: { s: 'VDD', g: y, d: z } },
      { type: 'nmos', pins: { d: z, g: x, s: m } },
      { type: 'nmos', pins: { d: m, g: y, s: 'GND' } },
    ];
  };
  const nor = (x, y, z) => {
    const m = fresh();
    return [
      { type: 'pmos', pins: { s: 'VDD', g: x, d: m } },
      { type: 'pmos', pins: { s: m, g: y, d: z } },
      { type: 'nmos', pins: { d: z, g: x, s: 'GND' } },
      { type: 'nmos', pins: { d: z, g: y, s: 'GND' } },
    ];
  };
  const xor = (x, y, z) => {
    const n1 = fresh();
    const n2 = fresh();
    const n3 = fresh();
    return [...nand(x, y, n1), ...nand(x, n1, n2), ...nand(y, n1, n3), ...nand(n2, n3, z)];
  };
  const t = fresh();
  switch (gate.class) {
    case 'NOT': return inv(a, out);
    case 'NAND': return nand(a, b, out);
    case 'NOR': return nor(a, b, out);
    case 'AND': return [...nand(a, b, t), ...inv(t, out)];
    case 'OR': return [...nor(a, b, t), ...inv(t, out)];
    case 'XOR': return xor(a, b, out);
    case 'XNOR': return [...xor(a, b, t), ...inv(t, out)];
    default: throw new Error(`cannot lower class ${gate.class}`);
  }
}

/**
 * Build canvas nodes/edges for one input assignment.
 * @param netlist - Parsed netlist JSON
 * @param assignment - Input values by port name
 * @returns { nodes, edges, outputIds } where outputIds maps output name to node id
 */
function buildCircuit(netlist, assignment) {
  const nodes = [];
  const terminals = new Map(); // net -> [{ id, handle }]
  const attach = (net, id, handle) => {
    if (!terminals.has(net)) terminals.set(net, []);
    terminals.get(net).push({ id, handle });
  };
  const addNode = (id, type, pins, value) => {
    nodes.push({ id, type, position: { x: 0, y: 0 }, data: { label: id, value } });
    for (const [term, net] of Object.entries(pins)) {
      // Bulk terminals are ignored by the solver (autoBulk); an edge from one would be dropped.
      if ((type === 'nmos' || type === 'pmos') && term === 'b') continue;
      attach(net, id, HANDLE[type](term));
    }
  };
  const outputIds = {};
  let counter = 0;
  const fresh = () => `__lowered_${counter++}`;
  let needsSupplies = false;
  for (const comp of netlist.components) {
    switch (comp.class) {
      case 'NMOS':
      case 'PMOS':
        addNode(comp.id, comp.node_type, comp.pins);
        break;
      case 'VDD':
        addNode(comp.id, 'vsource', comp.pins);
        break;
      case 'GND':
        addNode(comp.id, 'ground', comp.pins);
        break;
      case 'INPUT_PORT':
        addNode(comp.id, 'input', comp.pins, assignment[comp.label]);
        break;
      case 'OUTPUT_PORT':
        addNode(comp.id, 'output', comp.pins, 0);
        outputIds[comp.label] = comp.id;
        break;
      default: {
        needsSupplies = true;
        lowerGate(comp, fresh).forEach((tr, i) => addNode(`${comp.id}__${i}`, tr.type, tr.pins));
      }
    }
  }
  if (needsSupplies) {
    addNode('__vdd', 'vsource', { pos: 'VDD' });
    addNode('__gnd', 'ground', { gnd: 'GND' });
  }
  const edges = [];
  for (const [net, list] of terminals) {
    for (let i = 1; i < list.length; i++) {
      edges.push({
        id: `${net}#${i}`,
        source: list[0].id,
        sourceHandle: list[0].handle,
        target: list[i].id,
        targetHandle: list[i].handle,
      });
    }
  }
  return { nodes, edges, outputIds };
}

/**
 * Check one netlist against its truth table.
 * @param netlist - Parsed netlist JSON
 * @param solver - switchLevel module exports
 * @returns null when every row matches, else a failure description
 */
function checkNetlist(netlist, solver) {
  for (const row of netlist.truth_table) {
    const { nodes, edges, outputIds } = buildCircuit(netlist, row.in);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const solved = solver.solveSwitchNets(nodes, edges, byId);
    for (const [name, expected] of Object.entries(row.out)) {
      const got = solver.switchRootValue(solved, outputIds[name]);
      if (got !== expected) return `in=${JSON.stringify(row.in)} ${name}: expected ${expected}, got ${got}`;
    }
  }
  return null;
}

/**
 * CLI entry point.
 * @returns Process exit code
 */
function main() {
  const args = process.argv.slice(2);
  const dir = args[0];
  if (!dir) {
    console.error('usage: node verifySynthNetlists.js <dataset-dir> [--json report.json]');
    return 2;
  }
  const jsonIdx = args.indexOf('--json');
  const solver = loadSolver();
  // A dataset root also holds annotation JSON, so scan only its netlists/ subtree when present.
  const netlistDir = path.join(dir, 'netlists');
  const files = listNetlists(fs.existsSync(netlistDir) ? netlistDir : dir);
  const failures = [];
  const byDomain = {};
  for (const file of files) {
    const netlist = JSON.parse(fs.readFileSync(file, 'utf8'));
    const d = (byDomain[netlist.domain] = byDomain[netlist.domain] || { total: 0, passed: 0 });
    d.total += 1;
    let problem;
    try {
      problem = checkNetlist(netlist, solver);
    } catch (err) {
      problem = `error: ${err.message}`;
    }
    if (problem) failures.push({ file: path.relative(dir, file), problem });
    else d.passed += 1;
  }
  const report = { total: files.length, passed: files.length - failures.length, by_domain: byDomain, failures };
  if (jsonIdx >= 0) fs.writeFileSync(args[jsonIdx + 1], `${JSON.stringify(report, null, 2)}\n`);
  console.log(`switch-level truth-table check: ${report.passed}/${report.total} netlists pass ${JSON.stringify(byDomain)}`);
  failures.slice(0, 20).forEach((f) => console.log(`  FAIL ${f.file}: ${f.problem}`));
  return files.length > 0 && failures.length === 0 ? 0 : 1;
}

process.exitCode = main();
