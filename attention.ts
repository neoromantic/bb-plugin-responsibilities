import type { PluginBbSdk } from "@get-bb/plugin-sdk";
import type { PluginComposerThreadRowStatus, PluginSidebarThread } from "@get-bb/plugin-sdk/app";

/** What the plugin server recorded for a thread (epoch ms, null when never). */
export type Attention = {
  threadId: string;
  /** When the last finished run wrote visible assistant output. */
  resultAt: number | null;
  /** A root's `latestAttentionAt` from a finished run without output. */
  quietAttentionAt: number | null;
  /** The newest `resultAt` a user had open in a visible, focused window. */
  seenAt: number | null;
};

export type AttentionThread = Pick<
  PluginSidebarThread,
  "id" | "parentThreadId" | "status" | "isUnread" | "lastReadAt" | "latestAttentionAt" | "indicator"
>;

/** The row glyph of an unread thread that shows nothing else; styled as a dot. */
export const UNREAD: PluginComposerThreadRowStatus = { icon: "Circle", label: "Unread reply" };
export const FAILED: PluginComposerThreadRowStatus = { icon: "CircleX", tone: "error", label: "Thread failed" };
export const COLLAPSED_FAILED: PluginComposerThreadRowStatus = { ...FAILED, label: "A collapsed thread failed" };

type Event = Awaited<ReturnType<PluginBbSdk["threads"]["events"]["list"]>>[number];

/**
 * Scan one page of a thread's events, newest first, for the run that went
 * idle at `endedAt` (the idle transition's `updatedAt`). Returns when that run
 * wrote its last non-empty assistant message (an agent message, or a legacy
 * manager message, which BB shows as assistant text), null when its request is reached
 * without one, and undefined when the page ends first. Events after the
 * transition belong to a later run; a steer joins the running turn, so the run
 * starts at its last request that is not one.
 */
export function runResult(newestFirst: readonly Event[], endedAt: number): number | null | undefined {
  for (const event of newestFirst) {
    if (event.type === "client/turn/requested") {
      // A run's own request always precedes the transition that ends it.
      if (event.createdAt < endedAt && event.data.target.kind !== "steer") return null;
    } else if (event.createdAt <= endedAt && (event.type === "system/manager/user_message" ? event.data.text : event.type === "item/completed" && event.data.item.type === "agentMessage" && event.data.item.text)) {
      return event.createdAt;
    }
  }
  return undefined;
}

/** Every field only grows on the server, so the larger value is always the newer one. */
export function merge(known: Attention | undefined, next: Attention): Attention {
  const max = (a: number | null | undefined, b: number | null) => (a != null && (b === null || a > b) ? a : b);
  return {
    threadId: next.threadId,
    resultAt: max(known?.resultAt, next.resultAt),
    quietAttentionAt: max(known?.quietAttentionAt, next.quietAttentionAt),
    seenAt: max(known?.seenAt, next.seenAt),
  };
}

/**
 * Unread means a result nobody has looked at: newer than BB's own read mark
 * (roots) and the plugin's seen mark (all threads). A root's native unread
 * still counts, unless the plugin saw that its latest attention came from a
 * run without output.
 */
export function isUnread(thread: AttentionThread, attention: Attention | undefined): boolean {
  if (attention?.resultAt != null && attention.resultAt > Math.max(thread.lastReadAt ?? 0, attention.seenAt ?? 0)) return true;
  return thread.parentThreadId === null && thread.isUnread && thread.status !== "error" && thread.latestAttentionAt !== attention?.quietAttentionAt;
}

export type RowAttention = { status: PluginComposerThreadRowStatus | null; failed: boolean; unread: boolean; quiet: boolean };

/** Glyphs BB's collapsed parent takes over from its hidden descendants. */
const COLLAPSED_ACTIVITY = new Set(["waiting-for-input", "working-draft", "workflow", "background-agent", "background-command", "plan-mode", "goal", "runtime"]);

/**
 * One row: the thread itself plus, for a collapsed parent, its hidden
 * descendants. A failure shows the red cross. An unread result shows a dot:
 * as the row glyph when BB would show nothing else, otherwise over BB's glyph.
 * BB ignores a row status while its spinner or question shows, so `failed`
 * lets the stylesheet draw the cross there.
 */
export function rowAttention(
  thread: AttentionThread,
  group: readonly AttentionThread[],
  attention: ReadonlyMap<string, Attention>,
): RowAttention {
  const unread = group.some((member) => isUnread(member, attention.get(member.id)));
  const failure = thread.status === "error" ? FAILED : group.some((member) => member.status === "error") ? COLLAPSED_FAILED : null;
  const bbGlyph =
    !(thread.indicator === "none" || thread.indicator === "unread-success") ||
    group.some((member) => member !== thread && COLLAPSED_ACTIVITY.has(member.indicator));
  const status = failure ?? (unread && !bbGlyph ? UNREAD : null);
  return { status, failed: failure !== null, unread, quiet: !unread && thread.indicator === "unread-success" };
}
