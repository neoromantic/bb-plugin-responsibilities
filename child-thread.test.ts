import { expect, test } from "bun:test";
import type { NewThreadRequest, PluginThreadActionTarget } from "@get-bb/plugin-sdk/app";
import { childSpawnArgs, childThreadItem, currentChildTarget, openChildComposer } from "./child-thread";

const thread: PluginThreadActionTarget = {
  id: "thr_parent",
  projectId: "proj_a",
  parentThreadId: "thr_grandparent",
  archivedAt: null,
  pinnedAt: null,
  sectionId: "sec_a",
  isUnread: false,
  status: "idle",
  environment: { id: "env_a", path: "/work/a" },
};

const request: NewThreadRequest = {
  projectId: "proj_a",
  providerId: "claude-code",
  model: "claude-opus-5-5",
  reasoningLevel: "high",
  permissionMode: "auto",
  executionInputSources: {},
  environment: { type: "reuse", environmentId: "env_a" },
  input: [{ type: "text", text: "hi" }],
} as unknown as NewThreadRequest;

test("every active thread offers a child, including children and threads without an environment", () => {
  expect(childThreadItem(thread)).toMatchObject({ label: "New child thread", icon: "ChildThread" });
  expect(childThreadItem({ ...thread, environment: null })).not.toBeNull();
  expect(childThreadItem({ ...thread, archivedAt: 1 })).toBeNull();
  childThreadItem(thread)!.run({ requestRename() {} });
  expect(currentChildTarget()).toBe(thread);
  openChildComposer(null);
});

test("the child is spawned under the row's own thread, keeping every composer selection", () => {
  const args = childSpawnArgs(thread, request);
  expect(args).toEqual({ ...request, parentThreadId: "thr_parent", sectionId: "sec_a", pinned: false, origin: "app" });
  expect(childSpawnArgs({ ...thread, pinnedAt: 5, sectionId: null }, request)).toMatchObject({ sectionId: null, pinned: true });
});
