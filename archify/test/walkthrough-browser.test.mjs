import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const chromePath = process.env.ARCHIFY_CHROME ? findChrome() : null;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-walkthrough-browser-'));

// The Agent workflow example is trace-capable, so its Motion Governor is real and
// rewrites data-motion on every render. The sequence example is not, so its
// Governor is the always-paused stub. A walkthrough must load and run on both.
const CASES = [
  { mode: 'workflow', example: 'agent-tool-call.workflow.json', trace: true },
  { mode: 'sequence', example: 'queue-pipeline.sequence.json', trace: false },
];

function withWalkthrough(mode, example) {
  const doc = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', example), 'utf8'));
  if (!doc.meta.walkthrough) {
    const [a, b] = doc.edges;
    doc.meta.walkthrough = {
      flow: 'continuous',
      steps: [
        { id: 'first', title: 'First hop', body: 'The first authored relationship.', focus: [a.from, a.to], edges: [`${a.from}~${a.to}`] },
        { id: 'second', title: 'Second hop', body: 'The second authored relationship.', focus: [b.from, b.to], edges: [`${b.from}~${b.to}`], dim: [a.from] },
      ],
    };
  }
  const input = path.join(tmp, `${mode}.json`);
  const output = path.join(tmp, `${mode}.html`);
  fs.writeFileSync(input, JSON.stringify(doc));
  const result = spawnSync(process.execPath, [path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`), input, output], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return { output, stepId: doc.meta.walkthrough.steps[1].id };
}

async function evaluate(browser, sessionId, expression, awaitPromise = false) {
  const response = await browser.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }, sessionId);
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'browser evaluation failed');
  }
  return response.result?.value;
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} did not complete within ${ms}ms`)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

test('a walkthrough opens from its hash, loops carriers, exports canonically and closes clean on trace and non-trace diagrams', {
  skip: chromePath ? false : 'set ARCHIFY_CHROME to run the browser check',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    for (const { mode, example, trace } of CASES) {
      const { output, stepId } = withWalkthrough(mode, example);
      const sessionId = await browser.sessionPromise;
      await browser.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
      const loaded = browser.cdp.waitFor('Page.loadEventFired', sessionId);
      await browser.cdp.send('Page.navigate', { url: `${pathToFileURL(output).href}#walk=${stepId}` }, sessionId);
      // A blocked main thread never fires load; the previous observer feedback
      // loop failed exactly here on trace-capable diagrams.
      await withTimeout(loaded, 15000, `${mode}: page load`);
      await withTimeout(evaluate(browser, sessionId, `new Promise(function (resolve) {
        requestAnimationFrame(function () { requestAnimationFrame(function () { resolve(true); }); });
      })`, true), 5000, `${mode}: first frames`);

      const state = await evaluate(browser, sessionId, `(function () {
        var svg = document.querySelector('.diagram-container svg');
        return {
          capable: !!(Archify.motionGovernor && Archify.motionGovernor.capable),
          open: Archify.walkthrough.isOpen(),
          active: Archify.walkthrough.active(),
          carriers: svg.querySelectorAll('[data-walkthrough-carrier-token]').length,
          loops: svg.querySelectorAll('animateMotion[repeatCount="indefinite"]').length,
          onEdges: svg.querySelectorAll('[data-walkthrough-edge="on"]').length,
          onNodes: svg.querySelectorAll('[data-walkthrough-node="on"]').length,
          flow: document.getElementById('walkthrough-flow').textContent,
          owner: document.documentElement.getAttribute('data-motion-owner'),
          shell: document.querySelector('.container').getAttribute('data-walkthrough'),
        };
      })()`);
      assert.equal(state.capable, trace, `${mode}: governor capability`);
      assert.equal(state.open, true, `${mode}: opened from hash`);
      assert.equal(state.active, stepId, `${mode}: active step`);
      assert.equal(state.shell, 'open', `${mode}: shell layout state`);
      assert.ok(state.onEdges >= 1 && state.onNodes >= 2, `${mode}: step marks ${JSON.stringify(state)}`);
      assert.ok(state.carriers >= 2, `${mode}: looping carriers ${JSON.stringify(state)}`);
      assert.equal(state.loops, state.carriers, `${mode}: every carrier loops`);
      assert.match(state.flow, /live/i, `${mode}: flow status`);
      if (trace) assert.equal(state.owner, 'walkthrough', `${mode}: governor owner`);

      const md = await evaluate(browser, sessionId, `Archify.walkthrough.markdown()`);
      assert.match(md, /^## Step 1 — /m);
      assert.match(md, /^## Step 2 — /m);

      const receipt = await withTimeout(evaluate(browser, sessionId, `Archify.exportMenu.run('svg').then(function () {
        var h = document.documentElement;
        return { format: h.getAttribute('data-last-export-format'), canonical: h.getAttribute('data-last-export-canonical'), error: h.getAttribute('data-last-export-error') };
      })`, true), 15000, `${mode}: svg export`);
      assert.deepEqual(receipt, { format: 'svg', canonical: 'true', error: null }, `${mode}: export stays canonical while open`);

      const closed = await evaluate(browser, sessionId, `(function () {
        Archify.walkthrough.close();
        var svg = document.querySelector('.diagram-container svg');
        return {
          open: Archify.walkthrough.isOpen(),
          residue: svg.querySelectorAll('[data-walkthrough-node], [data-walkthrough-edge], [data-walkthrough-carrier-overlay]').length + (svg.hasAttribute('data-walkthrough-active') ? 1 : 0),
          owner: document.documentElement.getAttribute('data-motion-owner'),
          hash: location.hash,
        };
      })()`);
      assert.deepEqual(closed, { open: false, residue: 0, owner: null, hash: '' }, `${mode}: clean close`);
    }
  } finally {
    await browser.close();
  }
});
