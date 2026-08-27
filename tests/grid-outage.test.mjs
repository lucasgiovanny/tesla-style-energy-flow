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

// The status word takes over the grid label's row (which the scene profiles keep
// inside the viewBox) instead of hanging a third line under the kW value.
assert.match(
  source,
  /status\.setAttribute\('x', label\?\.getAttribute\('x'\)[\s\S]*status\.setAttribute\('y', String\(safeNum\(label\?\.getAttribute\('y'\)/,
  'the outage word should be positioned on the grid label row'
);
assert.match(
  source,
  /if \(label\) label\.style\.display = kind \? 'none' : '';/,
  'the plain grid caption should be hidden while the outage word occupies its row'
);
assert.match(
  source,
  /#flow-grid-status\.outage-visible,[\s\S]*font-size: calc\(10px \* var\(--flow-font-scale\)\);/,
  'the outage word should use the grid label type size'
);

// The outage word is a first-class, draggable component in the visual position
// editor: bound to scene_component_map, listed in the Grid group, with its own
// drag kind so it moves independently of the label/value column.
assert.match(
  source,
  /'grid-status': Object\.freeze\(\{ id: 'flow-grid-status', attrs: Object\.freeze\(\['x', 'y'\]\) \}\),/,
  'grid-status should be a positionable flow component'
);
assert.match(
  source,
  /title: 'Grid'[^}]*status: 'grid-status'/,
  "the position editor's Grid group should expose the outage word"
);
assert.match(
  source,
  /kind === 'status'[\s\S]*_positionStatusDragValues\(sceneKey, group\)/,
  'the outage word should have its own drag handler in the position editor'
);
assert.match(
  source,
  /if \(group && \(group\.status === componentKey \|\| group\.marker === componentKey\)\) return \[\{ componentKey, attr, value \}\];/,
  "the outage word and the X must not drag the label/value column with them"
);

// The outage X is draggable too, defaulting to the grid line's endpoint until it
// is pinned per scene.
assert.match(
  source,
  /title: 'Grid'[^}]*marker: 'grid-marker'/,
  "the position editor's Grid group should expose the outage X"
);
assert.match(
  source,
  /kind === 'marker'[\s\S]*_positionMarkerDragValues\(sceneKey, group\)/,
  'the outage X should have its own drag handler in the position editor'
);
assert.match(
  source,
  /_positionMarkerPoint\(sceneKey, group\) \{[\s\S]*_positionScenePathStart\(sceneKey, 'line-grid-load'\)/,
  'an un-dragged X should preview at the grid line endpoint the card uses'
);
assert.match(
  source,
  /const placed = this\._configuredGridComponent\('grid-marker'\);[\s\S]*marker\.setAttribute\('transform', `translate\(\$\{px\}, \$\{py\}\)`\);/,
  'a pinned X should win over the line endpoint in the card'
);
assert.match(
  source,
  /if \(this\._configuredGridStatusPosition\(\)\) return;/,
  'a hand-placed outage word should never be auto-nudged'
);

// Without an explicit override the word tracks the grid label, so a customised
// grid column keeps it in the same column.
assert.match(
  source,
  /_configuredGridComponent\(componentKey\) \{[\s\S]*this\._config\.scene_component_map\?\.\[sceneKey\][\s\S]*scene\?\.\[componentKey\]/,
  'an explicit scene_component_map entry should win over the automatic placement'
);

// The word never sits on top of the outage X.
assert.match(
  source,
  /_clearOutageWordFromMarker\(status, x, y\);/,
  'the outage word should be pushed clear of the X after the marker is placed'
);

// With a dynamic background the rendered scene is not the configured one, so the
// card publishes what it draws and the editor opens on that scene — otherwise
// every drag lands in a scene the user cannot see.
assert.match(
  source,
  /RENDERED_SCENE_BY_CONFIG\.set\(configSceneFingerprint\(this\._config\), marker\);/,
  'the card should publish the scene profile it is rendering'
);
assert.match(
  source,
  /_selectedPositionScene\(\) \{[\s\S]*this\._positionSceneKey\s*\|\|\s*this\._liveSceneKey\s*\|\|\s*sceneFileName\(this\._config\.background\)/,
  'the editor should prefer a manual pick, then the live scene, then the background'
);
assert.match(
  source,
  /this\._activeSceneComponentKey = marker;/,
  'the active scene key must be tracked even when no attribute changed'
);
assert.match(
  source,
  /const sceneKey = this\._activeSceneComponentKey \|\| this\._lastAppliedSceneFlowComponentProfile;/,
  'grid overrides should be read from the actively rendered scene'
);

// One scene's layout can be pushed onto every scene at once.
assert.match(
  source,
  /_copyScenePositionsToAll\(srcSceneKey\) \{[\s\S]*POSITION_EDITOR_SCENES\.forEach[\s\S]*AUTOMATIC_POSITION_COMPONENTS\.forEach/,
  'copy-to-all should fan the source scene out and reset automatic components'
);
assert.match(
  source,
  /button\[data-copy-positions-all\][\s\S]*_copyScenePositionsToAll\(source\)/,
  'the Apply to all button should be wired to the copy-to-all helper'
);

// The status word appears with a per-kind label.
assert.match(
  source,
  /_updateGridOutageMarker\(kind\) \{[\s\S]*'card\.status\.grid_outage'[\s\S]*'card\.status\.off_grid'[\s\S]*'card\.status\.disconnected'[\s\S]*getPointAtLength\(0\)[\s\S]*marker\.setAttribute\('transform', `translate\(\$\{x\}, \$\{y\}\)`\);/,
  'the marker update should set a per-kind status word and re-anchor the X to line-grid-load'
);

// The editor dropdown must list text-state sensors (Tesla's grid status has
// no device_class and often no "grid" in the entity_id), not only
// binary_sensors and enum/grid-named sensors.
assert.match(
  source,
  /const gridStatusIds = [\s\S]*if \(domain === 'binary_sensor'\) return true;[\s\S]*return !Number\.isFinite\(parseFloat\(st\?\.state\)\);/,
  'the grid status dropdown should include any non-numeric-state sensor'
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
