import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'dist', 'tesla-style-energy-flow.js'), 'utf8');

// line-grid-battery draws only the junction→battery leg, which line-solar-battery
// also covers, and it is declared after it in the SVG so it paints on top. Before
// the fix it was hardcoded to 'flow-broken', so a 0.8 kW grid trickle painted red
// over a 4.1 kW solar charge and the card looked like the grid was charging the
// battery. Both paths must stay inside the `if (!gridOutage)` guard.
assert.match(
  source,
  /const battCls = this\._dominantFlowClass\('battery', solarToBattery, 0, gridToBattery, 'flow-solar'\);\s*this\._activatePath\('line-grid-battery', battCls, gridToBattery, batteryMin\);/,
  'the shared junction→battery leg should be coloured by the dominant charger'
);

// Lift the two pure pieces out of the DOM-dependent class: the greedy source
// allocator and the dominant-colour picker.
function sliceBetween(from, to) {
  const start = source.indexOf(from);
  assert.notEqual(start, -1, `could not find "${from}" in the packaged bundle`);
  const end = source.indexOf(to, start);
  assert.notEqual(end, -1, `could not find "${to}" after "${from}"`);
  return source.slice(start, end + to.length);
}

const allocatorBody = sliceBetween(
  'const solarPos = Math.max(0, solarPower);',
  'const gridToBattery = Math.min(battChargeRemaining, gridImportRemaining);'
);

const allocate = new Function('inputs', `
  const { solarPower, loadPower, gridPower, batteryPower, evSceneActive, evPower, ev1, ev2 } = inputs;
  ${allocatorBody}
  return { solarToLoad, solarToBattery, gridToLoad, gridToBattery, battToLoad };
`);

const dominantBody = sliceBetween(
  '_dominantFlowClass(id, solarW, batteryW, gridW, fallback) {',
  '      return last;\n    }'
);

const { makeDominant } = new Function(`
  class Picker {
    constructor() { this._lastDominant = {}; }
    ${dominantBody}
  }
  return { makeDominant: () => new Picker() };
`)();

const noEv = { evSceneActive: false, evPower: 0, ev1: { power: 0 }, ev2: { power: 0 } };

// The reported case: solar 4.9 kW, home 0.8 kW, grid importing 0.8 kW, battery
// charging at 4.9 kW. Everything balances (4.9 + 0.8 in, 0.8 + 4.9 out).
const reported = allocate({
  solarPower: 4900,
  loadPower: 800,
  gridPower: 800,
  batteryPower: 4900,
  ...noEv
});

assert.equal(reported.solarToLoad, 800, 'solar covers the home load first');
assert.equal(reported.gridToLoad, 0, 'the grid has nothing left to give the home');
assert.equal(reported.solarToBattery, 4100, 'the solar surplus charges the battery');
assert.equal(reported.gridToBattery, 800, 'the grid tops up the rest of the charge');

assert.equal(
  makeDominant()._dominantFlowClass('battery', reported.solarToBattery, 0, reported.gridToBattery, 'flow-solar'),
  'flow-solar',
  '4.1 kW of solar should keep the battery leg yellow, not red from a 0.8 kW grid top-up'
);

// The opposite case must still read as a grid charge.
const gridCharging = allocate({
  solarPower: 1000,
  loadPower: 0,
  gridPower: 2000,
  batteryPower: 3000,
  ...noEv
});

assert.equal(gridCharging.solarToBattery, 1000);
assert.equal(gridCharging.gridToBattery, 2000);
assert.equal(
  makeDominant()._dominantFlowClass('battery', gridCharging.solarToBattery, 0, gridCharging.gridToBattery, 'flow-solar'),
  'flow-broken',
  'when the grid supplies most of the charge the leg should stay red'
);

// Hysteresis: a near-tie must not flip the leg colour every render.
const picker = makeDominant();
assert.equal(picker._dominantFlowClass('battery', 1000, 0, 900, 'flow-solar'), 'flow-solar');
assert.equal(
  picker._dominantFlowClass('battery', 900, 0, 1000, 'flow-solar'),
  'flow-solar',
  'a 11 % lead is under the 15 % stick margin, so the colour should hold'
);
assert.equal(
  picker._dominantFlowClass('battery', 500, 0, 1000, 'flow-solar'),
  'flow-broken',
  'a decisive grid lead should still win'
);

console.log('battery charge colour tests passed');
