import { expect, test } from "bun:test";
import { isWorking } from "./attention";
import { groupsWith, needsYou, visibleThreads } from "./filter";

type Thread = Parameters<typeof visibleThreads>[1][number];
const idle = { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 };
const thread = (id: string, parentThreadId: string | null, more: Partial<Thread> = {}): Thread => ({
  id,
  parentThreadId,
  sectionId: "sec",
  projectId: "proj",
  isHidden: false,
  status: "idle",
  activity: idle,
  hasPendingInteraction: false,
  queuedWork: "none",
  isUnread: false,
  lastReadAt: 10,
  latestAttentionAt: 5,
  indicator: "none",
  ...more,
});

test("working means a running turn or live work, never a thread waiting for the user", () => {
  expect(isWorking(thread("a", null, { status: "active" }))).toBe(true);
  expect(isWorking(thread("a", null, { activity: { ...idle, backgroundAgents: 1 } }))).toBe(true);
  expect(isWorking(thread("a", null, { activity: { ...idle, goals: 1, planMode: 1 } }))).toBe(false);
  expect(isWorking(thread("a", null, { status: "active", hasPendingInteraction: true }))).toBe(false);
});

test("needs you: a question, a failure, a failed queued message or an unread result", () => {
  expect(needsYou(thread("a", null, { hasPendingInteraction: true }), undefined)).toBe(true);
  expect(needsYou(thread("a", null, { status: "error" }), undefined)).toBe(true);
  expect(needsYou(thread("a", null, { queuedWork: "failed" }), undefined)).toBe(true);
  expect(needsYou(thread("a", "p"), { threadId: "a", resultAt: 20, quietAttentionAt: null, seenAt: null })).toBe(true);
  expect(needsYou(thread("a", "p"), { threadId: "a", resultAt: 20, quietAttentionAt: null, seenAt: 20 })).toBe(false);
});

const tree = [
  thread("root", null),
  thread("mgr", "root"),
  thread("worker", "mgr", { status: "active" }),
  thread("done", "mgr"),
  thread("other", null, { sectionId: "later", projectId: "proj2" }),
];

test("REPRO: a match keeps its ancestors and drops its siblings", () => {
  expect(visibleThreads("working", tree, new Map(), new Set(), null)).toEqual(new Set(["worker", "mgr", "root"]));
});

test("the open thread stays visible with its ancestors", () => {
  expect(visibleThreads("working", tree, new Map(), new Set(), "other")).toEqual(new Set(["worker", "mgr", "root", "other"]));
});

test("quiet is neither working nor needing you; managers come from the managers list", () => {
  expect(visibleThreads("quiet", tree, new Map(), new Set(), null)).toEqual(new Set(["root", "mgr", "done", "other"]));
  expect(visibleThreads("managers", tree, new Map(), new Set(["mgr"]), null)).toEqual(new Set(["mgr", "root"]));
});

test("all keeps everything; hidden helper threads never match", () => {
  expect(visibleThreads("all", tree, new Map(), new Set(), null)).toBeNull();
  expect(visibleThreads("working", [thread("h", null, { isHidden: true, status: "active" })], new Map(), new Set(), null)).toEqual(new Set());
});

test("REPRO: a collapsed section or project without a kept thread is told by data, not by its rows", () => {
  const visible = new Set(["worker", "mgr", "root"]);
  expect(groupsWith(visible, tree, "sectionId")).toEqual(new Set(["sec"]));
  expect(groupsWith(visible, tree, "projectId")).toEqual(new Set(["proj"]));
});
