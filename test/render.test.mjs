import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel } from '../src/build.mjs';
import { render } from '../src/render.mjs';
import { estimateTokens } from '../src/tokens.mjs';
import { fixture } from './helpers.mjs';

test('render: all sections present at the default budget, no timestamp', async () => {
  const model = await buildModel(fixture('node-cli'));
  const { markdown, estimate, dropped } = render(model, { budget: 1500, version: '0.1.0' });
  for (const h of ['## Run & test', '## Entry points', '## Rules', '## Layout', '## Modules', '## Recent']) {
    assert.ok(markdown.includes(h), `has ${h}`);
  }
  assert.ok(markdown.startsWith('# widget-cli'), 'identity first');
  assert.ok(markdown.includes('node-cli'), 'kind shown');
  assert.ok(markdown.includes('`npm test`'), 'scripts rendered as commands');
  assert.ok(markdown.includes('src/scan.mjs'), 'modules listed');
  assert.ok(markdown.includes('scan, walk, Scanner'), 'exports listed in source order');
  assert.ok(markdown.includes('CLAUDE.md'), 'rules noticed');
  assert.ok(markdown.includes('API_KEY, PORT'), 'env keys listed');
  assert.ok(!markdown.includes('supersecret'), '.env never read');
  assert.ok(!/\b20\d\d-\d\d-\d\d/.test(markdown), 'no date in body');
  assert.ok(/fingerprint [0-9a-f]{8}/.test(markdown), 'short fingerprint in footer');
  assert.ok(markdown.includes('bearings 0.1.0'));
  assert.deepEqual(dropped, []);
  assert.ok(estimate <= 1500);
  assert.equal(estimate, estimateTokens(markdown));
});

test('render: budget honoured and degradation order followed', async () => {
  const model = await buildModel(fixture('node-cli'));
  const full = render(model, { budget: 0, version: '0.1.0' });
  assert.ok(full.estimate > 300, 'fixture map is bigger than the tight budget we will test');
  const tight = render(model, { budget: Math.floor(full.estimate * 0.6), version: '0.1.0' });
  assert.ok(tight.estimate <= Math.floor(full.estimate * 0.6));
  assert.equal(tight.dropped[0], 'modules', 'modules go first');
  assert.ok(!tight.markdown.includes('## Modules'));
  const tiny = render(model, { budget: 120, version: '0.1.0' });
  assert.ok(tiny.markdown.startsWith('# widget-cli'), 'identity survives');
  assert.ok(tiny.markdown.includes('fingerprint'), 'footer survives');
  assert.ok(tiny.dropped.includes('recent') && tiny.dropped.includes('layout-depth'));
});

test('render: byte-identical on a second build', async () => {
  const a = render(await buildModel(fixture('python-pkg')), { budget: 1500, version: '0.1.0' }).markdown;
  const b = render(await buildModel(fixture('python-pkg')), { budget: 1500, version: '0.1.0' }).markdown;
  assert.equal(a, b);
});

test('render: folder-of-projects lists subprojects instead of modules', async () => {
  const { markdown } = render(await buildModel(fixture('folder-of-projects')), { budget: 1500, version: '0.1.0' });
  assert.ok(markdown.includes('## Projects'));
  assert.ok(markdown.includes('alpha') && markdown.includes('node-web'));
  assert.ok(markdown.includes('beta') && markdown.includes('python-package'));
});

test('render: single-html names the file as the entry', async () => {
  const { markdown } = render(await buildModel(fixture('single-html')), { budget: 1500, version: '0.1.0' });
  assert.ok(markdown.includes('game.html'));
  assert.ok(markdown.includes('single-file-web'));
});
