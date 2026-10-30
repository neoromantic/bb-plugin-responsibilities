import { expect, mock, test } from "bun:test";

// The host supplies React; registration itself renders nothing.
mock.module("react", () => ({ useEffect() {}, useRef() {}, useState() {}, useSyncExternalStore() {} }));
// The app keeps its filter in localStorage, which bun has no instance of.
globalThis.localStorage = { getItem: () => null, setItem() {} } as unknown as Storage;
mock.module("react/jsx-runtime", () => ({ jsx() {}, jsxs() {}, Fragment: "Fragment" }));
const { default: app } = (await import("./app")) as { default: { setup(builder: unknown): void } };

test("marks, New child thread, the filter and the row-status writer register together", () => {
  const calls: unknown[][] = [];
  const record = (kind: string) => (registration: { id: string; kind?: string }) => calls.push([kind, registration.id, registration.kind]);
  app.setup({
    slots: { experimental_appOverlay: record("overlay"), experimental_threadAction: record("threadAction") },
    experimental_sidebarFooter: { register: record("footer") },
    contentScripts: { register: record("contentScript") },
  });
  expect(calls).toEqual([
    ["overlay", "responsibilities", undefined],
    ["overlay", "child-thread", undefined],
    ["threadAction", "newChildThread", undefined],
    ["footer", "filter", "disclosure"],
    ["contentScript", "row-status", undefined],
  ]);
});
