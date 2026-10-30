# Responsibilities

A BB plugin for people who run many agent threads at once. It marks the threads that need you, highlights the threads you treat as managers, filters the whole thread list, and adds **New child thread** to the thread actions.

![Responsibilities in BB with synthetic example threads](assets/responsibilities.png)

## Install

Requires BB 0.47.1 or later with its standard sidebar. The plugin uses experimental BB APIs and internal sidebar attributes; a future BB update or a replacement sidebar may affect it.

For the published 0.1.0 release:

```sh
bb plugin install npm:bb-plugin-responsibilities@0.1.0 --yes
```

To update an existing installation, use `bb plugin update responsibilities`. The npm command above is a release target until 0.1.0 is published.

The plugin's stable ID is `responsibilities`. No external account or service is needed.

## Marks

On the right of each thread row:

- a red ✕ — the thread failed;
- an amber ? — it waits for your answer or approval;
- a dot — it holds a result you have not seen yet, alone or in the corner of BB's own glyph.

A collapsed parent shows the failure and the dot of its hidden descendants.

BB itself marks only top-level threads unread. The plugin also tracks subthreads. A result is the last non-empty assistant message of a finished run. It counts as seen once the thread is open in a visible, focused window. BB's own read state is not changed.

## Filter

The filter button in the sidebar footer narrows the whole list to one kind of thread:

- **All** — no filter;
- **Working** — a turn is running, or a workflow, background agent or background command it started is still alive. A thread waiting for you is not working;
- **Needs you** — the threads with a mark: failed, waiting for your answer, a failed queued message, or an unread result;
- **Quiet** — neither working nor needing you;
- **Managers** — the threads listed in the managers file.

A match keeps its parents, so it stays in its place in the tree. The open thread always stays visible. Your sections and projects without a match hide while the filter is on, collapsed or not. BB's own Pinned and Threads headers stay, and so does a collapsed environment group with the list item around it: BB neither mounts its rows nor names them on screen, so expand it to filter inside. The filter changes no saved order, section or collapse state, and the button turns the accent color while a filter is on. The choice is kept per device. If the button is in **More footer actions**, use **Customize footer** to move it into view.

## Managers

Set **Managers file** in the plugin settings to an absolute path of a JSON file:

```json
{ "managers": [{ "threadId": "thr_demo_lead" }] }
```

Replace the example ID with your own thread ID. This file is optional; leave the setting empty to turn manager highlighting off. No management service or registry is required. Other fields are ignored. Listed threads get a bold, brighter title and appear under the Managers filter. If such a title starts with `○ `, the row hides that marker; the stored title, tooltip and accessible name keep it. The plugin reloads the list when the file changes.

## New child thread

The thread actions get **New child thread**. It opens BB's own composer and files the new thread under the row's thread, in the same environment, section and pin state. The composer starts with Full Access; pick another permission mode before sending if you want one. This is an initial composer value: the selected mode is passed through when you send, without changing existing threads or project defaults.

## Coming from Model & Effort Badges

Model & Effort Badges (ID `model-effort-badges`; its 0.6.0 package is named Thread Columns) kept the unread and seen records itself through 0.6. On start, Responsibilities copies them from that plugin's database, merging each field by its maximum. The copy is read from a temporary duplicate, so the other plugin's file is never written. Then it reads every thread's history once to find results that finished while neither plugin was listening. Only turns that completed count; an intermediate message of a running, failed or interrupted turn does not. Run only one of the two as the writer: before enabling this one, disable that plugin (`bb plugin disable model-effort-badges`) or move it to a version that no longer keeps these records. Otherwise both draw the same marks. A badges-only version (0.7 or later) no longer writes these records; this is a compatibility boundary, not an announcement of its availability.

The old database is not deleted. Back up your BB data before changing plugins. Committed result, quiet-attention and seen fields are retained; unconfirmed client seen marks can be repeated. The records are merged again on every start, so nothing that plugin wrote is skipped. When there is no such database, the log says so and there is nothing to take over.

If you customized the thread list actions, replace only `model-effort-badges/newChildThread` with `responsibilities/newChildThread` in that list, keeping every other action and its order. Use the thread list customization UI; do not replace the whole preferences object. Model badges and columns are separate plugins after the split; save your actual column settings before updating the combined 0.6 package and consult the replacement plugin’s migration instructions when it is available.

## For other plugins

Other plugins can read the same records through BB's cross-plugin RPC with `pluginId: "responsibilities"`:

- `list({})` returns `[{ threadId, resultAt, quietAttentionAt, seenAt }]`, with epoch milliseconds or null. The read is tagged `attention` and refreshes after every write;
- `seen({ threadId, resultAt })` records that a result was seen. The value only ever grows.

## Data and access

This is a full-trust BB plugin. It reads thread metadata and thread events. It stores result and seen timestamps in its own local SQLite database. It reads the managers file you configure and, on every start, the database of Model & Effort Badges. No telemetry. It uses BB’s SDK and SQLite driver plus Zod; React and the composer come from BB. Responsibilities makes no external service calls. Sending a child thread uses the provider and account you select in BB, with that provider’s normal access requirements and costs.

## Develop

Use Bun 1.4.3 and Node 24. The lockfile pins BB 0.47.1, SDK 0.6.79 and the build tools. BB must be available for `bb plugin build`; `bun run build` uses the pinned local CLI.

```sh
bun install --frozen-lockfile
bun run check
bun test
bun run build
```

Build output is generated in `dist/`; the npm allowlist includes runtime sources and prebuilt bundles, without source maps or tests. The same build on a clean frozen-lock install must produce identical bundle bytes.

See [demo provenance](assets/README.md). MIT licensed; see THIRD_PARTY_NOTICES for Zod attribution.
