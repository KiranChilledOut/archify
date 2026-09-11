import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const template = fs.readFileSync(path.join(skillRoot, 'assets/template.html'), 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-walkthrough-'));

const CASES = {
  architecture: { example: 'web-app.architecture.json', collection: 'components', relationships: 'connections' },
  workflow: { example: 'agent-tool-call.workflow.json', collection: 'nodes', relationships: 'edges' },
  sequence: { example: 'cache-miss-request.sequence.json', collection: 'participants', relationships: 'messages' },
  dataflow: { example: 'product-analytics.dataflow.json', collection: 'nodes', relationships: 'flows' },
  lifecycle: { example: 'agent-run.lifecycle.json', collection: 'states', relationships: 'transitions' },
};

function run(mode, doc, suffix) {
  const input = path.join(tmp, `${mode}-${suffix}.json`);
  const output = path.join(tmp, `${mode}-${suffix}.html`);
  fs.writeFileSync(input, JSON.stringify(doc));
  const result = spawnSync(process.execPath, [
    path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`), input, output,
  ], { encoding: 'utf8' });
  return { result, output, html: fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '' };
}

function fixture(mode) {
  return JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', CASES[mode].example), 'utf8'));
}

function svg(html) {
  return html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
}

function payload(html) {
  const match = html.match(/<script id="archify-walkthrough-data" type="application\/json">([\s\S]*?)<\/script>/);
  return match ? JSON.parse(match[1]) : null;
}

function withWalkthrough(mode) {
  const doc = fixture(mode);
  const config = CASES[mode];
  const ids = doc[config.collection].slice(0, 2).map((item) => item.id);
  const relationship = doc[config.relationships][0];
  doc.meta.walkthrough = {
    title: 'A short walk',
    flow: 'continuous',
    steps: [
      {
        id: 'first',
        title: 'The first thing that happens',
        clock: '12:00:00',
        body: 'Plain prose with **emphasis** and `code`.\n\nA second paragraph that mentions </script><script> safely.',
        notes: [{ title: 'Why it matters', body: 'A short teaching note.' }],
        focus: [ids[0]],
        edges: [`${relationship.from}~${relationship.to}`],
        state: ['one running'],
      },
      {
        id: 'second',
        title: 'The second thing',
        body: 'Only prose here.',
        focus: ids,
        dim: [],
        state: [],
      },
    ],
  };
  return doc;
}

for (const mode of Object.keys(CASES)) {
  test(`${mode}: a walkthrough preserves canonical SVG bytes and adds only viewer payload`, () => {
    const doc = withWalkthrough(mode);
    const plain = structuredClone(doc);
    delete plain.meta.walkthrough;
    const guided = run(mode, doc, 'walkthrough');
    const bare = run(mode, plain, 'plain');
    assert.equal(guided.result.status, 0, guided.result.stderr);
    assert.equal(bare.result.status, 0, bare.result.stderr);
    assert.equal(svg(guided.html), svg(bare.html), 'authored geometry must not change');
    assert.doesNotMatch(svg(guided.html), /walkthrough/, 'no walkthrough state in the canonical SVG');
    const data = payload(guided.html);
    assert.ok(data, 'walkthrough payload script present');
    assert.equal(data.steps.length, 2);
    assert.equal(data.steps[0].id, 'first');
    assert.doesNotMatch(guided.html, /<\/script><script>/, 'payload must be script-safe');
    assert.match(guided.html, /Archify\.walkthrough = \(function \(\)/);
    assert.match(guided.html, /id="walkthrough" hidden/);
    assert.match(guided.html, /id="btn-walkthrough" type="button" hidden/);
    assert.match(guided.html, /data-action="walkthrough-markdown" type="button" role="menuitem" tabindex="-1" hidden/);
    assert.equal(payload(bare.html), null, 'no payload without a walkthrough');
    assert.doesNotMatch(bare.html, /<!-- ARCHIFY:WALKTHROUGH_DATA -->/, 'the empty slot is removed');
  });

  test(`${mode}: walkthrough references are checked against authored nodes and relationships`, () => {
    const config = CASES[mode];
    const cases = [
      ['unknown focus', (doc) => { doc.meta.walkthrough.steps[0].focus.push('ghost'); }, /steps\/0\/focus\/1 references unknown semantic id "ghost"/],
      ['duplicate step id', (doc) => { doc.meta.walkthrough.steps[1].id = 'first'; }, /steps\/1\/id duplicates step id "first"/],
      ['unknown relationship id', (doc) => { doc.meta.walkthrough.steps[1].edges = ['nope']; }, /steps\/1\/edges\/0 references unknown relationship id "nope"/],
      ['unconnected pair', (doc) => {
        const ids = doc[config.collection].map((item) => item.id);
        const pairs = new Set(doc[config.relationships].map((r) => `${r.from}~${r.to}`));
        const missing = ids.flatMap((a) => ids.map((b) => `${a}~${b}`)).find((pair) => !pairs.has(pair));
        doc.meta.walkthrough.steps[1].edges = [missing];
      }, new RegExp(`no ${config.relationships} entry connects`)],
      ['unknown dim id', (doc) => { doc.meta.walkthrough.steps[1].dim = ['ghost']; }, /steps\/1\/dim\/0 references unknown semantic id "ghost"/],
    ];
    for (const [name, mutate, expected] of cases) {
      const doc = withWalkthrough(mode);
      mutate(doc);
      const { result } = run(mode, doc, `bad-${name.replace(/\s+/g, '-')}`);
      assert.notEqual(result.status, 0, `${name} must fail`);
      assert.match(result.stderr, /Walkthrough validation failed/, name);
      assert.match(result.stderr, expected, name);
    }
  });

  test(`${mode}: schema bounds the walkthrough shape`, () => {
    const cases = [
      ['extra step property', (doc) => { doc.meta.walkthrough.steps[0].colour = 'red'; }, /additional properties/],
      ['bad flow', (doc) => { doc.meta.walkthrough.flow = 'sometimes'; }, /flow/],
      ['malformed edge reference', (doc) => { doc.meta.walkthrough.steps[0].edges = ['a~b~c']; }, /pattern/],
      ['empty steps', (doc) => { doc.meta.walkthrough.steps = []; }, /steps/],
    ];
    for (const [name, mutate, expected] of cases) {
      const doc = withWalkthrough(mode);
      mutate(doc);
      const { result } = run(mode, doc, `schema-${name.replace(/\s+/g, '-')}`);
      assert.notEqual(result.status, 0, `${name} must fail`);
      assert.match(result.stderr, expected, name);
    }
  });
}

test('the viewer template carries the walkthrough contract once', () => {
  assert.equal(template.match(/Archify\.walkthrough = \(function \(\)/g).length, 1);
  assert.match(template, /\.walkthrough-flow-token \{\s*animation: archify-relationship-token-life var\(--walkthrough-flow-duration, 1\.6s\) linear infinite both;/);
  assert.match(template, /motion\.setAttribute\('repeatCount', 'indefinite'\)/, 'continuous flow loops the carrier');
  assert.match(template, /\.container\[data-walkthrough="open"\] \{\s*display: grid;/, 'the open panel lays out beside the stage');
  assert.match(template, /clone\.removeAttribute\('data-walkthrough-active'\)/, 'export cleanup strips walkthrough state');
  assert.match(template, /\[data-walkthrough-carrier-overlay\]'\), function \(el\) \{\s*el\.remove\(\);/, 'export cleanup removes carriers');
  assert.match(template, /if \(value === 'walkthrough'\) return viewerText\('viewer\.owner\.walkthrough'\)/, 'motion governor names the owner');
  assert.match(template, /e\.key === 'w' \|\| e\.key === 'W'/, 'W toggles the walkthrough');
  assert.match(template, /Archify\.walkthrough\.close\(\{ restoreFocus: true \}\)/, 'Escape closes an open walkthrough');
  assert.match(template, /a\.download = fileBase\(\) \+ '-walkthrough\.md'/, 'Markdown download is named after the diagram');
  assert.match(template, /Archify\.exportMenu\.run\('svg'\)/);
  assert.match(template, /Archify\.exportMenu\.run\('png'\)/);
  assert.match(template, /@media \(prefers-reduced-motion: reduce\) \{\s*\.walkthrough-flow-token \{ animation: none; opacity: 0; \}/);
  // The Governor rewrites data-motion on every render, including renders caused by
  // this module's own claim/release. Reacting to an unchanged value re-entered
  // renderCarriers forever on trace-capable diagrams and blocked page load.
  assert.match(template, /if \(!open \|\| refreshing\) return;\s*var key = motionStateKey\(\);\s*if \(key === lastMotionState\) return;/, 'motion observer must ignore unchanged rewrites');
  assert.match(template, /if \(refreshing\) return false;\s*refreshing = true;/, 'renderCarriers must be re-entrancy guarded');
  assert.match(template, /if \(Archify\.motionGovernor && Archify\.motionGovernor\.capable\) return !Archify\.motionGovernor\.isPaused\(\);\s*return true;/, 'flow consults the Governor only when it is capable');
});

test('the packaged queue-pipeline example validates at showcase and renders its walkthrough', () => {
  const result = spawnSync(process.execPath, [
    path.join(skillRoot, 'bin/archify.mjs'), 'validate', 'sequence',
    path.join(skillRoot, 'examples/queue-pipeline.sequence.json'), '--quality', 'showcase', '--json',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, true);
  const html = fs.readFileSync(path.join(skillRoot, 'examples/sequence-queue-pipeline.html'), 'utf8');
  const data = payload(html);
  assert.equal(data.steps.length, 6);
  assert.equal(data.flow, 'continuous');
});
