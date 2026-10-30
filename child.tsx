import { useEffect, useState, useSyncExternalStore } from "react";
import {
  ThreadTitle,
  experimental_Icon as Icon,
  experimental_NewThreadComposer as NewThreadComposer,
  experimental_THREAD_ACTION_GROUPS,
  useBbNavigate,
  useSdk,
  type NewThreadRequest,
  type PluginThreadActionRegistration,
} from "@get-bb/plugin-sdk/app";
import { childSpawnArgs, childThreadItem, currentChildTarget, openChildComposer, subscribeChildTarget } from "./child-thread";

export const childThreadAction: PluginThreadActionRegistration = {
  id: "newChildThread",
  title: "New child thread",
  icon: "ChildThread",
  group: experimental_THREAD_ACTION_GROUPS.open,
  order: 31,
  item: ({ thread }) => childThreadItem(thread),
};

export const CHILD_CSS = `
[data-resp-child] { position: fixed; inset: 0; z-index: 48; display: flex; align-items: flex-start; justify-content: center; padding: 12vh 16px 16px; background: color-mix(in oklab, var(--background) 55%, transparent); }
[data-resp-child] > section { width: min(760px, 100%); max-height: 76vh; overflow: auto; display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--background); box-shadow: 0 12px 40px rgb(0 0 0 / .25); }
[data-resp-child] header { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: var(--text-sm); color: var(--muted-foreground); }
[data-resp-child] header > span { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--foreground); }
[data-resp-child] header > button { margin-left: auto; display: inline-flex; padding: 4px; border-radius: calc(var(--radius) - 4px); color: var(--muted-foreground); }
[data-resp-child] header > button:hover { background: var(--accent); color: var(--foreground); }
[data-resp-child] [role="alert"] { font-size: var(--text-sm); color: var(--destructive); }
`;

export function ChildComposer() {
  const parent = useSyncExternalStore(subscribeChildTarget, currentChildTarget);
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState(0);

  useEffect(() => {
    setError(null);
    if (!parent) return;
    // The row menu returns focus to its trigger as it closes; focus the prompt after that.
    const timer = setTimeout(() => setFocus((n) => n + 1), 50);
    return () => clearTimeout(timer);
  }, [parent]);

  if (!parent) return null;
  const environment = parent.environment;

  const submit = async (request: NewThreadRequest) => {
    setError(null);
    try {
      const thread = await sdk.threads.spawn(childSpawnArgs(parent, request));
      openChildComposer(null);
      navigate.toThread(thread.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      // A throw keeps the draft.
      throw cause;
    }
  };

  return (
    <div data-resp-child="" onMouseDown={(event) => event.target === event.currentTarget && openChildComposer(null)}>
      <section role="dialog" aria-modal="true" aria-label="New child thread">
        <header>
          <Icon name="ChildThread" />
          New child of
          <span>
            <ThreadTitle threadId={parent.id} />
          </span>
          <button type="button" aria-label="Close" onClick={() => openChildComposer(null)}>
            <Icon name="X" />
          </button>
        </header>
        <NewThreadComposer
          key={parent.id}
          defaultProjectId={parent.projectId}
          {...(environment ? { defaultEnvironment: { type: "reuse" as const, environmentId: environment.id } } : {})}
          defaultPermissionMode="full"
          draftKey={`child:${parent.id}`}
          layout="document"
          focusRequest={focus}
          onSubmit={submit}
        />
        {error && <div role="alert">{error}</div>}
      </section>
    </div>
  );
}
