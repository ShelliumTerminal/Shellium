/**
 * Split view: a tab holds one to MAX_PANES sessions in a binary layout tree (tmux-style "split
 * right / split down"). Every pane is an ordinary Session with its own SSH connection; the tree only
 * says where it sits. No React here.
 */

import type { CSSProperties } from "react";

export const MAX_PANES = 4;
/** Space between two panes, in px (the divider's grab area). */
export const PANE_GAP = 6;
/** Smallest share a pane keeps when a divider is dragged. */
const MIN_RATIO = 0.12;

/** "row": side by side (split right), "column": stacked (split down). */
export type SplitDirection = "row" | "column";

export type PaneNode =
  | { kind: "pane"; sessionId: string }
  | { kind: "split"; id: string; direction: SplitDirection; ratio: number; first: PaneNode; second: PaneNode };

export type SessionTab = {
  id: string;
  root: PaneNode;
  /** The pane that was focused last in this tab (selected again when the tab is selected). */
  focusedSessionId: string;
};

/** Position in percent of the stage. */
export type PaneRect = { left: number; top: number; width: number; height: number };

export type PaneEdge = "left" | "right" | "top" | "bottom";

let idCounter = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

export function createTab(sessionId: string): SessionTab {
  return { id: newId("tab"), root: { kind: "pane", sessionId }, focusedSessionId: sessionId };
}

export function paneIds(node: PaneNode): string[] {
  return node.kind === "pane" ? [node.sessionId] : [...paneIds(node.first), ...paneIds(node.second)];
}

export function tabSessionIds(tab: SessionTab): string[] {
  return paneIds(tab.root);
}

export function findTabOf(tabs: SessionTab[], sessionId: string): SessionTab | null {
  return tabs.find((tab) => paneIds(tab.root).includes(sessionId)) ?? null;
}

/** The tree without `sessionId`; its sibling takes the parent's place. null when nothing is left. */
function removePane(node: PaneNode, sessionId: string): PaneNode | null {
  if (node.kind === "pane") {
    return node.sessionId === sessionId ? null : node;
  }
  const first = removePane(node.first, sessionId);
  const second = removePane(node.second, sessionId);
  if (!first) {
    return second;
  }
  if (!second) {
    return first;
  }
  return first === node.first && second === node.second ? node : { ...node, first, second };
}

/** Puts `insert` next to the pane `targetId`, on its `edge`. */
function insertAt(node: PaneNode, targetId: string, insert: PaneNode, edge: PaneEdge): PaneNode {
  if (node.kind === "pane") {
    if (node.sessionId !== targetId) {
      return node;
    }
    const direction: SplitDirection = edge === "left" || edge === "right" ? "row" : "column";
    const before = edge === "left" || edge === "top";
    return {
      kind: "split",
      id: newId("split"),
      direction,
      ratio: 0.5,
      first: before ? insert : node,
      second: before ? node : insert,
    };
  }
  const first = insertAt(node.first, targetId, insert, edge);
  const second = insertAt(node.second, targetId, insert, edge);
  return first === node.first && second === node.second ? node : { ...node, first, second };
}

/**
 * Brings the tab list in line with the sessions: panes of closed sessions leave their trees (empty
 * tabs go away), and every session that sits in no tab gets a tab of its own at the end.
 */
export function reconcileTabs(tabs: SessionTab[], sessionIds: string[]): SessionTab[] {
  const live = new Set(sessionIds);
  const placed = new Set<string>();
  let changed = false;
  const next: SessionTab[] = [];

  for (const tab of tabs) {
    let root: PaneNode | null = tab.root;
    for (const id of paneIds(tab.root)) {
      if (!live.has(id) || placed.has(id)) {
        root = root && removePane(root, id);
      }
    }
    if (!root) {
      changed = true;
      continue;
    }
    const ids = paneIds(root);
    ids.forEach((id) => placed.add(id));
    const focusedSessionId = ids.includes(tab.focusedSessionId) ? tab.focusedSessionId : ids[0];
    if (root !== tab.root || focusedSessionId !== tab.focusedSessionId) {
      changed = true;
      next.push({ ...tab, root, focusedSessionId });
    } else {
      next.push(tab);
    }
  }

  for (const id of sessionIds) {
    if (!placed.has(id)) {
      changed = true;
      next.push(createTab(id));
    }
  }

  return changed ? next : tabs;
}

/** Splits the pane `targetId` and puts the new session `sessionId` on its `edge`. */
export function splitPane(tabs: SessionTab[], targetId: string, sessionId: string, edge: PaneEdge): SessionTab[] {
  const tab = findTabOf(tabs, targetId);
  if (!tab || paneIds(tab.root).length >= MAX_PANES) {
    return tabs;
  }
  const insert: PaneNode = { kind: "pane", sessionId };
  // the new session may already have a tab of its own (reconcile ran first): take it out of there
  const without = tabs
    .map((item) => (item.id === tab.id ? item : { ...item, root: removePane(item.root, sessionId) }))
    .filter((item): item is SessionTab => item.root !== null);
  return without.map((item) =>
    item.id === tab.id ? { ...item, root: insertAt(item.root, targetId, insert, edge), focusedSessionId: sessionId } : item);
}

/**
 * Moves the whole tab `sourceTabId` into the tab that holds `targetId`, on that pane's `edge`
 * (drag a tab onto a terminal). Refused (unchanged) past MAX_PANES or onto itself.
 */
export function mergeTab(tabs: SessionTab[], sourceTabId: string, targetId: string, edge: PaneEdge): SessionTab[] {
  const source = tabs.find((tab) => tab.id === sourceTabId);
  const target = findTabOf(tabs, targetId);
  if (!source || !target || source.id === target.id) {
    return tabs;
  }
  if (paneIds(source.root).length + paneIds(target.root).length > MAX_PANES) {
    return tabs;
  }
  return tabs
    .filter((tab) => tab.id !== source.id)
    .map((tab) =>
      tab.id === target.id
        ? { ...tab, root: insertAt(tab.root, targetId, source.root, edge), focusedSessionId: source.focusedSessionId }
        : tab);
}

/** Takes the pane `sessionId` out of its tab into a new tab right after it. */
export function detachPane(tabs: SessionTab[], sessionId: string): SessionTab[] {
  const index = tabs.findIndex((tab) => paneIds(tab.root).includes(sessionId));
  if (index < 0 || tabs[index].root.kind === "pane") {
    return tabs;
  }
  const tab = tabs[index];
  const root = removePane(tab.root, sessionId)!;
  const remaining = paneIds(root);
  const rest = { ...tab, root, focusedSessionId: remaining.includes(tab.focusedSessionId) ? tab.focusedSessionId : remaining[0] };
  return [...tabs.slice(0, index), rest, createTab(sessionId), ...tabs.slice(index + 1)];
}

export function setSplitRatio(tabs: SessionTab[], splitId: string, ratio: number): SessionTab[] {
  const clamped = Math.min(1 - MIN_RATIO, Math.max(MIN_RATIO, ratio));
  const update = (node: PaneNode): PaneNode => {
    if (node.kind === "pane") {
      return node;
    }
    if (node.id === splitId) {
      return node.ratio === clamped ? node : { ...node, ratio: clamped };
    }
    const first = update(node.first);
    const second = update(node.second);
    return first === node.first && second === node.second ? node : { ...node, first, second };
  };
  let changed = false;
  const next = tabs.map((tab) => {
    const root = update(tab.root);
    if (root === tab.root) {
      return tab;
    }
    changed = true;
    return { ...tab, root };
  });
  return changed ? next : tabs;
}

export function setTabFocus(tabs: SessionTab[], sessionId: string): SessionTab[] {
  const tab = findTabOf(tabs, sessionId);
  if (!tab || tab.focusedSessionId === sessionId) {
    return tabs;
  }
  return tabs.map((item) => (item === tab ? { ...item, focusedSessionId: sessionId } : item));
}

/** Moves the tab holding `sourceId` next to the tab holding `targetId` (drag to reorder). */
export function moveTab(tabs: SessionTab[], sourceId: string, targetId: string): SessionTab[] {
  const source = findTabOf(tabs, sourceId);
  const target = findTabOf(tabs, targetId);
  if (!source || !target || source === target) {
    return tabs;
  }
  const sourceIndex = tabs.indexOf(source);
  const targetIndex = tabs.indexOf(target);
  const next = tabs.filter((tab) => tab !== source);
  next.splice(targetIndex, 0, source);
  return sourceIndex === targetIndex ? tabs : next;
}

export type PaneLayout = {
  panes: Array<{ sessionId: string; rect: PaneRect }>;
  /** The draggable line between the two halves of each split, in stage percent. */
  dividers: Array<{ splitId: string; direction: SplitDirection; rect: PaneRect; parent: PaneRect }>;
};

/** Percent rectangles of every pane and divider of a tree laid out in the whole stage. */
export function layoutTree(root: PaneNode): PaneLayout {
  const layout: PaneLayout = { panes: [], dividers: [] };
  const walk = (node: PaneNode, rect: PaneRect) => {
    if (node.kind === "pane") {
      layout.panes.push({ sessionId: node.sessionId, rect });
      return;
    }
    if (node.direction === "row") {
      const firstWidth = rect.width * node.ratio;
      walk(node.first, { ...rect, width: firstWidth });
      walk(node.second, { ...rect, left: rect.left + firstWidth, width: rect.width - firstWidth });
      layout.dividers.push({ splitId: node.id, direction: "row", rect: { ...rect, left: rect.left + firstWidth, width: 0 }, parent: rect });
    } else {
      const firstHeight = rect.height * node.ratio;
      walk(node.first, { ...rect, height: firstHeight });
      walk(node.second, { ...rect, top: rect.top + firstHeight, height: rect.height - firstHeight });
      layout.dividers.push({ splitId: node.id, direction: "column", rect: { ...rect, top: rect.top + firstHeight, height: 0 }, parent: rect });
    }
  };
  walk(root, { left: 0, top: 0, width: 100, height: 100 });
  return layout;
}

/** Which edge of a box a point (0..1 in both axes) is nearest to: the drop side of a dragged tab. */
export function nearestEdge(x: number, y: number): PaneEdge {
  const distances: Array<[PaneEdge, number]> = [["left", x], ["right", 1 - x], ["top", y], ["bottom", 1 - y]];
  return distances.reduce((best, item) => (item[1] < best[1] ? item : best))[0];
}

/** Absolute position of a pane in the stage, leaving half a gap on every inner edge. */
export function paneStyle(rect: PaneRect): CSSProperties {
  const epsilon = 0.01;
  const half = PANE_GAP / 2;
  const insetLeft = rect.left > epsilon ? half : 0;
  const insetRight = rect.left + rect.width < 100 - epsilon ? half : 0;
  const insetTop = rect.top > epsilon ? half : 0;
  const insetBottom = rect.top + rect.height < 100 - epsilon ? half : 0;
  return {
    position: "absolute",
    left: `calc(${rect.left}% + ${insetLeft}px)`,
    top: `calc(${rect.top}% + ${insetTop}px)`,
    width: `calc(${rect.width}% - ${insetLeft + insetRight}px)`,
    height: `calc(${rect.height}% - ${insetTop + insetBottom}px)`,
  };
}

/** Drags a pane by its title row onto `edge` of the pane `targetId` (same tab: rearrange). */
export function movePane(tabs: SessionTab[], sessionId: string, targetId: string, edge: PaneEdge): SessionTab[] {
  const source = findTabOf(tabs, sessionId);
  const target = findTabOf(tabs, targetId);
  if (!source || !target || sessionId === targetId) {
    return tabs;
  }
  if (source !== target && paneIds(target.root).length >= MAX_PANES) {
    return tabs;
  }
  const insert: PaneNode = { kind: "pane", sessionId };
  return tabs
    .map((tab) => {
      let root: PaneNode | null = tab.root;
      if (tab === source) {
        root = removePane(root, sessionId);
      }
      if (root && tab === target) {
        return { ...tab, root: insertAt(root, targetId, insert, edge), focusedSessionId: sessionId };
      }
      if (!root) {
        return null;
      }
      const ids = paneIds(root);
      return root === tab.root ? tab : { ...tab, root, focusedSessionId: ids.includes(tab.focusedSessionId) ? tab.focusedSessionId : ids[0] };
    })
    .filter((tab): tab is SessionTab => tab !== null);
}

/** Swaps two panes (a pane dropped onto the middle of another); the layout stays as it is. */
export function swapPanes(tabs: SessionTab[], first: string, second: string): SessionTab[] {
  if (first === second) {
    return tabs;
  }
  const swap = (node: PaneNode): PaneNode => {
    if (node.kind === "pane") {
      return node.sessionId === first ? { kind: "pane", sessionId: second }
        : node.sessionId === second ? { kind: "pane", sessionId: first }
          : node;
    }
    const a = swap(node.first);
    const b = swap(node.second);
    return a === node.first && b === node.second ? node : { ...node, first: a, second: b };
  };
  return tabs.map((tab) => {
    const root = swap(tab.root);
    return root === tab.root ? tab : { ...tab, root };
  });
}
