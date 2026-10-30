import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIGRATION_TABLE, completedResult, importAttention, markScanned, scanCompletedTurns } from "./migrate";

const ATTENTION = "CREATE TABLE attention (thread_id TEXT PRIMARY KEY, result_at INTEGER, quiet_attention_at INTEGER, seen_at INTEGER)";
type Events = Parameters<typeof completedResult>[0];

let seq = 0;
const at = (turnId: string | null, type: string, createdAt: number, data: object) => ({ seq: ++seq, type, createdAt, scope: turnId === null ? { kind: "thread" } : { kind: "turn", turnId }, data });
const started = (turn: string, createdAt: number, parentToolCallId?: string) => at(turn, "turn/started", createdAt, parentToolCallId ? { parentToolCallId } : {});
const message = (turn: string, createdAt: number, text = "Done") => at(turn, "item/completed", createdAt, { item: { type: "agentMessage", text } });
const tool = (turn: string, createdAt: number) => at(turn, "item/completed", createdAt, { item: { type: "commandExecution" } });
const completed = (turn: string, createdAt: number, status = "completed") => at(turn, "turn/completed", createdAt, { status });
const manager = (turnId: string | null, createdAt: number, text: string) => at(turnId, "system/manager/user_message", createdAt, { text });
const result = (...events: object[]) => completedResult(events as unknown as Events);

test("several completed turns: the newest turn's last message", () => {
  expect(result(started("a", 1), message("a", 2), completed("a", 3), started("b", 4), message("b", 5, "First"), tool("b", 6), message("b", 7, "Final"), completed("b", 8))).toBe(7);
});

test("REPRO: a result followed by a quiet turn is still found", () => {
  expect(result(started("a", 1), message("a", 2, "Report"), completed("a", 3), started("b", 4), tool("b", 5), completed("b", 6))).toBe(2);
});

test("an open turn's intermediate messages are not a result until the turn completes", () => {
  const open = [started("a", 1), message("a", 2, "Checking…"), tool("a", 3)];
  expect(result(...open)).toBeNull();
  expect(result(...open, message("a", 4, "Done"), completed("a", 5))).toBe(4);
});

test("REPRO: a thread working at the takeover keeps its completed turn's result", () => {
  expect(result(started("a", 1), message("a", 2, "Report"), completed("a", 3), started("b", 4), message("b", 5, "Still going"))).toBe(2);
});

test("failed and interrupted turns are not results", () => {
  expect(result(started("a", 1), message("a", 2), completed("a", 3, "failed"))).toBeNull();
  expect(result(started("a", 1), message("a", 2), completed("a", 3, "interrupted"))).toBeNull();
});

test("a subagent's nested turn is not the thread's output", () => {
  expect(result(started("a", 1), started("sub", 2, "call_1"), message("sub", 3, "Subagent"), completed("sub", 4), tool("a", 5), completed("a", 6))).toBeNull();
});

test("an empty assistant message is not a result", () => {
  expect(result(started("a", 1), message("a", 2, ""), completed("a", 3))).toBeNull();
});

test("a legacy manager message with text is a result in any scope; an empty one is not", () => {
  expect(result(manager(null, 9, "Report"))).toBe(9);
  expect(result(started("a", 1), manager("a", 2, "Report"), completed("a", 3, "failed"))).toBe(2);
  expect(result(manager(null, 9, ""))).toBeNull();
});

/** A badges-shaped source database holding `rows`; the connection stays open when `keep` (WAL not checkpointed). */
function source(rows: (number | null)[][], keep = false) {
  const dir = join(mkdtempSync(join(tmpdir(), "resp-test-")), "plugins", "model-effort-badges");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "data.db");
  const db = new Database(file);
  db.run("PRAGMA journal_mode = WAL");
  db.run(ATTENTION);
  for (const [n, ...values] of rows) db.prepare("INSERT INTO attention VALUES (?, ?, ?, ?)").run(`t${n}`, ...values);
  if (!keep) db.close();
  return { file, db };
}

function target() {
  const db = new Database(":memory:");
  db.run(ATTENTION);
  db.run(MIGRATION_TABLE);
  return db;
}

const rows = (db: Database) => db.query("SELECT thread_id, result_at, quiet_attention_at, seen_at FROM attention ORDER BY thread_id").values() as unknown[][];
const quiet = () => {};

test("REPRO: the import merges each field by its maximum, keeps NULL, and is idempotent", () => {
  const { file } = source([[1, 100, null, 90], [2, null, 50, null]]);
  const db = target();
  db.prepare("INSERT INTO attention VALUES ('t1', 80, 70, 95)").run();
  const version = importAttention(db as never, file, quiet);
  expect(version).not.toBeNull();
  const once = rows(db);
  expect(once).toEqual([["t1", 100, 70, 95], ["t2", null, 50, null]]);
  expect(importAttention(db as never, file, quiet)).toBe(version);
  expect(rows(db)).toEqual(once);
});

test("REPRO: no source database is reported, not fatal: a fresh install or a source that never kept records", () => {
  const warnings: string[] = [];
  expect(importAttention(target() as never, join(tmpdir(), "resp-missing", "data.db"), (message) => warnings.push(message))).toBeNull();
  expect(warnings).toEqual([expect.stringContaining("nothing to take over")]);
});

test("REPRO: records only in the source's WAL are imported and make the history scan due again", () => {
  const { file, db: writer } = source([[1, 100, null, null]], true);
  const db = target();
  markScanned(db as never, file, importAttention(db as never, file, quiet)!);
  writer.prepare("UPDATE attention SET seen_at = 150 WHERE thread_id = 't1'").run();
  utimesSync(`${file}-wal`, new Date(), new Date(Date.now() + 5000));
  expect(importAttention(db as never, file, quiet)).not.toBeNull();
  expect(rows(db)).toEqual([["t1", 100, null, 150]]);
  writer.close();
});

test("REPRO: a scanned version never skips the import, so a round trip keeps records written in between", () => {
  const { file } = source([[1, 100, null, 90]]);
  const db = target();
  importAttention(db as never, file, quiet);
  const writer = new Database(file);
  writer.prepare("UPDATE attention SET seen_at = 120 WHERE thread_id = 't1'").run();
  writer.close();
  // The file changed, yet its version matches the scan marker, as a restored file with an old time would.
  const parts = [file, `${file}-wal`].filter((part) => existsSync(part));
  markScanned(db as never, file, Math.max(...parts.map((part) => statSync(part).mtimeMs)));
  expect(importAttention(db as never, file, quiet)).toBeNull();
  expect(rows(db)).toEqual([["t1", 100, null, 120]]);
});

test("the scan reads every page of threads and events and reports each page of results", async () => {
  const threads = Array.from({ length: 101 }, (_, n) => ({ id: `t${n}` }));
  const histories: Record<string, object[]> = {
    t0: [started("a", 0), ...Array.from({ length: 150 }, (_, n) => (n === 140 ? message("a", 1400 + n) : tool("a", n))), completed("a", 2000)],
    t100: [started("b", 1), message("b", 7), completed("b", 8)],
  };
  const asked: string[] = [];
  const sdk = {
    threads: {
      list: async ({ archived, offset }: { archived: boolean; offset: number }) => (archived ? [] : threads.slice(offset, offset + 100)),
      events: {
        list: async ({ threadId, afterSeq }: { threadId: string; afterSeq?: string }) => {
          asked.push(`${threadId}:${afterSeq ?? ""}`);
          const all = (histories[threadId] ?? []) as { seq: number }[];
          const from = afterSeq ? all.findIndex((event) => event.seq === Number(afterSeq)) + 1 : 0;
          return all.slice(from, from + 100);
        },
      },
    },
  };
  const pages: [string, number][][] = [];
  await scanCompletedTurns(sdk as never, (results) => void pages.push([...results.entries()]), new AbortController().signal);
  expect(pages).toEqual([[["t0", 1540]], [["t100", 7]]]);
  expect(asked.filter((entry) => entry.startsWith("t0:")).length).toBe(2);
});

test("REPRO: a thread that the shifting list skipped is read when the list is taken again", async () => {
  let lists = 0;
  const sdk = {
    threads: {
      // The first listing misses t2, as an archive between offset pages would; the next one has it.
      list: async ({ archived }: { archived: boolean }) => (archived ? [] : ++lists === 1 ? [{ id: "t1" }] : [{ id: "t1" }, { id: "t2" }]),
      events: { list: async ({ threadId }: { threadId: string }) => (threadId === "t2" ? [started("x", 1), message("x", 5), completed("x", 6)] : []) },
    },
  };
  const found: [string, number][] = [];
  await scanCompletedTurns(sdk as never, (results) => void found.push(...results), new AbortController().signal);
  expect(found).toEqual([["t2", 5]]);
});

test("a completion without its root turn/started does not count, as BB does not end a run on it", () => {
  expect(result(message("orphan", 2), completed("orphan", 3))).toBeNull();
});
