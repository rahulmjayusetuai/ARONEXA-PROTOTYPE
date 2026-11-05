import { create } from "zustand";
import rawManifest from "./manifest.json";
import { intercept, type ActionContext } from "./live/actions";
import { playScreenChange } from "./live/motion";
import { useLive } from "./live/state";
import { wire } from "./live/wire";
import type { Action, DesignNode, InstanceRef, Manifest, Screen, Transition } from "./types";

export const manifest = rawManifest as unknown as Manifest;
export const screensById = new Map<string, Screen>(manifest.screens.map((s) => [s.id, s]));
export const screensBySlug = new Map<string, Screen>(manifest.screens.map((s) => [s.slug, s]));
const nodeIds = new Set(manifest.nodes);

const safe = (id: string) => id.replace(/[:;]/g, "-");
const cache = new Map<string, Promise<DesignNode | null>>();
export const loaded = new Map<string, DesignNode>();

// Loads a screen or a component state, plus every component state it can switch to.
export function load(id: string): Promise<DesignNode | null> {
  const existing = cache.get(id);
  if (existing) return existing;
  const screen = screensById.get(id);
  const url = screen
    ? `/design/screens/${screen.file}.json`
    : nodeIds.has(id)
      ? `/design/nodes/${safe(id)}.json`
      : null;
  const task: Promise<DesignNode | null> = url
    ? fetch(url)
        .then((r) => (r.ok ? (r.json() as Promise<DesignNode>) : null))
        .then(async (doc) => {
          if (!doc) return null;
          wire(doc, screen?.name ?? "");
          loaded.set(id, doc);
          const variants = new Set<string>();
          const walk = (n: DesignNode) => {
            n.a?.forEach((i) => i.acts.forEach((a) => a.k === "var" && variants.add(a.to)));
            n.ch?.forEach(walk);
          };
          walk(doc);
          await Promise.all([...variants].filter((v) => !cache.has(v)).map(load));
          return doc;
        })
        .catch(() => null)
    : Promise.resolve(null);
  cache.set(id, task);
  return task;
}

// How long a click waits for a screen's pictures before showing it anyway.
const ASSET_WAIT_MS = 300;
const warmed = new Map<string, Promise<void>>();

// Fetches a screen and decodes its pictures, so they are on the page as soon as it appears.
function warm(id: string) {
  const existing = warmed.get(id);
  if (existing) return existing;
  const task = load(id).then(async (doc) => {
    if (!doc) return;
    const urls = new Set<string>();
    const walk = (n: DesignNode) => {
      if (n.g) urls.add(`/design/vectors/${n.g}.svg`);
      n.p?.forEach((p) => {
        const file = p.k === "i" ? manifest.images[p.r] : undefined;
        if (file) urls.add(`/design/images/${file}`);
      });
      n.ch?.forEach(walk);
    };
    walk(doc);
    await Promise.all(
      [...urls].map((url) => {
        const img = new Image();
        img.src = url;
        return img.decode().catch(() => undefined);
      }),
    );
  });
  warmed.set(id, task);
  return task;
}

// Resolves when the screen can be shown, even if a slow picture is still on its way.
const whenReady = (id: string) =>
  load(id).then(() =>
    Promise.race([warm(id), new Promise<void>((done) => window.setTimeout(done, ASSET_WAIT_MS))]),
  );

// Hovering a control prepares what it opens, so the click itself has nothing to wait for.
export function warmActions(acts: Action[]) {
  for (const act of acts) {
    if ((act.k === "nav" || act.k === "ov" || act.k === "swap") && screensById.has(act.to)) void warm(act.to);
  }
}

export type Overlay = { key: number; id: string; ms: number; replaces?: number };

const DEFAULT_OVERLAY_MS = 180;
const DEFAULT_VARIANT_MS = 150;

type State = {
  screen: string;
  // The page left showing behind the calendar. Empty when the calendar was opened from a link.
  behind: string | null;
  overlays: Overlay[];
  over: Record<string, string>;
  overMs: Record<string, number>;
  vars: Record<string, string>;
  notice: string | null;
  values: Record<string, string>;
  setScreen: (id: string, behind?: string | null) => void;
  openOverlay: (id: string, ms?: number) => void;
  swapOverlay: (id: string, ms?: number) => void;
  closeOverlay: (key?: number) => void;
  setVariant: (instanceId: string, to: string, ms?: number) => void;
  setVar: (id: string, value: string) => void;
  setNotice: (text: string | null) => void;
  setValue: (id: string, value: string) => void;
};

let overlayKey = 0;

export const useDesign = create<State>((set) => ({
  screen: manifest.start,
  behind: null,
  overlays: [],
  over: {},
  overMs: {},
  vars: {},
  notice: null,
  values: {},
  // The page behind the calendar keeps the chips and tabs it had selected.
  setScreen: (id, behind = null) =>
    set((s) => {
      const samePage = behind !== null || id === s.behind;
      return { screen: id, behind, overlays: [], over: samePage ? s.over : {}, overMs: samePage ? s.overMs : {} };
    }),
  openOverlay: (id, ms = DEFAULT_OVERLAY_MS) =>
    set((s) => ({ overlays: [...s.overlays, { key: ++overlayKey, id, ms }] })),
  swapOverlay: (id, ms = DEFAULT_OVERLAY_MS) =>
    set((s) => ({ overlays: [...s.overlays.slice(0, -1), { key: ++overlayKey, id, ms, replaces: s.overlays.at(-1)?.key }] })),
  closeOverlay: (key) =>
    set((s) => ({
      overlays: key === undefined ? s.overlays.slice(0, -1) : s.overlays.filter((o) => o.key !== key),
    })),
  setVariant: (instanceId, to, ms = DEFAULT_VARIANT_MS) =>
    set((s) => ({ over: { ...s.over, [instanceId]: to }, overMs: { ...s.overMs, [instanceId]: ms } })),
  setVar: (id, value) => set((s) => ({ vars: { ...s.vars, [id]: value } })),
  setNotice: (notice) => set({ notice }),
  setValue: (id, value) => set((s) => ({ values: { ...s.values, [id]: value } })),
}));

const HOME = "232:6096";
const PATIENT_HOME = "399:6793";
let navDepth = 0;

export function pathFor(id: string) {
  const s = screensById.get(id);
  if (!s || s.id === manifest.start) return "/doctor";
  if (s.id === manifest.patientStart) return "/patient";
  return `/${s.module ?? "doctor"}/${s.slug}`;
}

let latestNav = 0;

// The calendar reads as a panel opening over the page, so it arrives more slowly than a new screen.
const CALENDAR_FADE: Transition = { t: "d", ms: 450 };
const isCalendar = (id: string) => /Calendar open/.test(screensById.get(id)?.name ?? "");
const fadeFor = (to: string, tr?: Transition) =>
  isCalendar(to) || isCalendar(useDesign.getState().screen) ? CALENDAR_FADE : tr;

// Moves to a screen once it is ready. If another click came in meanwhile, that one wins.
export function goTo(to: string, tr?: Transition) {
  const nav = ++latestNav;
  void whenReady(to).then(() => {
    if (nav !== latestNav) return;
    playScreenChange(() => {
      const now = useDesign.getState();
      const behind = !isCalendar(to) ? null : isCalendar(now.screen) ? now.behind : now.screen;
      const samePage = behind !== null || to === now.behind;
      window.history.pushState({ id: to, behind }, "", pathFor(to));
      navDepth++;
      now.setScreen(to, behind);
      if (!samePage) window.scrollTo(0, 0);
    }, fadeFor(to, tr));
  });
}

// The page to return to when the calendar closes.
export const calendarReturn = (fallback: string) => useDesign.getState().behind ?? fallback;

// The browser's own back and forward, and the app's Back buttons.
export function showFromHistory(id: string) {
  const nav = ++latestNav;
  const behind = (window.history.state as { behind?: string | null } | null)?.behind ?? null;
  void Promise.all([whenReady(id), behind && whenReady(behind)]).then(() => {
    if (nav !== latestNav) return;
    playScreenChange(() => useDesign.getState().setScreen(id, behind), fadeFor(id));
  });
}

function firstValue(n: DesignNode | null): string | undefined {
  if (!n) return undefined;
  if (n.tx && n.n === "Value") return n.tx.v;
  for (const c of n.ch ?? []) {
    const v = firstValue(c);
    if (v !== undefined) return v;
  }
  return undefined;
}

// Runs a screen's action list.
export function runActions(
  acts: Action[],
  ancestors: InstanceRef[],
  overlayKey?: number,
  source?: Omit<ActionContext, "overlay">,
) {
  const store = useDesign.getState();
  const ctx: ActionContext = { ...source, overlay: overlayKey };
  for (const original of acts) {
    const act = { ...original } as Action;
    if (intercept(act, ctx)) {
      // A form that failed its checks stays open, so the rest of the click must not run.
      if (act.k === "swap" || act.k === "ov") return;
      continue;
    }
    if (act.k === "set") {
      const state = acts.find((a) => a.k === "var");
      if (state?.k === "var") {
        void load(state.to).then((doc) => {
          const value = firstValue(doc);
          if (value !== undefined) useDesign.getState().setVar(act.v, value);
        });
      }
      continue;
    }
    const to = "to" in act ? act.to : "";
    const tr = "tr" in act ? act.tr : undefined;
    if (act.k === "close") store.closeOverlay(overlayKey);
    else if (act.k === "back") {
      if (useDesign.getState().overlays.length) store.closeOverlay();
      else if (navDepth > 0) {
        navDepth--;
        window.history.back();
      } else {
        // Opened straight from a link, so there is nothing to go back to inside the app.
        const home = screensById.get(useDesign.getState().screen)?.module ? PATIENT_HOME : HOME;
        goTo(home);
      }
    } else if (act.k === "url") window.open(to, "_blank", "noopener");
    else if (act.k === "nav") {
      if (screensById.has(to)) {
        goTo(to, tr);
      } else switchVariant(to, ancestors, tr);
    } else if (act.k === "ov") {
      void whenReady(to).then(() => useDesign.getState().openOverlay(to, tr?.ms));
    } else if (act.k === "swap") {
      void whenReady(to).then(() => useDesign.getState().swapOverlay(to, tr?.ms));
    } else if (act.k === "var") {
      switchVariant(to, ancestors, tr);
      groupChips(to, ctx);
    }
  }
}

// Chips and segments in one group are a single choice.
const ON_OFF: Record<string, string> = { "189:4360": "189:4358", "189:4367": "189:4365", "449:11695": "449:11693" };
function groupChips(to: string, ctx: ActionContext) {
  const off = ON_OFF[to];
  const onOf = Object.keys(ON_OFF).find((k) => ON_OFF[k] === to);
  const { parent, node } = ctx;
  if (!parent || !node) return;
  const store = useDesign.getState();
  if (off) {
    // A spacer between chips separates two groups that share one row.
    const sibs = parent.ch ?? [];
    const at = sibs.findIndex((c) => c.id === node.id);
    const isChip = (c: DesignNode) => c.t === "I" && (c.cid === to || c.cid === off);
    let start = at;
    while (start > 0 && isChip(sibs[start - 1])) start--;
    let end = at;
    while (end < sibs.length - 1 && isChip(sibs[end + 1])) end++;
    const group = sibs.slice(start, end + 1);
    for (const c of group) {
      if (c.id !== node.id && (store.over[c.id] ?? c.cid) === to) {
        void load(off).then(() => useDesign.getState().setVariant(c.id, off));
      }
    }
    choose(group, nodeText(node));
  } else if (onOf) {
    // Pressing the selected chip keeps it selected.
    void load(onOf).then(() => useDesign.getState().setVariant(node.id, onOf));
  }
}

const nodeText = (n: DesignNode): string => n.tx?.v ?? n.ch?.map(nodeText).join("") ?? "";

function choose(group: DesignNode[], label: string) {
  const live = useLive.getState();
  if (/ only$/.test(label)) live.setFilter("visits", label.replace(" only", ""));
  if (label === "All visits") live.setFilter("visits", "");
  const screen = screensById.get(useDesign.getState().screen)?.name ?? "";
  if (screen.startsWith("Patient web / Find care") && group[0]) live.setFilter(`care:${nodeText(group[0])}`, label);
  if (screen === "Patient web / Book appointment" && /^(James|Mary|Ella)/.test(label)) live.setFilter("bookFor", label.split(" ")[0]);
  if (screen.startsWith("Patient / Clinical notes")) {
    const isType = group.some((c) => nodeText(c) === "Any type");
    live.setFilter(isType ? "noteType" : "noteOrgan", label);
  }
}

function switchVariant(to: string, ancestors: InstanceRef[], tr?: Transition) {
  const set = manifest.compSets[to];
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const a = ancestors[i];
    if (a.cid === to || (a.cid && manifest.compSets[a.cid] === set)) {
      const id = a.id;
      void load(to).then(() => useDesign.getState().setVariant(id, to, tr?.ms));
      return;
    }
  }
}
