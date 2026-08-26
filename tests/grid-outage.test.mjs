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

const { gridOutageKind } = new Function(`
  ${sliceBalanced('function gridOutageKind(', '{', '}')}
  return { gridOutageKind };
`)();

const kind = (state) => gridOutageKind({ state });

// Powerwall integration binary_sensor: on = grid connected, off = outage
// with unknown intent.
assert.equal(kind('off'), 'disconnected');
assert.equal(kind('on'), '');

// Teslemetry / Tesla Fleet island status enum sensor.
assert.equal(kind('on_grid'), '');
assert.equal(kind('off_grid'), 'disconnected');
assert.equal(kind('off_grid_intentional'), 'intentional');
assert.equal(kind('off_grid_unintentional'), 'unintentional');
assert.equal(kind('island_status_unknown'), '');

// Local Powerwall API / logbook-style textual states.
assert.equal(kind('Connected'), '');
assert.equal(kind('Disconnected'), 'disconnected');
assert.equal(kind('Disconnected intentionally'), 'intentional');
assert.equal(kind('Islanded'), 'disconnected');
assert.equal(kind('SystemIslandedActive'), 'disconnected');
assert.equal(kind('outage'), 'unintentional');

// A missing or flaky sensor must never paint a false outage.
assert.equal(gridOutageKind(null), '');
assert.equal(kind(''), '');
assert.equal(kind('unknown'), '');
assert.equal(kind('unavailable'), '');

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

// Severity styling: orange X by default, red for an actual grid failure.
assert.match(
  source,
  /\.grid-outage-marker\.outage-unintentional line \{\s*stroke: #ff5d73;/,
  'an unintentional outage should turn the X red'
);
assert.match(
  source,
  /#flow-grid-status\.outage-visible\.outage-unintentional,[\s\S]*fill: #ff5d73 !important;/,
  'the outage status word should turn red for an unintentional outage'
);

// The status word appears under the grid kW value with a per-kind label.
assert.match(
  source,
  /_updateGridOutageMarker\(kind\) \{[\s\S]*'card\.status\.grid_outage'[\s\S]*'card\.status\.off_grid'[\s\S]*'card\.status\.disconnected'[\s\S]*getPointAtLength\(0\)[\s\S]*marker\.setAttribute\('transform', `translate\(\$\{x\}, \$\{y\}\)`\);/,
  'the marker update should set a per-kind status word and re-anchor the X to line-grid-load'
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
