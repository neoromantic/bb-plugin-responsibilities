import { useEffect, useSyncExternalStore } from "react";
import { useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import { merge, type Attention } from "./attention";

/** `loaded`: the first snapshot arrived. */
export type AttentionState = { attention: ReadonlyMap<string, Attention>; loaded: boolean };

// One map for every component of the app, so a second consumer adds no server read.
let state: AttentionState = { attention: new Map(), loaded: false };
const listeners = new Set<() => void>();
/** A snapshot was requested on the current connection. */
let listed = false;

const same = (a: Attention | undefined, b: Attention) =>
  a !== undefined && a.resultAt === b.resultAt && a.quietAttentionAt === b.quietAttentionAt && a.seenAt === b.seenAt;

// Snapshots and signals merge field by field, so a late snapshot cannot undo newer data.
function receive(rows: readonly Attention[], snapshot = false) {
  let next: Map<string, Attention> | null = null;
  for (const row of rows) {
    const known = (next ?? state.attention).get(row.threadId);
    const merged = merge(known, row);
    if (same(known, merged)) continue;
    next ??= new Map(state.attention);
    next.set(row.threadId, merged);
  }
  if (!next && (state.loaded || !snapshot)) return;
  state = { attention: next ?? state.attention, loaded: state.loaded || snapshot };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The plugin's attention records: loaded on connect and after a reconnect, which may have missed signals, then kept live. */
export function useAttention(): AttentionState {
  const rpc = useRpc();
  const connection = useRealtimeConnectionState();

  useEffect(() => {
    if (connection !== "connected") {
      listed = false;
      return;
    }
    if (listed) return;
    listed = true;
    rpc.call("list", {}).then(
      (rows) => receive(rows as Attention[], true),
      () => {
        listed = false;
      },
    );
  }, [rpc, connection]);

  // Every consumer hears the signal; only the first changes the map.
  useRealtime("attention", (payload) => receive([payload as Attention]));
  return useSyncExternalStore(subscribe, () => state);
}

/** Seen: the thread is shown in a visible, focused window when its result arrives or later. */
export function useSeenWhileShown(threadId: string | null, attention: ReadonlyMap<string, Attention>) {
  const rpc = useRpc();
  useEffect(() => {
    const record = threadId ? attention.get(threadId) : undefined;
    const resultAt = record?.resultAt;
    if (!record || !resultAt || (record.seenAt ?? 0) >= resultAt) return;
    const mark = () => {
      if (document.visibilityState !== "visible" || !document.hasFocus()) return;
      rpc.call("seen", { threadId: record.threadId, resultAt }).catch(() => {});
    };
    mark();
    window.addEventListener("focus", mark);
    document.addEventListener("visibilitychange", mark);
    return () => {
      window.removeEventListener("focus", mark);
      document.removeEventListener("visibilitychange", mark);
    };
  }, [rpc, threadId, attention]);
}
