import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'dist', 'tesla-style-energy-flow.js'), 'utf8');

// Lift the pure state-classification helper out of the DOM-dependent IIFE.
function sliceBalanced(marker, open, close) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `could not find "${marker}" in the packaged bundle`);
  const from = source.indexOf(open, start);
  assert.notEqual(from, -1, `could not find "${open}" after "${marker}"`);
  let depth = 0;
  for (let i = from; i < source.length; i += 1) {
    if (source[i] === open) depth += 1;
    else if (source[i] === close) {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced "${open}" after "${marker}"`);
}

const { isGridOutageState } = new Function(`
  ${sliceBalanced('function isGridOutageState(', '{', '}')}
  return { isGridOutageState };
`)();

const outage = (state) => isGridOutageState({ state });

// Powerwall integration binary_sensor: on = grid connected, off = outage.
assert.equal(outage('off'), true);
assert.equal(outage('on'), false);

// Teslemetry / Tesla Fleet island status enum sensor.
assert.equal(outage('on_grid'), false);
assert.equal(outage('off_grid'), true);
assert.equal(outage('off_grid_intentional'), true);
assert.equal(outage('off_grid_unintentional'), true);
assert.equal(outage('island_status_unknown'), false);

// Local Powerwall API / logbook-style textual states.
assert.equal(outage('Connected'), false);
assert.equal(outage('Disconnected'), true);
assert.equal(outage('Disconnected intentionally'), true);
assert.equal(outage('Islanded'), true);
assert.equal(outage('SystemIslandedActive'), true);
assert.equal(outage('outage'), true);

// A missing or flaky sensor must never paint a false outage.
assert.equal(isGridOutageState(null), false);
assert.equal(outage(''), false);
assert.equal(outage('unknown'), false);
assert.equal(outage('unavailable'), false);

// The outage X must exist in the static SVG and stay hidden by default.
assert.match(
  source,
  /<g id="grid-outage-marker" class="grid-outage-marker" transform="translate\(434, 402\)">/,
  'static render should include the grid outage X anchored at the default grid connection point'
);
assert.match(
  source,
  /\.grid-outage-marker \{\s*display: none;\s*\}/,
  'the outage X should be hidden until the grid status entity reports an outage'
);

// The marker follows the scene-specific grid line geometry.
assert.match(
  source,
  /_updateGridOutageMarker\(outage\) \{[\s\S]*getPointAtLength\(0\)[\s\S]*marker\.setAttribute\('transform', `translate\(\$\{x\}, \$\{y\}\)`\);/,
  'the outage X should be re-anchored to the grid-side endpoint of line-grid-load on every render'
);

// grid_status must be part of the config schema and the tracked-entity list.
assert.match(source, /grid_status: '',/, 'DEFAULT_CONFIG.entities should include grid_status');
assert.match(
  source,
  /e\.grid_power, e\.grid_import_power, e\.grid_export_power, e\.grid_status,/,
  'grid_status changes should trigger a re-render via the tracked entity list'
);

// While off-grid no flow may animate through the X.
assert.match(
  source,
  /if \(!gridOutage\) \{[\s\S]*this\._activatePath\('line-grid-load', 'flow-broken', gridImportVisual, gridMin\);/,
  'grid import/export flow lines should stay dark during an outage'
);
assert.match(
  source,
  /if \(!gridOutage\) \{\s*this\._activatePath\('line-grid-battery', 'flow-broken', gridToBattery, batteryMin\);/,
  'grid-to-battery and solar-to-grid flow lines should stay dark during an outage'
);
assert.match(
  source,
  /this\._toggleNode\('#node-grid-bg', !gridOutage && Math\.abs\(gridPower\) > gridMin\);/,
  'the grid node dot should not light up during an outage'
);

console.log('grid outage tests passed');
