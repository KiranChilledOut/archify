# Custom features in this fork

This is a fork of [tt-a1i/archify](https://github.com/tt-a1i/archify). Everything upstream
does, this does. It adds **one** feature that upstream does not have:

## Walkthrough — present a diagram step by step, with live traffic flow

Upstream's Guided Views tell a *story*: up to five chapters, 140-character notes, autoplay,
camera handoff. That is built for a reader exploring alone.

A **walkthrough** is built for a presenter explaining to a room:

| | Guided Views (upstream) | Walkthrough (this fork) |
|---|---|---|
| Steps | ≤ 5 chapters | ≤ 40 steps |
| Text per step | 140-char note | Prose body, multiple paragraphs, plus titled teaching notes and state chips |
| Where it lives | Rail above the diagram | Side panel beside the diagram, sticky, works in Present mode |
| Motion | One pulse per beat, autoplay | **Continuous looping carriers** on every relationship the step names, reader-paced |
| What lights up | Focus nodes | Focus nodes **and** named relationships; everything else dims; optional `dim` list |
| Takeaway | Share links | **Markdown transcript** of every step, plus the ordinary SVG/PNG export |
| Navigation | Chapter rail, `[` `]` | Prev/Next, pips, `←` `→`, `W` toggles, `#walk=<step>` deep links |

Both coexist on the same diagram. Opening the walkthrough pauses a playing story.

### What it never does

- It never adds topology. Every `focus`, `dim` and `edges` entry must name a node or
  relationship the diagram already authored — otherwise validation fails with
  `walkthrough/invalid` and a path-prefixed message.
- It never changes the canonical SVG. A diagram with a walkthrough renders **byte-identical**
  SVG to the same diagram without one; the walkthrough is viewer payload only.
- It never leaks into exports. SVG/PNG/share cards are cleaned of walkthrough state; the
  export receipt reports `canonical: true` even while the panel is open.

## Quick start

```bash
# validate, then deliver a self-contained HTML
node archify/bin/archify.mjs validate sequence customFeatures/examples/queue-pipeline.sequence.json --quality showcase
node archify/bin/archify.mjs deliver  sequence customFeatures/examples/queue-pipeline.sequence.json walkthrough.html --quality showcase
```

Open `walkthrough.html`, press **W** (or the toolbar button), then **→**.
Append `#walk=<stepId>` to a URL to open on a specific step; add `?present=1` for a full-height stage.

## Authoring

Add `meta.walkthrough` to any of the five diagram types:

```json
"walkthrough": {
  "title": "One record through a queue-driven stage",
  "flow": "continuous",
  "steps": [
    {
      "id": "claim",
      "title": "The store says what the work actually is",
      "clock": "12:00:46",
      "body": "Paragraphs separated by a blank line. Inline marks are **strong** and `code` only.",
      "notes": [{ "title": "Where the guarantee lives", "body": "A short teaching note." }],
      "focus": ["worker", "store"],
      "edges": ["claim", "store~worker"],
      "dim": ["cron"],
      "state": ["lock 5:00", "1 row claimed"]
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `flow` | `continuous` (default) loops carriers; `step` runs one pass per step; `off` highlights only |
| `focus` | Node ids to keep vivid (`components` / `nodes` / `participants` / `states`) |
| `edges` | Relationships to light and animate — an authored relationship `id`, or `from~to` |
| `dim` | Node ids to fade further, e.g. a container that has already exited |
| `state` | Short chips shown under the prose, e.g. what is running and what it costs |
| `clock` | Free text shown beside the step counter — a timestamp, a phase, a ticket id |

Prompts you can hand to an agent are in [`PROMPTS.md`](./PROMPTS.md). One validated example
per diagram type is in [`examples/`](./examples/).

## Where the code is

| Layer | Files |
|---|---|
| Schema | `archify/schemas/common.schema.json` (`walkthrough`, `walkthroughStep`, `walkthroughNote`), referenced from all five `*.schema.json` |
| Validation | `archify/renderers/shared/cli.mjs` → `validateWalkthrough` |
| Payload | `archify/renderers/shared/utils.mjs` → `applyTemplate` injects `#archify-walkthrough-data` |
| Viewer | `viewer/walkthrough.js` at marker `/* ARCHIFY:WALKTHROUGH */`, panel markup and CSS in `viewer/template.source.html` |
| Cleanup | `viewer/export-cleanup.js`, `viewer/motion-governor.js` (`walkthrough` owner) |
| i18n | `archify/renderers/shared/i18n.mjs` (`viewer.walkthrough.*`, en + zh-CN) |
| Tests | `archify/test/walkthrough.test.mjs`, `archify/test/walkthrough-browser.test.mjs` (needs `ARCHIFY_CHROME`) |

Contracts are documented in `viewer/README.md` (Walkthrough contract),
`archify/references/viewer-runtime.md` and `archify/schemas/README.md`.
