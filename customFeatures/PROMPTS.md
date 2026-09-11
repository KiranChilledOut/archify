# Example prompts — one per diagram type

Paste any of these into an agent that has the Skill installed (Cursor, Claude Code, Codex
CLI, OpenCode). Each asks for a diagram **and** a walkthrough in one go. Swap in your own
system; keep the last paragraph — it is what turns a diagram into a presentation.

The companion spec each prompt would produce is in [`examples/`](./examples/), already
validated at `showcase` and delivered 9/9.

---

## Architecture — cloud / network / system design

> Draw an **architecture** diagram of our web platform: users reach CloudFront over HTTPS;
> static assets come from S3; everything else goes to a load balancer in front of API
> servers. The API verifies JWTs against the auth provider, reads through Redis to
> PostgreSQL, and enqueues slow jobs to SQS for a worker. Put the VPC resources inside a
> region boundary and the API + database inside a security-group boundary.
>
> Then add a **walkthrough** that follows one page view in three steps: the request landing
> at the edge, the API checking identity and reading through the cache, and slow work leaving
> through the queue. For each step highlight only the nodes and relationships involved, dim
> the components that are already done, add a short teaching note where a decision is
> non-obvious, and show state chips like "cache miss → SQL". Keep traffic flow continuous.

Companion: `examples/web-app.architecture.json`

## Workflow — flowchart / process / approval gates / CI-CD

> Draw a **workflow** (flowchart) of how our agent handles a user message: the chat surface
> hands the message to a planner, the planner routes to a tool router, the router asks an
> approval gate whether the tool is risky, approved calls reach the tool and an external API,
> denied calls are blocked and offered a retry path, and the external reply becomes the final
> answer while the result is recorded in a trace log with the context store's memory.
>
> Add a **walkthrough** with three steps — a message becomes a plan, risky tools stop at the
> gate, the tool calls out and evidence comes back. Light the edges each step actually uses,
> including the denied/retry branch in the gate step, dim the earlier nodes, and put the
> "why a gate and not a filter" reasoning in a note. Continuous flow.

Companion: `examples/agent-tool-call.workflow.json`

## Sequence — API call chain / request lifecycle / async trace

> Draw a **sequence** diagram of one record moving through a queue-driven stage: a scheduler
> fires a producer job; the producer enqueues a message that stays invisible for 30 seconds;
> a scaler polls queue depth and starts a worker; the worker peek-locks the message, claims a
> batch from the store, writes the result, completes the message, and enqueues the next stage.
> Use `column_fit: spread`.
>
> Turn it into a **walkthrough** of six reader-paced steps, one per hop, each with a clock
> stamp, the message ids it lights, a note explaining the queue feature involved (scheduled
> delivery, duplicate detection, peek-lock, dead-lettering) and state chips such as
> "depth 1" or "lock 5:00". Traffic flow should loop continuously on the active messages.

Companion: `examples/queue-pipeline.sequence.json`

## Dataflow — pipeline / ETL / lineage / governance

> Draw a **dataflow** of our product analytics: web clickstream and mobile events hit an edge
> API; the edge consults a consent gate for identity and permission; accepted events go to
> an event stream and the identity map goes to a PII vault; the stream lands normalized facts
> in the warehouse; the warehouse feeds daily aggregates to a feature store and metrics SQL to
> dashboards; the feature store feeds an ML model; the vault's only outbound path is a
> restricted join into dashboards.
>
> Add a **walkthrough** that follows one click from device to dashboard in three steps
> (collect, consent, serve). Highlight the flows each step uses, dim the producers once the
> data has passed them, and make the governance point in a note: personal data has one door.
> Continuous flow.

Companion: `examples/product-analytics.dataflow.json`

## Lifecycle — state machine / status transitions / retries

> Draw a **lifecycle** for an agent run: the main rail is queued → planning → executing →
> reviewing → completed. Off the rail: executing can need approval, and a refused approval
> cancels the run; executing can fail and retry back into executing; reviewing can be blocked,
> and a blocked run expires.
>
> Add a **walkthrough** in three steps: the main rail, the approval detour, and the
> difference between a recoverable failure and a terminal block. Highlight only the
> transitions each step is about, dim the rest, and use a note to say why "waiting" is a
> state and not a hang. Continuous flow.

Companion: `examples/agent-run.lifecycle.json`

---

## Adding a walkthrough to a diagram that already exists

> Here is an existing Archify JSON spec (attached). Do not change any node, relationship or
> geometry. Add `meta.walkthrough` with N steps that explain how traffic moves through it,
> in the order a request would experience it. Reference relationships by their authored `id`
> where one exists, otherwise by `from~to`. Validate at showcase and deliver; confirm the
> canonical SVG is unchanged.

## Grounding it in a real repository

> Read the code under `src/` and draw an **architecture** diagram of what actually deploys,
> with `meta.repository` pinned to the current commit and `sources` on each component. Then
> add a **walkthrough** of one inbound request and one outbound call, and in each step's
> note cite the file that implements that hop. Do not infer anything the code does not show.
