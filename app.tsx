import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  definePluginApp,
  experimental_useRpcQuery as useRpcQuery,
  experimental_useSidebarThreads as useSidebarThreads,
  useBbContext,
  useSettings,
  type ExperimentalSidebarFooterDisclosureProps,
  type PluginComposerThreadRowStatus,
  type PluginContentScriptContext,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { rowAttention, type Attention } from "./attention";
import { CHILD_CSS, ChildComposer, childThreadAction } from "./child";
import { contract } from "./contract";
import { FILTERS, groupsWith, visibleThreads, type Filter } from "./filter";
import { COMPACT_THEME } from "./theme";
import { useAttention, useSeenWhileShown } from "./use-attention";

const ROW = "[data-sidebar-rename-row]";
/** BB's lazy list wraps each item, mounted or not; an unmounted one names its threads in `data-sidebar-windowed-nav`. */
const ITEM = "[data-sidebar-windowed-item]";
/** Manager titles may carry this marker; the row hides it. */
const MARKER = "○ ";
const FILTER_LABEL = "Filter threads";
const FILTER_KEY = "responsibilities:filter";

/** Set by the content script, which is the only holder of BB's row-status writer. */
let setRowStatus: PluginContentScriptContext["experimental_setThreadRowStatus"];
let onRowStatusWriter = () => {};

// One filter for the whole list, kept per device.
let filter = (localStorage.getItem(FILTER_KEY) ?? "all") as Filter;
const filterListeners = new Set<() => void>();
function setFilter(next: Filter) {
  filter = next;
  localStorage.setItem(FILTER_KEY, next);
  for (const listener of filterListeners) listener();
}
function subscribeFilter(listener: () => void) {
  filterListeners.add(listener);
  return () => {
    filterListeners.delete(listener);
  };
}

/** BB's CircleX glyph, for the failure BB will not draw over its spinner or question. */
const CIRCLE_X = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>')}`;

/** BB's Loading glyph. BB spins the <svg> itself, which Chromium animates on the main thread at every frame; drawn on the indicator, the same spin runs on the compositor. */
const LOADING = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="1.5" stroke-linecap="round"><path d="M12 3V6M12 18V21M21 12L18 12M6 12L3 12M18.3635 5.63672L16.2422 7.75804M7.75804 16.2422L5.63672 18.3635M18.3635 18.3635L16.2422 16.2422M7.75804 7.75804L5.63672 5.63672"/></svg>')}`;

const CSS = `
[data-resp-manager] .bb-thread-title { font-weight: 600; color: light-dark(oklch(from var(--sidebar-foreground) calc(l - .12) c h), oklch(from var(--sidebar-foreground) calc(l + .14) c h)); }
[data-sidebar-thread-trailing-indicator] > [data-icon="CircleQuestion"] { color: var(--warning); }
[data-sidebar-thread-trailing-indicator] > [data-icon="Circle"][aria-label="Unread reply"] { width: 6px; height: 6px; border-radius: 50%; background: var(--sidebar-foreground); }
[data-sidebar-thread-trailing-indicator] > [data-icon="Circle"][aria-label="Unread reply"] > * { display: none; }
[data-resp-quiet] [data-sidebar-thread-trailing-indicator] > span:not([data-icon-root]) { display: none; }
[data-sidebar-thread-trailing-indicator]:has(> [data-icon-root]) { position: relative; }
[data-sidebar-thread-trailing-indicator] > [data-icon="Loading"] { visibility: hidden; animation: none; }
[data-sidebar-thread-trailing-indicator]:has(> [data-icon="Loading"])::before { content: ""; position: absolute; inset: 0; background: color-mix(in oklab, var(--muted-foreground) 50%, transparent); mask: url("${LOADING}") center / contain no-repeat; animation: spin 1s linear infinite; }
@media (prefers-reduced-motion: reduce) { [data-sidebar-thread-trailing-indicator]:has(> [data-icon="Loading"])::before { animation: none; } }
[data-resp-failed] [data-sidebar-thread-trailing-indicator]:has(> [data-icon="Loading"], > [data-icon="CircleQuestion"]) > * { visibility: hidden; }
[data-resp-failed] [data-sidebar-thread-trailing-indicator]:has(> [data-icon="Loading"], > [data-icon="CircleQuestion"])::before { content: ""; position: absolute; inset: 0; background: var(--destructive); mask: url("${CIRCLE_X}") center / contain no-repeat; animation: none; }
[data-resp-unread] [data-sidebar-thread-trailing-indicator]:has(> [data-icon-root]:not([data-icon="Circle"]))::after { content: ""; position: absolute; top: -1px; right: -1.5px; width: 6px; height: 6px; border-radius: 50%; background: var(--sidebar-foreground); box-shadow: 0 0 0 1.5px var(--sidebar); }
[data-resp-hidden] { display: none !important; }
[data-resp-summary] { display: inline-flex; flex-shrink: 0; gap: 5px; font-size: var(--text-xs); font-variant-numeric: tabular-nums; white-space: nowrap; }
[data-resp-summary-kind="working"] { color: var(--muted-foreground); }
[data-resp-summary-kind="waiting"] { color: var(--warning-text); }
[data-resp-summary-kind="failed"] { color: var(--destructive-text); }
[data-sidebar-rename-row]:has([data-sidebar-hover-actions-open="true"]) [data-resp-summary] { opacity: 0; }
button[aria-label="${FILTER_LABEL}"][data-resp-filtered] { color: var(--primary); }
[data-resp-filters] { display: flex; flex-direction: column; gap: 2px; padding: 4px; }
[data-resp-filters] button { display: flex; padding: 4px 8px; border-radius: calc(var(--radius) - 4px); font-size: var(--text-sm); text-align: left; color: var(--sidebar-foreground); }
[data-resp-filters] button:hover { background: var(--sidebar-accent); }
[data-resp-filters] button[aria-pressed="true"] { font-weight: 600; background: var(--sidebar-accent); }
`;

function toggle(element: HTMLElement, name: string, on: boolean) {
  if (on !== element.hasAttribute(name)) element.toggleAttribute(name, on);
}

/** The title's first text node, where the manager marker sits. */
function titleText(row: HTMLElement): Text | null {
  const title = row.querySelector(".bb-thread-title");
  const text = title && document.createTreeWalker(title, NodeFilter.SHOW_TEXT).nextNode();
  return text instanceof Text ? text : null;
}

function Responsibilities() {
  const { values } = useSettings();
  const { threads } = useSidebarThreads();
  const { attention } = useAttention();
  const { data: managerIds } = useRpcQuery({ contract, method: "managers", input: {} });
  const { threadId: openThreadId } = useBbContext();
  const current = useSyncExternalStore(subscribeFilter, () => filter);
  const managers = new Set(managerIds);
  const latest = useRef({ threads, attention, managers, current, openThreadId });
  latest.current = { threads, attention, managers, current, openThreadId };
  const schedule = useRef(() => {});
  useSeenWhileShown(openThreadId, attention);

  useEffect(() => {
    let alive = true;
    let frame = 0;
    let hoveredThreadId: string | null = null;
    // Row statuses this generation of the writer currently holds.
    const shown = new Map<string, PluginComposerThreadRowStatus>();
    // Parents last seen collapsed. BB's lazy list unmounts rows as they scroll away, and a status has to
    // outlive that: every status change re-renders each section at once.
    const collapsedIds = new Set<string>();
    onRowStatusWriter = () => {
      shown.clear();
      schedule.current();
    };

    const syncRows = (threads: readonly PluginSidebarThread[], attention: ReadonlyMap<string, Attention>, managers: ReadonlySet<string>, openThreadId: string | null) => {
      const byId = new Map(threads.map((thread) => [thread.id, thread]));
      const children = Map.groupBy(threads.filter((thread) => !thread.isHidden), (thread) => thread.parentThreadId);
      const descendants = (id: string): PluginSidebarThread[] => (children.get(id) ?? []).flatMap((child) => [child, ...descendants(child.id)]);
      const statuses = new Map<string, PluginComposerThreadRowStatus | null>();
      const pathIds = new Set<string>();
      const guideIds = new Set<string>();
      const guides = new Map<Element, string>();
      for (const start of [openThreadId, hoveredThreadId]) {
        let parentId = start;
        while (parentId !== null) {
          const parent = byId.get(parentId);
          if (!parent) break;
          if (start === openThreadId) pathIds.add(parent.id);
          guideIds.add(parent.id);
          parentId = parent.parentThreadId;
        }
      }
      // From the link up: a section's sticky group carries the row attribute too.
      for (const link of document.querySelectorAll<HTMLElement>("a[data-sidebar-thread-id]")) {
        const row = link.closest<HTMLElement>(ROW);
        const thread = byId.get(link.dataset.sidebarThreadId ?? "");
        if (!row || !thread) continue;
        if (guideIds.has(thread.id)) {
          const item = row.closest(ITEM);
          if (item?.parentElement?.parentElement?.querySelector(":scope > .group\\/thread-row")) {
            if (guides.get(item) === "through") guides.set(item, "both");
            else if (!guides.has(item)) guides.set(item, "end");
            for (let sibling = item.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
              if (!sibling.matches(ITEM)) continue;
              if (guides.get(sibling) === "end") guides.set(sibling, "both");
              else if (!guides.has(sibling)) guides.set(sibling, "through");
            }
          }
        }
        const collapsed = row.querySelector('button[data-sidebar-rename-anchor][aria-expanded="false"]') !== null;
        if (collapsed) collapsedIds.add(thread.id);
        else collapsedIds.delete(thread.id);
        const state = rowAttention(thread, collapsed ? [thread, ...descendants(thread.id)] : [thread], attention);
        statuses.set(thread.id, state.status);
        let summary = row.querySelector<HTMLElement>("[data-resp-summary]");
        const counts = [["working", "↻", state.summary.working], ["waiting", "?", state.summary.waiting], ["failed", "×", state.summary.failed]] as const;
        if (counts.every(([, , count]) => count === 0)) summary?.remove();
        else {
          if (!summary) {
            summary = document.createElement("span");
            summary.dataset.respSummary = "";
            summary.className = "bb-sidebar-hover-actions-fade";
            row.querySelector("[data-sidebar-thread-trailing]")!.prepend(summary);
          }
          const countsKey = JSON.stringify(state.summary);
          if (summary.dataset.counts !== countsKey) {
            summary.dataset.counts = countsKey;
            summary.replaceChildren(...counts.filter(([, , count]) => count > 0).map(([kind, symbol, count]) => {
              const badge = document.createElement("span");
              badge.dataset.respSummaryKind = kind;
              badge.textContent = `${symbol} ${count}`;
              badge.title = `Collapsed descendants ${kind}: ${count}`;
              badge.setAttribute("role", "img");
              badge.setAttribute("aria-label", badge.title);
              return badge;
            }));
          }
        }
        toggle(row, "data-resp-path", pathIds.has(thread.id));
        toggle(row, "data-resp-failed", state.failed);
        toggle(row, "data-resp-unread", state.unread);
        toggle(row, "data-resp-quiet", state.quiet);
        const manager = managers.has(thread.id);
        toggle(row, "data-resp-manager", manager);
        // Cut from the visible text only; the stored title, tooltip and link label keep it.
        const text = titleText(row);
        if (manager && text?.data.startsWith(MARKER)) {
          text.data = text.data.slice(MARKER.length);
          row.setAttribute("data-resp-marker", "");
        } else if (!manager && row.hasAttribute("data-resp-marker")) {
          if (text && !text.data.startsWith(MARKER)) text.data = MARKER + text.data;
          row.removeAttribute("data-resp-marker");
        }
      }
      for (const item of document.querySelectorAll("[data-resp-guide]")) {
        if (!guides.has(item)) item.removeAttribute("data-resp-guide");
      }
      for (const [item, kind] of guides) {
        if (item.getAttribute("data-resp-guide") !== kind) item.setAttribute("data-resp-guide", kind);
      }
      if (!setRowStatus) return;
      for (const thread of threads) {
        if (thread.isHidden || statuses.has(thread.id)) continue;
        statuses.set(thread.id, rowAttention(thread, collapsedIds.has(thread.id) ? [thread, ...descendants(thread.id)] : [thread], attention).status);
      }
      for (const [id, status] of statuses) {
        if ((shown.get(id) ?? null) === status) continue;
        setRowStatus(id, status);
        if (status) shown.set(id, status);
        else shown.delete(id);
      }
      for (const id of shown.keys()) {
        if (statuses.has(id)) continue;
        setRowStatus(id, null);
        shown.delete(id);
      }
    };

    // Hides whole list items, mounted or not, so BB's lazy list closes the gaps itself. A thread or group
    // item stays while any thread in it, mounted or not, is kept; the same rule holds in both states.
    const syncFilter = (visible: ReadonlySet<string> | null, threads: readonly PluginSidebarThread[]) => {
      if (visible === null) {
        for (const element of document.querySelectorAll("[data-resp-hidden], [data-resp-filtered]")) {
          element.removeAttribute("data-resp-hidden");
          element.removeAttribute("data-resp-filtered");
        }
        return;
      }
      // A section or project container is never hidden whole: its threads may sit in a collapsed group that
      // neither mounts nor names them. Its section or project element is judged by data below instead.
      const byId = new Map(threads.map((thread) => [thread.id, thread]));
      for (const item of document.querySelectorAll<HTMLElement>(ITEM)) {
        const held = [...item.querySelectorAll<HTMLElement>("a[data-sidebar-thread-id]")].map((link) => link.dataset.sidebarThreadId);
        for (const lazy of [item, ...item.querySelectorAll(ITEM)]) held.push(...(lazy.getAttribute("data-sidebar-windowed-nav")?.split(" ") ?? []).map((entry) => entry.split(":")[0]));
        // Unmounted, a top-level item whose first thread is in a section is that section; nested items are threads or groups.
        const container =
          item.childElementCount > 0
            ? item.querySelector("[data-sidebar-section-id], [data-sidebar-project-id]") !== null
            : item.parentElement?.closest(ITEM) === null && byId.get(held[0] ?? "")?.sectionId != null;
        toggle(item, "data-resp-hidden", visible !== null && !container && held.length > 0 && !held.some((id) => id !== undefined && visible.has(id)));
      }
      // Pinned rows sit outside the lazy list.
      for (const link of document.querySelectorAll<HTMLElement>("a[data-sidebar-thread-id]")) {
        const row = link.closest(ITEM) ? null : link.closest<HTMLElement>(ROW);
        if (row) toggle(row, "data-resp-hidden", visible !== null && !visible.has(link.dataset.sidebarThreadId ?? ""));
      }
      // A collapsed section or project mounts no rows, so its threads are told by data. A collapsed
      // environment group has neither rows nor an id on its header, so it stays.
      const sections = visible === null ? null : groupsWith(visible, threads, "sectionId");
      for (const section of document.querySelectorAll<HTMLElement>("[data-sidebar-section-id]")) {
        toggle(section, "data-resp-hidden", sections !== null && !sections.has(section.dataset.sidebarSectionId ?? ""));
      }
      const projects = visible === null ? null : groupsWith(visible, threads, "projectId");
      for (const project of document.querySelectorAll<HTMLElement>("[data-sidebar-project-id]")) {
        toggle(project, "data-resp-hidden", projects !== null && !projects.has(project.dataset.sidebarProjectId ?? ""));
      }
      const button = document.querySelector<HTMLElement>(`button[aria-label="${FILTER_LABEL}"]`);
      if (button) toggle(button, "data-resp-filtered", visible !== null);
    };

    const sync = () => {
      frame = 0;
      const { threads, attention, managers, current, openThreadId } = latest.current;
      syncRows(threads, attention, managers, openThreadId);
      const visible = visibleThreads(current, threads, attention, managers, openThreadId);
      syncFilter(visible, threads);
    };

    schedule.current = () => {
      if (alive && !frame) frame = requestAnimationFrame(sync);
    };

    const touchesSidebar = (node: Node) => node instanceof Element && (node.matches(`${ROW}, ${ITEM}`) || node.querySelector(`${ROW}, ${ITEM}`) !== null || node.closest(ROW) !== null);
    const observer = new MutationObserver((records) => {
      if (frame) return;
      if (records.some((record) => touchesSidebar(record.target) || [...record.addedNodes].some(touchesSidebar))) schedule.current();
    });
    observer.observe(document.body, { subtree: true, childList: true });
    const hover = (event: PointerEvent) => {
      if (event.type === "pointerout" && event.relatedTarget !== null) return;
      const link = (event.target as Element).closest(ROW)?.querySelector<HTMLElement>("a[data-sidebar-thread-id]");
      let next: string | null = null;
      if (event.pointerType !== "touch" && event.type === "pointerover" && link) next = link.dataset.sidebarThreadId!;
      if (next === hoveredThreadId) return;
      hoveredThreadId = next;
      schedule.current();
    };
    document.addEventListener("pointerover", hover);
    document.addEventListener("pointerout", hover);
    schedule.current();

    return () => {
      alive = false;
      observer.disconnect();
      document.removeEventListener("pointerover", hover);
      document.removeEventListener("pointerout", hover);
      cancelAnimationFrame(frame);
      for (const summary of document.querySelectorAll("[data-resp-summary]")) summary.remove();
      const names = ["data-resp-guide", "data-resp-path", "data-resp-failed", "data-resp-unread", "data-resp-quiet", "data-resp-manager", "data-resp-marker", "data-resp-hidden", "data-resp-filtered"];
      for (const row of document.querySelectorAll<HTMLElement>(names.map((name) => `[${name}]`).join(", "))) {
        const text = row.hasAttribute("data-resp-marker") ? titleText(row) : null;
        if (text && !text.data.startsWith(MARKER)) text.data = MARKER + text.data;
        for (const name of names) row.removeAttribute(name);
      }
      // BB clears this generation's row statuses itself when the plugin deactivates.
      onRowStatusWriter = () => {};
    };
  }, []);

  useEffect(() => schedule.current(), [threads, attention, managerIds, current, openThreadId]);

  return <>
    <style>{CSS + CHILD_CSS}</style>
    {values?.compactTheme === true && <style>{COMPACT_THEME}</style>}
  </>;
}

function FilterMenu({ dismiss }: ExperimentalSidebarFooterDisclosureProps) {
  const current = useSyncExternalStore(subscribeFilter, () => filter);
  return (
    <div data-resp-filters="" role="group" aria-label={FILTER_LABEL}>
      {FILTERS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          aria-pressed={current === id}
          onClick={() => {
            setFilter(id);
            dismiss();
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "responsibilities", component: Responsibilities });
  app.slots.experimental_appOverlay({ id: "child-thread", component: ChildComposer });
  app.slots.experimental_threadAction(childThreadAction);
  app.experimental_sidebarFooter.register({ kind: "disclosure", id: "filter", label: FILTER_LABEL, icon: "Filter", component: FilterMenu });
  app.contentScripts.register({
    id: "row-status",
    mount(context) {
      const writer = context.experimental_setThreadRowStatus;
      setRowStatus = writer;
      onRowStatusWriter();
      return () => {
        if (setRowStatus === writer) setRowStatus = undefined;
      };
    },
  });
});
