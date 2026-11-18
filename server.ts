import { readFileSync, watch, type FSWatcher } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { runResult } from "./attention";
import { attentionRow, contract } from "./contract";
import { MIGRATION_TABLE, importAttention, markScanned, scanCompletedTurns } from "./migrate";

const SOURCE = "model-effort-badges";

const SELECT =
  "SELECT thread_id AS threadId, result_at AS resultAt, quiet_attention_at AS quietAttentionAt, seen_at AS seenAt FROM attention";

const managersFile = z.object({ managers: z.array(z.object({ threadId: z.string() })) });

export default function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    compactTheme: {
      type: "boolean",
      label: "Compact warm theme",
      description:
        "Warm colors, compact thread rows, branch guides and more room for titles. Turn off to restore your BB theme.",
      default: false,
    },
    managersFile: {
      type: "string",
      label: "Managers file",
      description:
        'Absolute path to a JSON file that lists manager threads as { "managers": [{ "threadId": "…" }] }. Their rows get a bold, brighter title and the Managers filter shows them. Empty turns this off.',
      default: "",
    },
  });

  const db = bb.storage.database();
  bb.storage.migrate(db, [
    "CREATE TABLE attention (thread_id TEXT PRIMARY KEY, result_at INTEGER, quiet_attention_at INTEGER, seen_at INTEGER)",
    MIGRATION_TABLE,
  ]);
  const legacy = join(bb.server.experimental_dataDir, "plugins", SOURCE, "data.db");
  const unscanned = importAttention(db, legacy, (message) => bb.log.warn(message));

  const changed = (threadIds: Iterable<string>) => {
    for (const threadId of threadIds)
      bb.realtime.publish("attention", db.prepare(`${SELECT} WHERE thread_id = ?`).get(threadId));
    bb.rpc.experimental_invalidate(["attention"]);
  };

  bb.events.on("thread.idle", async ({ thread }) => {
    let at: number | null | undefined;
    let beforeSeq: string | undefined;
    do {
      const page = await bb.sdk.threads.events.list({
        threadId: thread.id,
        types: ["client/turn/requested", "item/completed", "system/manager/user_message"],
        order: "desc",
        limit: "100",
        beforeSeq,
      });
      at = runResult(page, thread.updatedAt);
      if (page.length < 100) at ??= null;
      beforeSeq = page.at(-1)?.seq.toString();
    } while (at === undefined);
    if (at !== null) {
      db.prepare(
        "INSERT INTO attention (thread_id, result_at) VALUES (?, ?) ON CONFLICT DO UPDATE SET result_at = max(coalesce(result_at, 0), excluded.result_at)",
      ).run(thread.id, at);
    } else if (thread.parentThreadId === null) {
      db.prepare(
        "INSERT INTO attention (thread_id, quiet_attention_at) VALUES (?, ?) ON CONFLICT DO UPDATE SET quiet_attention_at = max(coalesce(quiet_attention_at, 0), excluded.quiet_attention_at)",
      ).run(thread.id, thread.latestAttentionAt);
    } else return;
    changed([thread.id]);
  });

  const managers = async () => {
    const { managersFile: path } = await settings.get();
    return path
      ? managersFile
          .parse(JSON.parse(readFileSync(path, "utf8")))
          .managers.map((manager) => manager.threadId)
      : [];
  };

  bb.rpc.register(contract, {
    list: () => db.prepare(SELECT).all() as z.infer<typeof attentionRow>[],
    seen: ({ threadId, resultAt }) => {
      db.prepare(
        "INSERT INTO attention (thread_id, seen_at) VALUES (?, ?) ON CONFLICT DO UPDATE SET seen_at = max(coalesce(seen_at, 0), excluded.seen_at)",
      ).run(threadId, resultAt);
      bb.realtime.publish("attention", db.prepare(`${SELECT} WHERE thread_id = ?`).get(threadId));
      return null;
    },
    managers,
  });

  // WARNING: editors replace the file, so watch its directory for that name, not the file itself.
  let watcher: FSWatcher | undefined;
  const rewatch = (path: string) => {
    watcher?.close();
    watcher = path
      ? watch(
          dirname(path),
          (_, name) => name === basename(path) && bb.rpc.experimental_invalidate(["managers"]),
        )
      : undefined;
  };
  settings.onChange((next) => {
    rewatch(next.managersFile);
    bb.rpc.experimental_invalidate(["managers"]);
  });
  bb.background.service("managers-file", {
    async start(signal) {
      rewatch((await settings.get()).managersFile);
      await new Promise((resolve) => signal.addEventListener("abort", resolve));
      watcher?.close();
    },
  });

  if (unscanned !== null) {
    bb.background.service("takeover-scan", {
      async start(signal) {
        await scanCompletedTurns(
          bb.sdk,
          (results) => {
            const write = db.prepare(
              "INSERT INTO attention (thread_id, result_at) VALUES (?, ?) ON CONFLICT DO UPDATE SET result_at = max(coalesce(result_at, 0), excluded.result_at)",
            );
            db.transaction(() =>
              results.forEach((resultAt, threadId) => write.run(threadId, resultAt)),
            )();
            changed(results.keys());
          },
          signal,
        );
        markScanned(db, legacy, unscanned);
        bb.log.info(`takeover from ${SOURCE}: scan of completed turns done`);
        await new Promise((resolve) => signal.addEventListener("abort", resolve));
      },
    });
  }
}
