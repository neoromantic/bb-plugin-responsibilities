import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { isUnread, isWorking, type Attention } from "./attention";

export type Filter = "all" | "working" | "needs" | "quiet" | "managers";

export const FILTERS: readonly { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "working", label: "Working" },
  { id: "needs", label: "Needs you" },
  { id: "quiet", label: "Quiet" },
  { id: "managers", label: "Managers" },
];

type Thread = Pick<
  PluginSidebarThread,
  "id" | "parentThreadId" | "sectionId" | "projectId" | "isHidden" | "status" | "activity" | "hasPendingInteraction" | "queuedWork" | "isUnread" | "lastReadAt" | "latestAttentionAt" | "indicator"
>;

/** The marks on a row: a question or approval, a failure, a failed queued message, or an unread result. */
export const needsYou = (thread: Thread, attention: Attention | undefined) =>
  thread.hasPendingInteraction || thread.status === "error" || thread.queuedWork === "failed" || isUnread(thread, attention);

/**
 * The threads a filter keeps: every match with its ancestors up to the root,
 * so a match stays in its place in the tree, plus the open thread. Null keeps
 * everything.
 */
export function visibleThreads(
  filter: Filter,
  threads: readonly Thread[],
  attention: ReadonlyMap<string, Attention>,
  managers: ReadonlySet<string>,
  openThreadId: string | null,
): Set<string> | null {
  if (filter === "all") return null;
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const matches = (thread: Thread) =>
    filter === "working"
      ? isWorking(thread)
      : filter === "needs"
        ? needsYou(thread, attention.get(thread.id))
        : filter === "quiet"
          ? !isWorking(thread) && !needsYou(thread, attention.get(thread.id))
          : managers.has(thread.id);
  const visible = new Set<string>();
  // A kept thread's ancestors are kept with it, so the walk stops at the first one already kept.
  const keep = (id: string | null) => {
    for (let thread = id === null ? undefined : byId.get(id); thread && !visible.has(thread.id); thread = thread.parentThreadId === null ? undefined : byId.get(thread.parentThreadId)) visible.add(thread.id);
  };
  for (const thread of threads) if (!thread.isHidden && matches(thread)) keep(thread.id);
  keep(openThreadId);
  return visible;
}

/** The sections or projects that still show a thread under the filter; collapsed ones have no rows to tell. */
export const groupsWith = (visible: ReadonlySet<string>, threads: readonly Thread[], key: "sectionId" | "projectId") =>
  new Set(threads.flatMap((thread) => (visible.has(thread.id) && thread[key] !== null ? [thread[key]] : [])));
