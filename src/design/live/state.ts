"use client";

import { create } from "zustand";

// Everything the doctor changes in the demo. It lasts until the browser tab is closed.
export type Block = { id: string; date: string; from: string; to: string; reason: string; note: string; notify: boolean };
export type Leave = { id: string; from: string; to: string; part: string; fromTime?: string; reason: string; notify: boolean };
export type WalkIn = { id: string; token: string; name: string; sex: string; age: string; phone: string; reason: string; time: string; pid: string };
export type Allergy = { id: string; substance: string; type: string; severity: string; reaction: string; year: string; by: string };
export type TimelineEvent = { id: string; type: string; date: string; where: string; what: string };
export type Doc = { id: string; name: string; size: string; folder: string; organ: string; date: string; url?: string };
export type Med = { id: string; name: string; dose: string; often: string; length: string; when: string; pharmacy: string };
export type Order = { id: string; type: string; test: string; lab: string; before: string; urgency: string };

export type LiveModal = { name: string; props?: Record<string, unknown> };

type Data = {
  blocks: Block[];
  leaves: Leave[];
  walkIns: WalkIn[];
  allergies: Allergy[];
  events: TimelineEvent[];
  docs: Doc[];
  meds: Med[];
  orders: Order[];
  collected: Record<string, string>;
  texts: Record<string, string>;
  hidden: Record<string, boolean>;
  checks: Record<string, boolean>;
  photo: string | null;
  theme: "Light" | "Dark";
  billingRange: "today" | "week" | "month";
  attachments: string[];
  seenTokens: string[];
};

type State = Data & {
  calMonth: string;
  calDate: string;
  calOpen: number;
  filters: Record<string, string>;
  modal: LiveModal | null;
  openModal: (name: string, props?: Record<string, unknown>) => void;
  closeModal: () => void;
  setFilter: (key: string, value: string) => void;
  showDate: (date: string) => void;
  showMonth: (month: string) => void;
  add: <K extends "blocks" | "leaves" | "walkIns" | "allergies" | "events" | "docs" | "meds" | "orders">(key: K, row: Data[K][number]) => void;
  drop: (key: "blocks" | "leaves", id: string) => void;
  setText: (id: string, value: string) => void;
  hide: (id: string) => void;
  toggleCheck: (id: string, initial: boolean) => void;
  update: (patch: Partial<Data>) => void;
};

const FIRST: Data = {
  blocks: [],
  leaves: [{ id: "seed-leave", from: "2025-05-23", to: "2025-05-23", part: "Whole day", reason: "Personal", notify: true }],
  walkIns: [],
  allergies: [],
  events: [],
  docs: [],
  meds: [],
  orders: [],
  collected: {},
  texts: {},
  hidden: {},
  checks: {},
  photo: null,
  theme: "Light",
  billingRange: "today",
  attachments: [],
  seenTokens: [],
};

const KEY = "aronexa-demo";

function saved(): Partial<Data> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.sessionStorage.getItem(KEY) ?? "{}") as Partial<Data>;
  } catch {
    return {};
  }
}

let rowId = 0;
export const newId = () => `r${Date.now().toString(36)}${++rowId}`;

export const useLive = create<State>((set) => ({
  ...FIRST,
  calMonth: "2025-05",
  calDate: "2025-05-15",
  calOpen: 0,
  filters: {},
  modal: null,
  openModal: (name, props) => set({ modal: { name, props } }),
  closeModal: () => set({ modal: null }),
  setFilter: (key, value) => set((s) => ({ filters: { ...s.filters, [key]: value } })),
  showDate: (date) => set({ calDate: date, calMonth: date.slice(0, 7) }),
  showMonth: (month) => set({ calMonth: month }),
  add: (key, row) => set((s) => ({ [key]: [row, ...(s[key] as unknown[])] }) as Partial<State>),
  drop: (key, id) => set((s) => ({ [key]: (s[key] as { id: string }[]).filter((r) => r.id !== id) }) as Partial<State>),
  setText: (id, value) => set((s) => ({ texts: { ...s.texts, [id]: value } })),
  hide: (id) => set((s) => ({ hidden: { ...s.hidden, [id]: true } })),
  toggleCheck: (id, initial) => set((s) => ({ checks: { ...s.checks, [id]: !(s.checks[id] ?? initial) } })),
  update: (patch) => set(patch),
}));

// Patient-side results that have to survive a reload and reach the doctor's tab.
const KEPT_FILTER = /^(bookings|cancelled|billPaid|familyAdded|uploads|profile|pick:)/;

function snapshot(s: State) {
  const { blocks, leaves, walkIns, allergies, events, docs, meds, orders, collected, texts, hidden, checks, photo, theme, billingRange, attachments, seenTokens, filters } = s;
  return {
    blocks, leaves, walkIns, allergies, events, docs: docs.map((d) => ({ ...d, url: undefined })), meds, orders, collected, texts, hidden, checks, photo, theme, billingRange, attachments, seenTokens,
    kept: Object.fromEntries(Object.entries(filters).filter(([k]) => KEPT_FILTER.test(k))),
  };
}

function apply(data: Partial<Data> & { kept?: Record<string, string> }) {
  const { kept, ...rest } = data;
  useLive.setState((s) => {
    const others = Object.fromEntries(Object.entries(s.filters).filter(([k]) => !KEPT_FILTER.test(k)));
    return { ...rest, filters: { ...others, ...kept } };
  });
}

// sessionStorage is only read after the first paint, so server and client markup match.
// Other tabs of the demo stay in step, so the doctor and patient sides can be shown side by side.
let restored = false;

export function restoreLive() {
  // Two listeners in one tab would keep sending each other slightly different versions forever.
  if (restored) return;
  restored = true;
  const data = saved();
  const fresh = !Object.keys(data).length;
  if (!fresh) apply(data);
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(KEY);
  let last = JSON.stringify(snapshot(useLive.getState()));
  if (channel) {
    channel.onmessage = (e: MessageEvent<{ hello?: boolean; state?: string }>) => {
      if (e.data.hello) return channel.postMessage({ state: JSON.stringify(snapshot(useLive.getState())) });
      if (!e.data.state || e.data.state === last) return;
      last = e.data.state;
      apply(JSON.parse(e.data.state));
    };
    if (fresh) channel.postMessage({ hello: true });
  }
  useLive.subscribe((s) => {
    const now = JSON.stringify(snapshot(s));
    try {
      window.sessionStorage.setItem(KEY, now);
    } catch {
      // A full or blocked store only means the demo forgets its changes on reload.
    }
    if (now === last) return;
    last = now;
    channel?.postMessage({ state: now });
  });
}
