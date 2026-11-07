import { expect, test } from "bun:test";
import { COLLAPSED_FAILED, FAILED, UNREAD, merge, rowAttention, runResult, type Attention, type AttentionThread } from "./attention";

const request = (createdAt: number, kind = "follow-up") => ({ type: "client/turn/requested", createdAt, data: { target: { kind } } });
const item = (createdAt: number, type: string, text = "") => ({ type: "item/completed", createdAt, data: { item: { type, text } } });
const events = (...rows: object[]) => rows as unknown as Parameters<typeof runResult>[0];

test("a run's result is its newest assistant message after the run's request", () => {
  expect(runResult(events(item(30, "commandExecution"), item(20, "agentMessage", "Done"), request(10, "thread-start")), 40)).toBe(20);
});

test("a run whose request is reached without output is quiet, even when an older run had output", () => {
  expect(runResult(events(item(30, "reasoning"), item(29, "agentMessage", ""), request(25), item(10, "agentMessage", "Old")), 40)).toBeNull();
});

test("REPRO: a legacy manager message, which BB shows as assistant text, is a result; an empty one is not", () => {
  const manager = (text: string) => ({ type: "system/manager/user_message", createdAt: 30, data: { text } });
  expect(runResult(events(manager("Report"), request(20)), 40)).toBe(30);
  expect(runResult(events(manager(""), request(20)), 40)).toBeNull();
});

test("a steer joins the running turn, so output before it still counts", () => {
  expect(runResult(events(item(30, "commandExecution"), request(25, "steer"), item(20, "agentMessage", "Partial"), request(10, "thread-start")), 40)).toBe(20);
});

test("REPRO: a later run's request and output never stand in for the run that ended", () => {
  // Run 2 started before the idle listener read: its request and reply are newer than the transition.
  const page = events(item(120, "agentMessage", "Run 2"), request(110), item(90, "agentMessage", "Run 1 result"), request(80, "thread-start"));
  expect(runResult(page, 100)).toBe(90);
  expect(runResult(events(request(100), item(100, "agentMessage", "Last word"), request(80)), 100)).toBe(100);
});

test("REPRO: a page of tool completions without the run's request is unknown, not quiet", () => {
  const tools = Array.from({ length: 100 }, (_, n) => item(200 - n, "commandExecution"));
  expect(runResult(events(...tools), 300)).toBeUndefined();
});

test("REPRO: a late or overlapping snapshot cannot undo a newer result or seen mark", () => {
  const row = (resultAt: number | null, seenAt: number | null): Attention => ({ threadId: "child", resultAt, quietAttentionAt: null, seenAt });
  const live = merge(undefined, row(20, null));
  expect(merge(live, row(null, null))).toEqual(row(20, null));
  const seen = merge(live, row(20, 20));
  expect(merge(merge(seen, row(10, null)), row(20, null))).toEqual(row(20, 20));
  expect(merge(merge(seen, row(20, null)), row(10, null))).toEqual(row(20, 20));
});

const child = (overrides: Partial<AttentionThread> = {}): AttentionThread => ({
  id: "child",
  parentThreadId: "root",
  status: "idle",
  isUnread: false,
  lastReadAt: 100,
  latestAttentionAt: 50,
  indicator: "none",
  activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
  hasPendingInteraction: false,
  queuedWork: "none",
  ...overrides,
});
const root = (overrides: Partial<AttentionThread> = {}) => child({ id: "root", parentThreadId: null, ...overrides });
const records = (...rows: Partial<Attention>[]) =>
  new Map(rows.map((row) => [row.threadId ?? "child", { threadId: "child", resultAt: null, quietAttentionAt: null, seenAt: null, ...row }]));
const state = (status: RowStatus, failed: boolean, unread: boolean, quiet = false, summary = { working: 0, waiting: 0, failed: 0 }) => ({ status, failed, unread, quiet, summary });
type RowStatus = ReturnType<typeof rowAttention>["status"];

test("a child's unseen result shows the dot; seeing or reading it clears the dot", () => {
  expect(rowAttention(child(), [child()], records({ resultAt: 200 }))).toEqual(state(UNREAD, false, true));
  expect(rowAttention(child(), [child()], records({ resultAt: 200, seenAt: 200 })).unread).toBe(false);
  expect(rowAttention(child({ lastReadAt: 300 }), [child({ lastReadAt: 300 })], records({ resultAt: 200 })).unread).toBe(false);
});

test("a child without a recorded result is never unread", () => {
  const thread = child({ isUnread: true, latestAttentionAt: 500 });
  expect(rowAttention(thread, [thread], records()).unread).toBe(false);
});

test("BB's root unread stays, except for a run proven to write nothing", () => {
  const thread = root({ isUnread: true, latestAttentionAt: 500, indicator: "unread-success" });
  expect(rowAttention(thread, [thread], records())).toEqual(state(UNREAD, false, true));
  expect(rowAttention(thread, [thread], records({ threadId: "root", quietAttentionAt: 500 }))).toEqual(state(null, false, false, true));
});

test("a failure always shows the cross, with the dot over it when unread", () => {
  const thread = child({ status: "error" });
  expect(rowAttention(thread, [thread], records({ resultAt: 200 }))).toEqual(state(FAILED, true, true));
  expect(rowAttention(thread, [thread], records()).status).toBe(FAILED);
});

test("busy, waiting and queued glyphs stay BB's; the dot goes over them", () => {
  for (const indicator of ["runtime", "waiting-for-input", "workflow", "queued-waiting"] as const) {
    const thread = child({ indicator });
    expect(rowAttention(thread, [thread], records({ resultAt: 200 }))).toEqual(state(null, false, true));
  }
});

test("REPRO: a collapsed parent's hidden failure is flagged even while BB shows its spinner or question", () => {
  for (const indicator of ["runtime", "waiting-for-input"] as const) {
    const parent = root({ indicator });
    expect(rowAttention(parent, [parent, child({ status: "error" })], records())).toEqual(state(COLLAPSED_FAILED, true, false, false, { working: 0, waiting: 0, failed: 1 }));
  }
});

test("REPRO: a hidden child's activity keeps BB's glyph; another child's unread result goes over it", () => {
  for (const indicator of ["workflow", "background-agent", "background-command", "plan-mode", "goal", "runtime", "waiting-for-input"] as const) {
    const parent = root();
    expect(rowAttention(parent, [parent, child(), child({ id: "working", indicator })], records({ resultAt: 200 }))).toEqual(state(null, false, true));
  }
});

test("a collapsed parent carries its hidden descendants' failure and unread result", () => {
  const parent = root();
  const failed = child({ id: "a", status: "error" });
  const done = child({ id: "b" });
  expect(rowAttention(parent, [parent, failed, done], records({ threadId: "b", resultAt: 200 }))).toEqual(state(COLLAPSED_FAILED, true, true, false, { working: 0, waiting: 0, failed: 1 }));
  expect(rowAttention(parent, [parent, done], records({ threadId: "b", resultAt: 200 })).status).toBe(UNREAD);
});


test("collapsed summary counts descendants once, excluding the parent and quiet results", () => {
  const parent = root({ status: "active" });
  const running = child({ id: "running", status: "active" });
  const waiting = child({ id: "waiting", parentThreadId: "running", status: "active", hasPendingInteraction: true });
  const background = child({ id: "background", parentThreadId: "waiting", activity: { workflows: 1, backgroundAgents: 2, backgroundCommands: 1, planMode: 0, goals: 0 } });
  const failed = child({ id: "failed", status: "error" });
  const queued = child({ id: "queued", queuedWork: "failed" });
  const done = child({ id: "done" });
  expect(rowAttention(parent, [parent, running, waiting, background, failed, queued, done], records({ threadId: "done", resultAt: 200 })).summary).toEqual({ working: 2, waiting: 1, failed: 2 });
  expect(rowAttention(parent, [parent], records()).summary).toEqual({ working: 0, waiting: 0, failed: 0 });
});

test("waiting and failed descendants do not also count as working through background activity", () => {
  const activity = { workflows: 1, backgroundAgents: 1, backgroundCommands: 1, planMode: 0, goals: 0 };
  const parent = root();
  expect(rowAttention(parent, [parent, child({ id: "waiting", hasPendingInteraction: true, activity }), child({ id: "failed", status: "error", activity })], records()).summary).toEqual({ working: 0, waiting: 1, failed: 1 });
});
