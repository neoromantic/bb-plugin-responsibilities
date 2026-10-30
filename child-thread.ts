import type { NewThreadRequest, PluginThreadAction, PluginThreadActionTarget } from "@get-bb/plugin-sdk/app";

/**
 * New child thread: BB's root compose drops a parent from `toCompose`, and its
 * own "New thread in environment" shows only on compact screens, so the plugin
 * hosts BB's composer itself and spawns the thread under the row's thread.
 */
export type ChildTarget = Pick<PluginThreadActionTarget, "id" | "projectId" | "sectionId" | "pinnedAt" | "environment">;

let target: ChildTarget | null = null;
const listeners = new Set<() => void>();

export function openChildComposer(next: ChildTarget | null) {
  target = next;
  for (const listener of listeners) listener();
}

export const currentChildTarget = () => target;

export function subscribeChildTarget(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function childThreadItem(thread: PluginThreadActionTarget): PluginThreadAction | null {
  if (thread.archivedAt !== null) return null;
  return { label: "New child thread", icon: "ChildThread", run: () => openChildComposer(thread) };
}

/** The spawn request: the composer's selections, filed under the parent like BB's own compose. */
export function childSpawnArgs(parent: ChildTarget, request: NewThreadRequest) {
  return {
    ...request,
    parentThreadId: parent.id,
    sectionId: parent.sectionId,
    pinned: parent.pinnedAt !== null,
    // Created from BB's own composer by the user, so it is filed as the app's thread, not the plugin's.
    origin: "app" as const,
  };
}
