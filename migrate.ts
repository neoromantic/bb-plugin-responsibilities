import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

/**
 * Takeover of another plugin's attention table (Model & Effort Badges kept it
 * before this plugin; a rollback build reads this plugin's table the same way).
 * The import merges on every load, so no marker can skip records written since;
 * the history scan runs once per source file version.
 */
type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type Sdk = BbPluginApi["sdk"];
type Event = Awaited<ReturnType<Sdk["threads"]["events"]["list"]>>[number];

export const MIGRATION_TABLE = "CREATE TABLE migration (source TEXT PRIMARY KEY, scanned_version REAL)";

// Every field only grows; NULL keeps meaning "never".
const MERGE = ["result_at", "quiet_attention_at", "seen_at"].map((column) => `${column} = nullif(max(coalesce(${column}, 0), coalesce(excluded.${column}, 0)), 0)`).join(", ");

const version = (file: string) => Math.max(statSync(file).mtimeMs, existsSync(`${file}-wal`) ? statSync(`${file}-wal`).mtimeMs : 0);

/**
 * Merges the source plugin's attention rows into this database, from a copy so
 * the source file is never opened for writing. `file` is the source plugin's
 * database. Returns the source version that still needs a scan of completed
 * turns, or null when there is nothing to take over. No file means no records:
 * a fresh install, or a source that never kept them (Model & Effort Badges 0.7
 * and later); `warn` says so, and the cutover check compares against a backup.
 */
export function importAttention(db: Db, file: string, warn: (message: string) => void): number | null {
  if (!existsSync(file)) {
    warn(`no ${file}: nothing to take over`);
    return null;
  }
  const current = version(file);
  const copy = mkdtempSync(join(tmpdir(), "responsibilities-"));
  copyFileSync(file, join(copy, "data.db"));
  if (existsSync(`${file}-wal`)) copyFileSync(`${file}-wal`, join(copy, "data.db-wal"));
  db.prepare("ATTACH DATABASE ? AS source").run(join(copy, "data.db"));
  db.prepare(`INSERT INTO attention SELECT thread_id, result_at, quiet_attention_at, seen_at FROM source.attention WHERE true ON CONFLICT(thread_id) DO UPDATE SET ${MERGE}`).run();
  db.prepare("DETACH DATABASE source").run();
  rmSync(copy, { recursive: true });
  const scanned = db.prepare("SELECT scanned_version AS version FROM migration WHERE source = ?").get(file) as { version: number } | undefined;
  return scanned?.version === current ? null : current;
}

export const markScanned = (db: Db, file: string, version: number) =>
  db.prepare("INSERT INTO migration (source, scanned_version) VALUES (?, ?) ON CONFLICT DO UPDATE SET scanned_version = excluded.scanned_version").run(file, version);

/**
 * The newest result among a thread's completed root turns, read in seq order:
 * each turn that ended `completed` contributes its last non-empty assistant
 * message. A root turn is one whose `turn/started` has no `parentToolCallId`,
 * as BB itself decides when a completion ends the thread's run; a subagent's
 * nested turn is not the thread's output. A turn still open, failed or
 * interrupted contributes nothing, so an intermediate message is never a
 * result. A legacy manager message is complete text, so it counts as it is.
 */
export function completedResult(events: readonly Event[]): number | null {
  const roots = new Set<string>();
  const last = new Map<string, number>();
  let result: number | null = null;
  for (const event of events) {
    if (event.type === "system/manager/user_message") {
      if (event.data.text) result = Math.max(result ?? 0, event.createdAt);
      continue;
    }
    if (event.scope.kind !== "turn") continue;
    const turn = event.scope.turnId;
    if (event.type === "turn/started" && !event.data.parentToolCallId) roots.add(turn);
    else if (event.type === "item/completed" && event.data.item.type === "agentMessage" && event.data.item.text) last.set(turn, event.createdAt);
    else if (event.type === "turn/completed" && event.data.status === "completed" && roots.has(turn) && last.has(turn)) result = Math.max(result ?? 0, last.get(turn)!);
  }
  return result;
}

const TYPES = ["turn/started", "turn/completed", "item/completed", "system/manager/user_message"] as const;
const PAGE = 100;

async function threadIds(sdk: Sdk, signal: AbortSignal) {
  const ids: string[] = [];
  for (const archived of [false, true]) {
    for (let offset = 0; ; offset += PAGE) {
      const threads = await sdk.threads.list({ includeHidden: true, archived, limit: PAGE, offset, signal });
      ids.push(...threads.map((thread) => thread.id));
      if (threads.length < PAGE) break;
    }
  }
  return ids;
}

/**
 * Reads every thread's whole history and reports completed-turn results, one
 * write per 100 threads. No time cutoff: a turn that ended while no writer
 * listened is found here, and one that ends after its thread was read reaches
 * the live idle handler, which is registered before this runs. The thread list
 * shifts while the scan runs (archiving moves rows between offset pages), so it
 * is listed again until no thread is left unread. Throws on any failed read;
 * the caller reruns the scan, which is idempotent.
 */
export async function scanCompletedTurns(sdk: Sdk, record: (results: ReadonlyMap<string, number>) => void, signal: AbortSignal) {
  const read = new Set<string>();
  for (let ids = await threadIds(sdk, signal); ids.length; ids = (await threadIds(sdk, signal)).filter((id) => !read.has(id))) {
    for (let start = 0; start < ids.length; start += PAGE) {
      const results = new Map<string, number>();
      for (const threadId of ids.slice(start, start + PAGE)) {
        const events: Event[] = [];
        for (let afterSeq: string | undefined; ; ) {
          const page = await sdk.threads.events.list({ threadId, afterSeq, order: "asc", limit: String(PAGE), types: TYPES, signal });
          events.push(...page);
          if (page.length < PAGE) break;
          afterSeq = page.at(-1)!.seq.toString();
        }
        read.add(threadId);
        const result = completedResult(events);
        if (result !== null) results.set(threadId, result);
      }
      if (results.size) record(results);
    }
  }
}
