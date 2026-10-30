import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import plugin from "./server";

type Page = object[];
type Rpc = Record<string, (input: never) => unknown>;

/** The real server entry against an in-memory database and a scripted events API; no module mocks. */
function load(list: (args: { beforeSeq?: string }) => Promise<Page>, { dataDir = "/nonexistent", threads = [] as object[] } = {}) {
  const db = new Database(":memory:");
  let idle!: (payload: { thread: object }) => Promise<void>;
  let rpc!: Rpc;
  const services: Record<string, (signal: AbortSignal) => Promise<void>> = {};
  const order: string[] = [];
  const invalidated: string[][] = [];
  plugin({
    settings: { define: () => ({ get: async () => ({ managersFile: "" }), onChange() {} }) },
    storage: { database: () => db, migrate: (_: unknown, statements: string[]) => statements.forEach((sql) => db.run(sql)) },
    server: { experimental_dataDir: dataDir },
    realtime: { publish() {} },
    rpc: { register: (_: unknown, handlers: Rpc) => (order.push("rpc"), (rpc = handlers)), experimental_invalidate: (tags: string[]) => invalidated.push(tags) },
    events: { on: (_: string, handler: typeof idle) => (order.push("idle"), (idle = handler)) },
    background: { service: (name: string, service: { start: (signal: AbortSignal) => Promise<void> }) => (services[name] = service.start) },
    log: { info() {}, warn() {} },
    sdk: { threads: { list: async ({ archived }: { archived: boolean }) => (archived ? [] : threads), events: { list } } },
  } as unknown as BbPluginApi);
  const row = () => db.query("SELECT result_at AS resultAt, quiet_attention_at AS quietAttentionAt, seen_at AS seenAt FROM attention").get();
  return { idle, rpc, row, services, order, invalidated, db };
}

const thread = (updatedAt: number, parentThreadId: string | null = "root") => ({ id: "t", parentThreadId, updatedAt, latestAttentionAt: updatedAt });
const request = (seq: number, createdAt: number) => ({ seq, type: "client/turn/requested", createdAt, data: { target: { kind: "follow-up" } } });
const tool = (seq: number) => ({ seq, type: "item/completed", createdAt: seq, data: { item: { type: "commandExecution" } } });
const reply = (seq: number, createdAt: number, text = "Done") => ({ seq, type: "item/completed", createdAt, data: { item: { type: "agentMessage", text } } });

test("REPRO: run 1's idle read sees run 2's request first and still records run 1's result", async () => {
  const { idle, row } = load(async () => [request(4, 110), reply(3, 90, "Run 1 result"), request(1, 80)]);
  await idle({ thread: thread(100) });
  expect(row()).toEqual({ resultAt: 90, quietAttentionAt: null, seenAt: null });
});

test("REPRO: reversed completion with a read in between never moves the result back", async () => {
  const reads = [Promise.withResolvers<Page>(), Promise.withResolvers<Page>()];
  let call = 0;
  const { idle, rpc, row } = load(() => reads[call++]!.promise);
  const first = idle({ thread: thread(100) });
  const second = idle({ thread: thread(200) });
  reads[1]!.resolve([reply(6, 190, "Run 2"), request(5, 150)]);
  await second;
  rpc.seen!({ threadId: "t", resultAt: 190 } as never);
  reads[0]!.resolve([reply(3, 90, "Run 1"), request(1, 80)]);
  await first;
  expect(row()).toEqual({ resultAt: 190, quietAttentionAt: null, seenAt: 190 });
});

test("REPRO: a full page without the run's request reads the next page instead of assuming quiet", async () => {
  const pages: Record<string, Page> = {
    "": Array.from({ length: 100 }, (_, n) => tool(300 - n)),
    "201": [tool(200), reply(150, 150), request(100, 100)],
  };
  const asked: (string | undefined)[] = [];
  const { idle, row } = load(async ({ beforeSeq }) => (asked.push(beforeSeq), pages[beforeSeq ?? ""]!));
  await idle({ thread: thread(400, null) });
  expect(asked).toEqual([undefined, "201"]);
  expect(row()).toEqual({ resultAt: 150, quietAttentionAt: null, seenAt: null });
});

test("a root run proven quiet stores its attention so BB's dot for it can be hidden", async () => {
  const { idle, row } = load(async () => [tool(3), request(1, 1)]);
  await idle({ thread: thread(400, null) });
  expect(row()).toEqual({ resultAt: null, quietAttentionAt: 400, seenAt: null });
});

const manager = (seq: number, text: string) => ({ seq, type: "system/manager/user_message", createdAt: seq, data: { text } });
/** Answers only the event types the server asks for, like the real endpoint. */
const filtered = (page: { type: string }[]) => async (args: object) => page.filter((event) => (args as { types: string[] }).types.includes(event.type));

test("REPRO: a run whose only output is a manager message is a result, on a root and on a child", async () => {
  for (const parent of [null, "root"]) {
    const { idle, row } = load(filtered([manager(90, "Report"), tool(2), request(1, 1)]));
    await idle({ thread: thread(100, parent) });
    expect(row()).toEqual({ resultAt: 90, quietAttentionAt: null, seenAt: null });
  }
});

test("an empty manager message is quiet only once the run's request is reached", async () => {
  const complete = load(filtered([manager(90, ""), tool(2), request(1, 1)]));
  await complete.idle({ thread: thread(100, null) });
  expect(complete.row()).toEqual({ resultAt: null, quietAttentionAt: 100, seenAt: null });

  const asked: (string | undefined)[] = [];
  const pages: Record<string, Page> = { "": [manager(300, ""), ...Array.from({ length: 99 }, (_, n) => tool(299 - n))], "201": [reply(150, 150), request(100, 100)] };
  const paged = load(async ({ beforeSeq }) => (asked.push(beforeSeq), pages[beforeSeq ?? ""]!));
  await paged.idle({ thread: thread(400, null) });
  expect(asked).toEqual([undefined, "201"]);
  expect(paged.row()).toEqual({ resultAt: 150, quietAttentionAt: null, seenAt: null });
});

test("a quiet child run stores nothing", async () => {
  const { idle, row } = load(async () => [tool(3), request(1, 1)]);
  await idle({ thread: thread(400) });
  expect(row()).toBeNull();
});

test("REPRO: seen marks a failed thread that has no result row, and only ever grows", async () => {
  const { rpc, row } = load(async () => []);
  rpc.seen!({ threadId: "t", resultAt: 300 } as never);
  expect(row()).toEqual({ resultAt: null, quietAttentionAt: null, seenAt: 300 });
  rpc.seen!({ threadId: "t", resultAt: 200 } as never);
  expect(row()).toEqual({ resultAt: null, quietAttentionAt: null, seenAt: 300 });
});

test("a result after a seen failure is unread again, and seeing it keeps the newer mark", async () => {
  const { idle, rpc, row } = load(async () => [reply(3, 350), request(1, 1)]);
  rpc.seen!({ threadId: "t", resultAt: 300 } as never);
  await idle({ thread: thread(400) });
  expect(row()).toEqual({ resultAt: 350, quietAttentionAt: null, seenAt: 300 });
  rpc.seen!({ threadId: "t", resultAt: 350 } as never);
  expect(row()).toEqual({ resultAt: 350, quietAttentionAt: null, seenAt: 350 });
});

test("REPRO: the takeover imports before the RPC exists, then scans completed turns after the idle handler is live", async () => {
  const root = mkdtempSync(join(tmpdir(), "resp-server-"));
  mkdirSync(join(root, "plugins", "model-effort-badges"), { recursive: true });
  const old = new Database(join(root, "plugins", "model-effort-badges", "data.db"));
  old.run("CREATE TABLE attention (thread_id TEXT PRIMARY KEY, result_at INTEGER, quiet_attention_at INTEGER, seen_at INTEGER)");
  old.run("INSERT INTO attention VALUES ('t', 50, NULL, 60)");
  old.close();
  const turn = (seq: number, type: string, createdAt: number, data: object) => ({ seq, type, createdAt, scope: { kind: "turn", turnId: "a" }, data });
  const { rpc, row, services, order, invalidated } = load(async () => [turn(1, "turn/started", 100, {}), turn(2, "item/completed", 120, { item: { type: "agentMessage", text: "Missed" } }), turn(3, "turn/completed", 130, { status: "completed" })], { dataDir: root, threads: [{ id: "t" }] });
  expect(order).toEqual(["idle", "rpc"]);
  expect(rpc.list!({} as never)).toEqual([{ threadId: "t", resultAt: 50, quietAttentionAt: null, seenAt: 60 }]);
  const abort = new AbortController();
  const scan = services["takeover-scan"]!(abort.signal);
  await Bun.sleep(0);
  expect(row()).toEqual({ resultAt: 120, quietAttentionAt: null, seenAt: 60 });
  expect(invalidated).toContainEqual(["attention"]);
  abort.abort();
  await scan;
});

test("without a previous plugin's data there is no takeover scan", () => {
  expect(Object.keys(load(async () => []).services)).toEqual(["managers-file"]);
});
