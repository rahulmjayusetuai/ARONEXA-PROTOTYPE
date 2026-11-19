import type { Action, DesignNode } from "../types";
import { isPatientScreen, patientDoc } from "./patient";
import { ALL_PATIENTS, baseAppointments, collectedExtra, TODAY } from "./schedule";
import { readQuestions, useLive } from "./state";
import EXPLAIN_AUDIO from "./explain-audio.json";
import manifest from "../manifest.json";

type Live = ReturnType<typeof useLive.getState>;

export const findNode = (n: DesignNode, test: (x: DesignNode) => boolean): DesignNode | undefined => {
  if (test(n)) return n;
  for (const c of n.ch ?? []) {
    const hit = findNode(c, test);
    if (hit) return hit;
  }
  return undefined;
};

const allText = (n: DesignNode, out: string[] = []) => {
  if (n.tx) out.push(n.tx.v);
  n.ch?.forEach((c) => allText(c, out));
  return out;
};

function pathTo(root: DesignNode, id: string): DesignNode[] | null {
  if (root.id === id) return [root];
  for (const c of root.ch ?? []) {
    const p = pathTo(c, id);
    if (p) return [root, ...p];
  }
  return null;
}

// The layout is absolute, so a change in height moves what sits below it, level by level.
const bottomOf = (n: DesignNode) => Math.max(0, ...(n.ch ?? []).map((c) => c.y + c.h));

// Moves everything below fromY by delta, up through the parents. When content is removed,
// a parent never shrinks past its other content, so a short list doesn't cut off the panel beside it.
function shiftBelow(root: DesignNode, parentId: string, fromY: number, delta: number) {
  const path = pathTo(root, parentId);
  if (!path) return;
  const pads = path.map((p) => p.h - bottomOf(p));
  let y = fromY;
  let d = delta;
  for (let i = path.length - 1; i >= 0 && d !== 0; i--) {
    const p = path[i];
    const bottom = p.y + p.h;
    p.ch?.forEach((c) => {
      if (c.y >= y - 0.5) c.y += d;
    });
    if (p.sc) return;
    let h = p.h + d;
    if (d < 0 && i < path.length - 1) h = Math.max(h, bottomOf(p) + Math.max(pads[i], 0));
    d = h - p.h;
    p.h = h;
    y = bottom;
  }
}

function removeRows(root: DesignNode, parent: DesignNode, rows: DesignNode[]) {
  // Bottom first, so the higher rows are still in their original places.
  for (const row of [...rows].sort((a, b) => b.y - a.y)) {
    const below = parent.ch?.filter((c) => c !== row && c.y > row.y).sort((a, b) => a.y - b.y)[0];
    const step = below ? below.y - row.y : row.h;
    parent.ch = parent.ch?.filter((c) => c !== row);
    shiftBelow(root, parent.id, row.y + 0.6, -step);
  }
}

function insertAt(root: DesignNode, parent: DesignNode, y: number, node: DesignNode, gap: number) {
  shiftBelow(root, parent.id, y, node.h + gap);
  node.y = y;
  parent.ch = [...(parent.ch ?? []), node];
}

const liveRow = (id: string, x: number, w: number, h: number, props: Record<string, unknown>): DesignNode => ({
  id,
  t: "F",
  x,
  y: 0,
  w,
  h,
  live: "row",
  props,
});

const setText = (root: DesignNode, id: string, v: string) => {
  const n = findNode(root, (x) => x.id === id);
  if (n?.tx) n.tx = { ...n.tx, v };
};

const money = (n: number) => `₹${n.toLocaleString("en-IN")}`;

function applyHidden(root: DesignNode, live: Live) {
  const walk = (n: DesignNode) => {
    const gone = n.ch?.filter((c) => live.hidden[c.id]);
    if (gone?.length) removeRows(root, n, gone);
    n.ch?.forEach(walk);
  };
  walk(root);
}

function allergies(root: DesignNode, live: Live) {
  const list = findNode(root, (n) => n.id === "162:3373");
  if (!list || !live.allergies.length) return;
  const firstY = 0;
  [...live.allergies].reverse().forEach((a) => {
    insertAt(
      root,
      list,
      firstY,
      liveRow(`row-${a.id}`, 0, list.w, 118, {
        tone: "warn",
        title: `${a.substance}`,
        detail: `${a.type || "Allergy"} · ${a.severity || "Severity not set"} · ${a.reaction || "Reaction not recorded"}`,
        meta: `First noticed ${a.year || "unknown"} · Confirmed by ${a.by || "not recorded"} · Added today`,
        badge: "New",
      }),
      16,
    );
  });
  const count = (label: string, inc: number) => {
    const card = findNode(root, (n) => Boolean(n.ch?.some((c) => c.tx?.v === label)));
    const value = card?.ch?.find((c) => c.n === "Value");
    const detail = card?.ch?.find((c) => c.n === "Detail");
    if (!value?.tx || !inc) return;
    const was = Number(value.tx.v);
    value.tx = { ...value.tx, v: String((Number.isNaN(was) ? 0 : was) + inc), s: value.tx.s };
    const names = live.allergies.filter((a) => labelOfType(a.type) === label).map((a) => a.substance);
    if (detail?.tx && names.length) detail.tx = { ...detail.tx, v: [...(Number.isNaN(was) ? [] : [detail.tx.v]), ...names].join(", ").slice(0, 44) };
  };
  ["Drug allergies", "Environmental", "Food allergies"].forEach((label) => {
    count(label, live.allergies.filter((a) => labelOfType(a.type) === label).length);
  });
}

const labelOfType = (t: string) => (t === "Food" ? "Food allergies" : t === "Environmental" ? "Environmental" : "Drug allergies");

export const TIMELINE_TYPES: Record<string, string> = {
  "Doctor visits": "t:visit",
  "Scans and reports": "t:scan",
  "Lab tests": "t:lab",
  Medicines: "t:med",
  Emergency: "t:er",
  Physiotherapy: "t:physio",
  Allergies: "t:allergy",
};

// The timeline's "Show" list and organ chips work together: the page for the chosen type,
// narrowed to the chosen organ.
export function timelineScreen(type: string, organ: string) {
  const code = TIMELINE_TYPES[type];
  const named = code ? `Patient / Timeline · ${code}` : organ && organ !== "All" ? `Patient / Timeline · o:${organ}` : "Patient / Timeline";
  return manifest.screens.find((s) => s.name === named)?.id;
}

function timelineFilters(root: DesignNode, live: Live, name: string) {
  const organ = live.filters.tlOrgan ?? "";
  const show = findNode(root, (n) => n.n === "Title" && n.tx?.v === "Show");
  const showPanel = show && pathTo(root, show.id)?.at(-2);
  for (const row of showPanel?.ch?.filter((c) => /^State=/.test(c.n ?? "")) ?? []) {
    const label = textOf(row).replace(/\s*\d+\s*$/, "").trim();
    row.a = [{ on: "click", acts: [{ k: "fx", fx: "timeline", arg: `type|${label === "All events" ? "" : label}` }] }];
  }
  const organTitle = findNode(root, (n) => n.n === "Title" && n.tx?.v === "Organ");
  const organPanel = organTitle && pathTo(root, organTitle.id)?.at(-2);
  const chips: DesignNode[] = [];
  const walk = (n: DesignNode) => {
    if (/^State=/.test(n.n ?? "") && n.t === "I") chips.push(n);
    else n.ch?.forEach(walk);
  };
  organPanel?.ch?.forEach(walk);
  for (const chip of chips) chip.a = [{ on: "click", acts: [{ k: "fx", fx: "timeline", arg: `organ|${textOf(chip).trim()}` }] }];
  // A type page narrowed to one organ: show that organ's chip as chosen and keep only its events.
  if (!name.includes("· t:") || !organ || organ === "All") return;
  const on = chips.find((c) => c.n === "State=On");
  const off = chips.find((c) => c.n === "State=Off");
  if (on && off) {
    const look = (c: DesignNode) => JSON.parse(JSON.stringify({ p: c.p, k: c.k, text: findNode(c, (x) => Boolean(x.tx))?.p }));
    const [onLook, offLook] = [look(on), look(off)];
    for (const chip of chips) {
      const style = textOf(chip).trim() === organ ? onLook : offLook;
      chip.p = style.p;
      chip.k = style.k;
      const label = findNode(chip, (x) => Boolean(x.tx));
      if (label) label.p = style.text;
    }
  }
  const months = findNode(root, (n) => (n.ch?.filter((c) => c.ch?.some((m) => m.ch?.some((t) => t.n === "Month"))).length ?? 0) >= 1 && (n.ch?.length ?? 0) >= 2);
  if (!months) return;
  for (const group of [...(months.ch ?? [])]) {
    const events = group.ch?.filter((c) => findNode(c, (x) => x.n === "Where")) ?? [];
    const gone = events.filter((e) => {
      const where = findNode(e, (x) => x.n === "Where")?.tx?.v ?? "";
      return !where.split(" · ")[0].includes(organ) && !/All organs/.test(where);
    });
    if (gone.length === events.length && events.length) removeRows(root, months, [group]);
    else if (gone.length) removeRows(root, group, gone);
  }
}

function timeline(root: DesignNode, live: Live, name: string) {
  timelineFilters(root, live, name);
  const column = findNode(root, (n) => n.id === "181:3903");
  const allowed: Record<string, string> = { "t:visit": "Doctor visit", "t:scan": "Scan", "t:lab": "Lab test", "t:med": "Medicine", "t:er": "Emergency" };
  const tab = name.split(" · ")[1];
  const rows = live.events.filter((e) => !tab || allowed[tab] === e.type);
  const area = column?.ch?.[1];
  if (!area || !rows.length || tab?.startsWith("o:")) return;
  [...rows].reverse().forEach((e) => {
    insertAt(root, area, 0, liveRow(`row-${e.id}`, 0, area.w, 104, { tone: "plain", title: `${e.type || "Event"}: ${e.what}`, detail: e.where, meta: e.date, badge: "Added" }), 12);
  });
  const allCount = findNode(root, (n) => n.tx?.v === "15" && n.n === "Count");
  if (allCount?.tx) allCount.tx = { ...allCount.tx, v: String(15 + live.events.length) };
}

function documents(root: DesignNode, live: Live, name: string) {
  const header = findNode(root, (n) => Boolean(n.ch?.some((c) => c.n === "Added by" && c.t === "T")));
  if (!header || !live.docs.length) return;
  const path = pathTo(root, header.id);
  const list = path?.[path.length - 2];
  if (!list) return;
  const folder = name.split(" · ")[1];
  const rows = live.docs.filter((d) => !folder || d.folder === folder);
  const template = list.ch?.find((c) => c !== header && c.h >= 60 && c.h <= 70);
  [...rows].reverse().forEach((d) => {
    const row: DesignNode = template
      ? JSON.parse(JSON.stringify(template))
      : liveRow("x", 21, list.w - 42, 65, {});
    row.id = `doc-${d.id}`;
    row.a = [{ on: "click", acts: [{ k: "fx", fx: "openDoc", arg: d.id }] }];
    const cells = [d.folder, "You", d.date, "Dr. Arjun Mehta"];
    let c = 0;
    const walk = (n: DesignNode) => {
      n.id = `${row.id}:${n.id}`;
      if (n.n === "Name" && n.tx) n.tx = { ...n.tx, v: d.name };
      else if (n.n === "Cell" && n.tx) n.tx = { ...n.tx, v: cells[c++] ?? "" };
      else if (n.n === "View") n.a = [{ on: "click", acts: [{ k: "fx", fx: "openDoc", arg: d.id }] }];
      else if (n.n === "Download") n.a = [{ on: "click", acts: [{ k: "fx", fx: "openDoc", arg: d.id }] }];
      n.ch?.forEach(walk);
    };
    walk(row);
    insertAt(root, list, header.y + header.h, row, 0);
  });
  // Folder counts sit beside their labels in the panel on the left.
  if (!folder) {
    const allCount = findNode(root, (n) => n.tx?.v === "12" && n.n === "Count");
    if (allCount?.tx) allCount.tx = { ...allCount.tx, v: String(12 + live.docs.length) };
  }
}

function medicines(root: DesignNode, live: Live) {
  const list = findNode(root, (n) => n.id === "182:3958");
  if (!list || !live.meds.length) return;
  [...live.meds].reverse().forEach((m) => {
    insertAt(root, list, 53, liveRow(`row-${m.id}`, 21, list.w - 42, 100, {
      tone: "plain",
      title: `${m.name} · ${m.dose}`,
      detail: `${m.often} · ${m.when || "Any time"} · for ${m.length}`,
      meta: `${m.pharmacy ? `Sent to ${m.pharmacy}` : "Prescription issued"} · Dr. Arjun Mehta · 15 May 2025`,
      badge: "New",
    }), 10);
  });
}

function orders(root: DesignNode, live: Live, name: string) {
  if (!live.orders.length) return;
  if (name !== "Patient / Scans and reports" && name !== "Patient / Scans · Ordered" && name !== "Patient / Lab results") return;
  const blood = name === "Patient / Lab results";
  const rows = live.orders.filter((o) => (blood ? o.type === "Blood test" : o.type !== "Blood test"));
  if (!rows.length) return;
  const card = [...(root.ch ?? [])].sort((a, b) => b.h - a.h)[0];
  if (!card) return;
  const y = card.y;
  [...rows].reverse().forEach((o) => {
    insertAt(root, root, y, liveRow(`row-${o.id}`, 24, 1392, 92, {
      tone: "plain",
      title: `${o.type || "Test"}: ${o.test}`,
      detail: [o.lab, o.urgency || "Routine"].filter(Boolean).join(" · "),
      meta: `Do before ${o.before} · Ordered today by Dr. Arjun Mehta`,
      badge: "Ordered, result pending",
    }), 12);
  });
}

// "Ask my doctor" questions from the patient's tab show on the Messages card, which then opens them.
function patientQuestions(root: DesignNode, live: Live) {
  const questions = readQuestions(live.filters.questions);
  if (!questions.length) return;
  const detail = findNode(root, (n) => n.tx?.v === "2 from Thanal lab, 2 from patients");
  const card = detail && findNode(root, (n) => Boolean(n.ch?.includes(detail)));
  if (!detail?.tx || !card) return;
  const value = card.ch?.find((c) => c.n === "Value" && c.tx);
  if (value?.tx) value.tx = { ...value.tx, v: String(4 + questions.length) };
  detail.tx = { ...detail.tx, v: `2 from Thanal lab, ${2 + questions.length} from patients` };
  const unread = questions.filter((q) => !q.read).length;
  if (unread) {
    card.ch?.push({
      id: "questions-new", t: "F", x: card.w - 94, y: 15, w: 76, h: 24, r: 999, p: [{ k: "s", c: "rgb(199,255,235)" }],
      ch: [{ id: "questions-new:t", t: "T", x: 0, y: 3, w: 76, h: 18, p: [{ k: "s", c: "rgb(6,95,70)" }], tx: { v: `${unread} new`, f: "Manrope", s: 12, w: 700, lh: 18, a: "CENTER", va: "CENTER", r: "NONE" } }],
    });
  }
  card.a = [{ on: "click", acts: [{ k: "fx", fx: "questions" }] }];
  // The newest question still waiting for a reply also leads "Needs your attention".
  const waiting = questions.filter((q) => !q.reply);
  const model = findNode(root, (n) => n.n === "Attention / Substitute");
  const list = model && findNode(root, (n) => Boolean(n.ch?.includes(model)));
  if (!waiting.length || !model || !list) return;
  const next = list.ch?.filter((c) => /^Attention \//.test(c.n ?? "") && c.y > model.y).sort((a, b) => a.y - b.y)[0];
  const row: DesignNode = JSON.parse(JSON.stringify(model));
  const rename = (n: DesignNode) => {
    n.id = `question-row:${n.id}`;
    n.ch?.forEach(rename);
  };
  rename(row);
  row.n = "Attention / Patient question";
  row.a = [{ on: "click", acts: [{ k: "fx", fx: "questions" }] }];
  const about = waiting[0].about.length > 30 ? `${waiting[0].about.slice(0, 29).trim()}…` : waiting[0].about;
  const set = (name: string, v: string) => {
    const t = findNode(row, (n) => n.n === name && Boolean(n.tx));
    if (t?.tx) t.tx = { ...t.tx, v, r: "NONE" };
    return t;
  };
  const title = set("Title", waiting.length > 1 ? `${waiting.length} questions from James` : "James Heatfield asked");
  if (title) title.w = 205;
  const what = set("Detail", about || "A question from the patient app");
  if (what) what.w = 205;
  const pill = findNode(row, (n) => n.n === "Status pill");
  const label = pill && findNode(pill, (n) => Boolean(n.tx));
  if (pill && label?.tx) {
    pill.p = [{ k: "s", c: "rgb(199,255,235)" }];
    label.p = [{ k: "s", c: "rgb(6,95,70)" }];
    label.tx = { ...label.tx, v: "Reply", a: "CENTER", r: "NONE" };
    label.x = 0;
    label.w = pill.w;
  }
  insertAt(root, list, model.y, row, next ? next.y - model.y - model.h : 8);
}

function home(root: DesignNode, live: Live) {
  patientQuestions(root, live);
  const q = (live.filters.home ?? "").trim().toLowerCase();
  const isRow = (n: DesignNode) => n.w >= 900 && n.h >= 45 && n.h <= 100 && /^[TS]-\d\d$/.test(allText(n)[0] ?? "");
  const list = findNode(root, (n) => (n.ch?.filter(isRow).length ?? 0) >= 3);
  if (!list) return;
  const rows = list.ch?.filter(isRow) ?? [];
  const last = rows[rows.length - 1];
  const thanal = allText(last)[0]?.startsWith("T-");
  if (thanal && live.walkIns.length) {
    live.walkIns.forEach((w, i) => {
      const clone: DesignNode = JSON.parse(JSON.stringify(last));
      clone.id = `walkin-${w.id}`;
      const initials = w.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
      const parts = [w.token, w.time, initials, w.name, `${w.sex}, ${w.age} · ${w.pid}`, "Walk-in", w.reason, "Booked", "Token given · waiting"];
      let at = 0;
      const walk = (n: DesignNode) => {
        n.id = `${clone.id}:${n.id}`;
        if (n.tx && n.tx.v !== "Open") n.tx = { ...n.tx, v: parts[at++] ?? "" };
        n.ch?.forEach(walk);
      };
      walk(clone);
      const step = rows.length > 1 ? rows[1].y - rows[0].y : 92;
      insertAt(root, list, last.y + step * (i + 1), clone, step - clone.h);
    });
    const total = 9 + live.walkIns.length;
    setText(root, "232:6130", String(total));
    setText(root, "232:6131", `3 seen · 1 with you · ${total - 4} to come`);
  }
  // The patient with the doctor goes first, and those ahead of them move down. Tokens and times stay the same.
  const current = rows.find((r) => allText(r).includes("With you now"));
  if (current && current !== rows[0] && list.ch) {
    const top = rows[0].y;
    const gap = rows[1].y - rows[0].y - rows[0].h;
    rows.filter((r) => r.y < current.y).forEach((r) => (r.y += current.h + gap));
    current.y = top;
    list.ch.splice(list.ch.indexOf(current), 1);
    list.ch.splice(list.ch.indexOf(rows[0]), 0, current);
  }
  if (q) {
    const out = (list.ch?.filter(isRow) ?? []).filter((r) => !allText(r).join(" ").toLowerCase().includes(q));
    removeRows(root, list, out);
  }
}

// "All visits / Heart only" narrows the visit list on every body-map screen.
function visitFilter(root: DesignNode, live: Live) {
  const toggle = findNode(root, (n) => allText(n).join("") === "All visits" && n.t === "I");
  if (!toggle) return;
  const box = findNode(root, (n) => Boolean(n.ch?.some((c) => c.id === toggle.id)));
  const other = box?.ch?.find((c) => c.id !== toggle.id && /only$/.test(allText(c).join("")));
  if (!other) return;
  const organ = allText(other).join("").replace(" only", "");
  if (live.filters.visits !== organ) return;
  const panel = findNode(root, (n) => (n.ch?.some((c) => c.id === box?.id) ?? false));
  const walk = (n: DesignNode) => {
    const rows = n.ch?.filter((c) => c.w === 248 && c.h === 72) ?? [];
    const drop = rows.filter((r) => !allText(r).join(" ").includes(organ));
    if (drop.length) removeRows(root, n, drop);
    n.ch?.forEach(walk);
  };
  const scope = findNode(root, (n) => (n.ch?.some((c) => c.id === panel?.id) ?? false)) ?? root;
  walk(scope);
}

function notesFilter(root: DesignNode, live: Live) {
  // The column of note cards; the saved-note version of the page has its own ids.
  const list = findNode(root, (n) => (n.ch?.filter((c) => allText(c).some((t) => t.startsWith("Symptoms (what the patient says)"))).length ?? 0) >= 3);
  if (!list) return;
  const organ = live.filters.noteOrgan;
  const type = live.filters.noteType;
  const hide = (list.ch ?? []).filter((c) => {
    const t = allText(c).join(" | ");
    return (organ && !organ.startsWith("All notes") && !t.includes(organ) && !t.includes("All organs")) || (type && type !== "Any type" && !t.includes(type));
  });
  removeRows(root, list, hide);
}

function billing(root: DesignNode, live: Live, name: string) {
  const sahya = /Sahya/.test(name);
  const seg = findNode(root, (n) => n.w === 274 && n.h === 44);
  if (seg) {
    seg.live = "segment";
    seg.props = { value: live.billingRange };
    seg.ch = [];
  }
  const card = findNode(root, (n) => n.w === 972 && n.x === 0 && n.h >= 400);
  if (sahya) {
    if (live.billingRange !== "today") {
      if (card) {
        card.live = "billing";
        card.props = { range: live.billingRange, clinic: "sahya" };
      }
    }
    return;
  }
  if (card) {
    card.live = "billing";
    card.props = { range: live.billingRange, clinic: "thanal" };
    card.ch = [];
  }
  const paid = collectedExtra(live.collected);
  const paidCount = Object.keys(live.collected).length;
  const jamesPaid = Boolean(live.collected["T-04"]);
  const range = live.billingRange;
  const stat: Record<string, [string, string, string, string, string, string, string, string, string]> = {
    today: ["Collected today", money(1700 + paid), `${3 + paidCount} bills paid`, "Pending", money(jamesPaid ? 0 : 700), jamesPaid ? "Nothing waiting" : "James Heatfield · consult + ECG", "Expected today", "₹4,600", "All 9 patients"],
    week: ["Collected this week", money(19700 + paid), `${47 + paidCount} bills paid`, "Pending", money(Math.max(2900 - paid, 0)), "5 visits still to bill", "Expected this week", "₹24,800", "Mon 12 to Sat 17 May"],
    month: ["Collected this month", money(62400 + paid), `${150 + paidCount} bills paid`, "Pending", money(Math.max(2900 - paid, 0)), "5 visits still to bill", "Expected this month", "₹71,500", "May 2025"],
  };
  const s = stat[range];
  const cards = root.ch?.find((c) => c.w === 1392 && c.h === 109)?.ch ?? [];
  const flat = cards.flatMap((c) => c.ch ?? []).filter((c) => c.t === "T");
  flat.slice(0, 9).forEach((t, i) => {
    if (t.tx) t.tx = { ...t.tx, v: s[i] };
  });
  const month = flat[10];
  if (month?.tx) month.tx = { ...month.tx, v: money(62400 + paid) };
}

function calendarPanel(root: DesignNode, name: string) {
  // A centred panel at Thanal, a taller side panel at Sahya.
  const panel = root.ch?.find((c) => c.w === 820 && c.h >= 900);
  if (panel) {
    panel.live = "calendar";
    panel.props = { clinic: /Sahya/.test(name) ? "sahya" : "thanal", month: /June/.test(name) ? "2025-06" : undefined };
    panel.ch = [];
    // Clicking outside the calendar closes it, like its ✕.
    const home = /Sahya/.test(name) ? "Doctor home (landing) · Sahya Heart Care (after Sahya confirms)" : "Doctor home (landing)";
    const close: DesignNode["a"] = [{ on: "click", acts: [{ k: "fx", fx: "closeCalendar", arg: home }] }];
    const backdrop = root.ch?.find((c) => c.w === 1440 && c.h === 1000 && c !== panel);
    if (backdrop) backdrop.a = close;
    // The side panel has no backdrop in the design, so an invisible one sits behind it.
    else root.ch?.splice(root.ch.indexOf(panel), 0, { id: "calendar-outside", t: "F", x: 0, y: 0, w: root.w, h: root.h, a: close });
  }
}

function noteAttachments(root: DesignNode, live: Live) {
  if (!live.attachments.length) return;
  const button = findNode(root, (n) => n.id === "184:4671");
  const path = button && pathTo(root, button.id);
  const parent = path?.[path.length - 2];
  if (!button || !parent) return;
  parent.ch?.push({
    id: "note-attached",
    t: "T",
    x: button.x + button.w + 12,
    y: button.y + 8,
    w: 340,
    h: 20,
    p: [{ k: "s", c: "rgb(6,95,70)" }],
    tx: { v: `Also linked: ${live.attachments.join(", ")}`, s: 13, w: 600, r: "NONE" },
  });
}

function clinicalProfile(root: DesignNode, live: Live) {
  if (!live.photo) return;
  const walk = (n: DesignNode) => {
    if (n.ch?.length === 1 && n.ch[0].tx?.v === "AM" && n.r) {
      n.p = [{ k: "u", url: live.photo! }];
      n.ch = [];
    }
    n.ch?.forEach(walk);
  };
  walk(root);
}

function uploadModal(root: DesignNode, live: Live) {
  // The drop area is one big target, and it can also receive a dragged file.
  const drop = findNode(root, (n) => allText(n).join(" ").startsWith("Drop files here") && n.w > 400 && n.h > 80);
  if (drop) {
    drop.a = [{ on: "click", acts: [{ k: "fx", fx: "pickUpload" }] }];
    drop.drop = 1;
  }
  const row = findNode(root, (n) => n.tx?.v === "Holter_report_22May2025.pdf · 1.2 MB");
  if (row?.tx && live.filters.uploadName) row.tx = { ...row.tx, v: live.filters.uploadName };
}

function rxModal(root: DesignNode) {
  const safe = findNode(root, (n) => Boolean(n.ch?.some((c) => c.id === "188:4560")));
  if (safe) safe.a = [{ on: "click", acts: [{ k: "fx", fx: "useRx", arg: "Azithromycin 500 mg" }] }];
}

function homeCards(root: DesignNode, name: string) {
  const openScans = "183:3941";
  const go = (id: string, act: DesignNode["a"]) => {
    const n = findNode(root, (x) => x.id === id);
    if (n && !n.a) n.a = act;
  };
  if (!/^Doctor home \(landing\)$/.test(name)) return;
  go("232:6128", [{ on: "click", acts: [{ k: "fx", fx: "scrollTo", arg: "232:6145" }] }]);
  go("232:6132", [{ on: "click", acts: [{ k: "nav", to: openScans }] }]);
  go("232:6136", [{ on: "click", acts: [{ k: "nav", to: openScans }] }]);
  go("232:6140", [{ on: "click", acts: [{ k: "ov", to: "188:4820" }] }]);
  // Week tiles open the calendar on that day.
  const walk = (n: DesignNode) => {
    const day = n.ch?.find((c) => c.n === "D" && c.t === "T");
    if (day?.tx && /^\d{1,2}$/.test(day.tx.v)) {
      n.a = [{ on: "click", acts: [{ k: "fx", fx: "calendarDay", arg: `2025-05-${day.tx.v.padStart(2, "0")}` }] }];
      return;
    }
    n.ch?.forEach(walk);
  };
  walk(root);
}

// The organ a body map, scans or scan detail page is about.
export function scanOrganOf(name: string, chestFrom?: string) {
  if (/^Scan detail \/ Heart – Chest X-ray/.test(name)) return chestFrom === "Lungs" ? "Lungs" : "Heart";
  return /(?:Body map – |Scans · |Scan detail \/ )(Heart|Lungs|Brain|Liver|Stomach|Kidneys|Intestines|Joints)\b/.exec(name)?.[1];
}

const textOf = (n: DesignNode): string => (n.tx ? n.tx.v : (n.ch ?? []).map(textOf).join(" "));

// The availability box shows the hours of the clinic picked above it. Sahya Heart Care keeps
// its own hours (Tue and Thu, 5 to 8 PM, as on its clinic card), so its fields get their own ids.
const SAHYA_DAYS: Record<string, [string, string]> = { Tuesday: ["05:00 PM", "08:00 PM"], Thursday: ["05:00 PM", "08:00 PM"] };

function availability(root: DesignNode, live: Live) {
  if (live.filters["select:286:6688"] !== "Sahya Heart Care") return;
  const sunday = findNode(root, (n) => n.n === "Day / Sunday");
  const offToggle = sunday?.ch?.find((c) => c.n === "Toggle switch");
  const offText = sunday?.ch?.find((c) => c.t === "F" && textOf(c).trim() === "Not available");
  const rows: DesignNode[] = [];
  const walk = (n: DesignNode) => {
    if (/^Day \//.test(n.n ?? "") && n.n !== "Day / Sunday") rows.push(n);
    else n.ch?.forEach(walk);
  };
  walk(root);
  for (const row of rows) {
    const day = (row.n ?? "").slice(6);
    const own = (n: DesignNode) => {
      n.id = `sahya:${n.id}`;
      n.ch?.forEach(own);
    };
    const hours = SAHYA_DAYS[day];
    if (hours) {
      let i = 0;
      const set = (n: DesignNode) => {
        if (n.tx && /^\d{2}:\d{2} (AM|PM)$/.test(n.tx.v)) n.tx = { ...n.tx, v: hours[i++] ?? n.tx.v };
        n.ch?.forEach(set);
      };
      set(row);
      row.ch?.forEach(own);
      continue;
    }
    if (!offToggle || !offText || !sunday) continue;
    // A day Sahya is closed: drawn like Sunday, with the switch off and "Not available".
    const label = row.ch?.[0];
    const lift = (row.h - sunday.h) / 2;
    const copy = (n: DesignNode): DesignNode => ({ ...JSON.parse(JSON.stringify(n)), y: n.y + lift });
    row.ch = [...(label ? [label] : []), copy(offToggle), copy(offText)];
    row.ch.forEach(own);
  }
}

// A scan's page leads back to its own organ. The chest X-ray is shared by the heart and the lungs,
// so it shows the list and the way back for the organ the doctor came from.
function scanDetail(root: DesignNode, name: string, live: Live) {
  const organ = scanOrganOf(name, live.filters.scanOrgan);
  if (!organ) return;
  const screenId = (n: string) => manifest.screens.find((s) => s.name === n)?.id;
  const bodyMap = screenId(`Doctor view / Body map – ${organ}`);
  const scans = screenId(`Patient / Scans · ${organ}`);
  const nav = (to?: string): DesignNode["a"] => (to ? [{ on: "click", acts: [{ k: "nav", to }] }] : undefined);
  const label = findNode(root, (n) => n.t === "T" && /^Back to /.test(n.tx?.v ?? ""));
  const back = label && pathTo(root, label.id)?.at(-2);
  if (label?.tx && back) {
    label.tx = { ...label.tx, v: `Back to ${organ}` };
    back.a = nav(bodyMap);
  }
  const crumb = (i: number) => findNode(root, (n) => n.n === `Crumb ${i}` && Boolean(n.tx));
  const c0 = crumb(0);
  const c1 = crumb(1);
  const c2 = crumb(2);
  if (c0) c0.a = nav(bodyMap);
  if (c1?.tx) {
    c1.tx = { ...c1.tx, v: organ };
    c1.a = nav(bodyMap);
  }
  if (c2) c2.a = nav(scans);
  if (!/^Scan detail \/ Heart – Chest X-ray/.test(name)) return;
  // Keep only this organ's scans in the strip, in the order its body map lists them.
  const heading = findNode(root, (n) => n.n === "Tabs label" && Boolean(n.tx));
  const strip = heading && pathTo(root, heading.id)?.at(-2);
  if (!heading?.tx || !strip?.ch) return;
  heading.tx = { ...heading.tx, v: organ === "Lungs" ? "Lung scans and reports" : "Heart scans and reports" };
  const tabs = strip.ch.filter((c) => /^Selected=/.test(c.n ?? "")).sort((a, b) => a.x - b.x);
  const others = organ === "Lungs" ? /^(Resting ECG|Echocardiogram)/ : /^Spirometry/;
  const keep = tabs.filter((t) => !others.test(textOf(t).trim()));
  const gap = tabs.length > 1 ? tabs[1].x - (tabs[0].x + tabs[0].w) : 10;
  strip.ch = strip.ch.filter((c) => !tabs.includes(c) || keep.includes(c));
  let x = tabs[0]?.x ?? 0;
  for (const t of keep) {
    t.x = x;
    x += t.w + gap;
  }
}

// Booking the lipid profile on Lab tests: pick the lab and collection, pay, and the test shows as booked.
const LIPID_LABS: Record<string, { card: string; total: string; when: string; slot: string }> = {
  Thejus: { card: "402:9273", total: "₹525", when: "Thejus Clinical Lab · tomorrow 7 to 8 AM", slot: "Tomorrow 7 to 8 AM" },
  Nila: { card: "402:9278", total: "₹585", when: "Nila Diagnostics · tomorrow 9 to 10 AM", slot: "Tomorrow 9 to 10 AM" },
};

function lipidBooking(root: DesignNode, live: Live) {
  const byId = (id: string) => findNode(root, (n) => n.id === id);
  const choice = live.filters.labChoice === "Nila" ? "Nila" : "Thejus";
  const on = byId("402:9273")?.k;
  const off = byId("402:9278")?.k;
  for (const [lab, info] of Object.entries(LIPID_LABS)) {
    const card = byId(info.card);
    if (!card) continue;
    card.k = lab === choice ? on : off;
    card.a = [{ on: "click", acts: [{ k: "fx", fx: "pick", arg: `labChoice|${lab}|one|` }] }];
  }
  const where = [byId("402:9284"), byId("402:9286")].filter(Boolean) as DesignNode[];
  if (where.length === 2) chipStyles(where, "labWhere", live);
  const total = byId("402:9292");
  if (total?.tx) total.tx = { ...total.tx, v: LIPID_LABS[choice].total };
  const slot = findNode(root, (n) => n.n === "Collection slot");
  if (slot?.tx) slot.tx = { ...slot.tx, v: LIPID_LABS[choice].slot };
  const pay = byId("402:9293");
  const payLabel = byId("402:9294");
  const booked = live.filters.lipidBooked === "1";
  if (payLabel?.tx) payLabel.tx = { ...payLabel.tx, v: booked ? "Booked and paid" : `Pay ${LIPID_LABS[choice].total} and book`, a: "CENTER" };
  if (payLabel && pay) {
    payLabel.x = 0;
    payLabel.w = pay.w;
  }
  if (pay?.a) pay.a = booked ? undefined : [{ on: "click", acts: [{ k: "fx", fx: "pick", arg: "lipidBooked|1|one|" }, ...pay.a[0].acts] }];
  if (!booked) return;
  // The test in "Asked by your doctor" now reads as booked, like the Holter test above it.
  const pill = byId("402:9188");
  const bookedPill = byId("402:9177");
  if (pill && bookedPill) {
    pill.p = bookedPill.p;
    const label = findNode(pill, (n) => Boolean(n.tx));
    const bookedLabel = findNode(bookedPill, (n) => Boolean(n.tx));
    if (label?.tx) {
      label.tx = { ...label.tx, v: "Booked" };
      label.p = bookedLabel?.p;
    }
    const button = byId("402:9190");
    pill.w = 64;
    pill.x = button ? button.x + button.w - pill.w : pill.x;
  }
  const line = findNode(root, (n) => n.tx?.v === "Dr. Arjun Mehta · before your 29 May review");
  if (line?.tx) line.tx = { ...line.tx, v: `Dr. Arjun Mehta · ${LIPID_LABS[choice].when}` };
  const book = byId("402:9190");
  const row = book && pathTo(root, book.id)?.at(-2);
  if (row) row.ch = row.ch?.filter((c) => c !== book);
}

// Compare lab quotes: the chosen lab's card is outlined and its button reads "Continue with …", which goes on to
// the booking box on Lab tests. The other lab's "Choose …" only moves the choice.
const QUOTE_ON = { p: { k: "s", c: "rgb(20,184,166)" }, w: 3, a: "INSIDE" };
const QUOTE_OFF = { p: { k: "s", c: "rgb(226,232,240)" }, w: 1, a: "INSIDE" };

function labQuotes(root: DesignNode, live: Live) {
  const choice = live.filters.labChoice === "Nila" ? "Nila" : "Thejus";
  const cards: Record<string, string> = { Thejus: "Quote / Thejus Clinical Lab", Nila: "Quote / Nila Diagnostics" };
  for (const [lab, cardName] of Object.entries(cards)) {
    const card = findNode(root, (n) => n.n === cardName);
    const button = card && findNode(card, (n) => n.n === `Button / Choose ${lab}`);
    const label = button && findNode(button, (n) => Boolean(n.tx));
    if (!card || !button || !label?.tx) continue;
    const on = lab === choice;
    card.k = (on ? QUOTE_ON : QUOTE_OFF) as DesignNode["k"];
    button.p = [{ k: "s", c: on ? "rgb(3,28,84)" : "rgb(255,255,255)" }] as DesignNode["p"];
    button.k = (on ? undefined : { p: { k: "s", c: "rgb(203,213,225)" }, w: 1, a: "INSIDE" }) as DesignNode["k"];
    label.tx = { ...label.tx, v: on ? `Continue with ${lab}` : `Choose ${lab}`, a: "CENTER" };
    label.p = [{ k: "s", c: on ? "rgb(255,255,255)" : "rgb(3,28,84)" }] as DesignNode["p"];
    label.x = 0;
    label.w = button.w;
    const pick: Action = { k: "fx", fx: "pick", arg: `labChoice|${lab}|one|` };
    const onward = button.a?.[0]?.acts.filter((a) => a.k === "nav") ?? [];
    button.a = [{ on: "click", acts: on ? [pick, ...onward] : [pick, { k: "fx", fx: "say", arg: `${lab === "Nila" ? "Nila Diagnostics" : "Thejus Clinical Lab"} chosen. Press Continue to book.` }] }];
  }
}

// The status chips on "My reports and scans" narrow the cards, which then close up in the grid.
const REPORT_STATUS: Record<string, RegExp> = { "Explained today": /Explained today/, Ordered: /Ordered/, Explained: /Explained/ };

function reportStatus(root: DesignNode, live: Live) {
  const chips: DesignNode[] = [];
  const walk = (n: DesignNode) => {
    if (/^Status filter \//.test(n.n ?? "")) chips.push(n);
    else n.ch?.forEach(walk);
  };
  walk(root);
  if (chips.length < 2) return;
  const key = "reportStatus";
  chipStyles(chips, key, live);
  const test = key in live.filters ? REPORT_STATUS[live.filters[key]] : undefined;
  const grid = findNode(root, (n) => (n.ch?.filter((c) => /^Scan card \//.test(c.n ?? "")).length ?? 0) > 0);
  if (!test || !grid?.ch) return;
  const cards = grid.ch.filter((c) => /^Scan card \//.test(c.n ?? ""));
  const slots = cards.map((c) => ({ x: c.x, y: c.y })).sort((a, b) => a.y - b.y || a.x - b.x);
  const keep = cards.filter((c) => test.test(textOf(c))).sort((a, b) => a.y - b.y || a.x - b.x);
  const oldBottom = bottomOf(grid);
  grid.ch = grid.ch.filter((c) => !cards.includes(c) || keep.includes(c));
  keep.forEach((c, i) => {
    c.x = slots[i].x;
    c.y = slots[i].y;
  });
  if (!keep.length) {
    grid.ch.push({ id: "report-none", t: "T", x: 0, y: 8, w: grid.w, h: 22, p: [{ k: "s", c: "rgb(100,116,139)" }], tx: { v: "No reports or scans with this status.", s: 15, w: 500, r: "NONE" } });
  }
  const delta = bottomOf(grid) - oldBottom;
  const parent = pathTo(root, grid.id)?.at(-2);
  if (parent && delta < 0) {
    const gridBottom = grid.y + grid.h;
    grid.h += delta;
    shiftBelow(root, parent.id, gridBottom, delta);
  }
}

// Chips drawn as separate on/off toggles that should work as one choice: picking one turns the others off.
function oneOfSet(root: DesignNode, groupId: string) {
  const group = findNode(root, (n) => n.id === groupId);
  const chips = group?.ch?.filter((c) => c.t === "I" && c.a?.[0]?.acts[0]?.k === "var") ?? [];
  const onChip = chips.find((c) => c.n === "State=On");
  const offChip = chips.find((c) => c.n === "State=Off");
  if (!onChip || !offChip) return;
  // An "on" chip's click switches it to the off look, and an "off" chip's click to the on look.
  const offVariant = (onChip.a![0].acts[0] as { to: string }).to;
  const onVariant = (offChip.a![0].acts[0] as { to: string }).to;
  const ids = chips.map((c) => c.id).join(",");
  for (const chip of chips) chip.a = [{ on: "click", acts: [{ k: "fx", fx: "pickOne", arg: `${chip.id}|${ids}|${onVariant}|${offVariant}` }] }];
}

// The top search looks through everyone in the demo.
function searchModal(root: DesignNode, live: Live) {
  const q = (live.filters.search ?? "jam").trim().toLowerCase();
  const seen = new Set<string>();
  const people = [
    ...baseAppointments(TODAY, "thanal", live.walkIns),
    ...baseAppointments(TODAY, "sahya"),
    ...ALL_PATIENTS,
    { name: "James Varghese", who: "M, 61", pid: "ANX-60412" },
    { name: "Jameela K.", who: "F, 45", pid: "ANX-70833" },
  ].filter((p) => {
    if (seen.has(p.name)) return false;
    seen.add(p.name);
    return `${p.name} ${p.pid} ${p.who}`.toLowerCase().includes(q);
  });
  const list = findNode(root, (n) => Boolean(n.ch?.some((c) => c.h === 61 && c.w === 510)));
  if (!list) return;
  const rows = (list.ch ?? []).filter((c) => c.h === 61 && c.w === 510).sort((a, b) => a.y - b.y);
  const gap = rows.length > 1 ? rows[1].y - rows[0].y : 65;
  const extra = Math.max(people.length, 1) - rows.length;
  if (extra > 0) {
    // More matches than the design drew: repeat its row and grow the pop-up.
    const last = rows[rows.length - 1];
    for (let i = 0; i < extra; i++) {
      // The pop-up grows by three rows, then the list scrolls.
      if (i === 3) list.sc = "V";
      const copy: DesignNode = JSON.parse(JSON.stringify(last));
      copy.id = `search-${i}`;
      const rename = (n: DesignNode) => {
        n.id = `${copy.id}:${n.id}`;
        n.ch?.forEach(rename);
      };
      rename(copy);
      insertAt(root, list, last.y + gap * (i + 1), copy, gap - copy.h);
      rows.push(copy);
    }
  }
  rows.forEach((row, i) => {
    const p = people[i];
    const texts: DesignNode[] = [];
    const walk = (n: DesignNode) => {
      if (n.tx) texts.push(n);
      n.ch?.forEach(walk);
    };
    walk(row);
    if (!p) {
      row.ch = i === 0 ? [{ id: "search-none", t: "T", x: 16, y: 20, w: 460, h: 20, p: [{ k: "s", c: "rgb(100,116,139)" }], tx: { v: "No patients match that search.", s: 14, w: 500, r: "NONE" } }] : [];
      row.a = undefined;
      row.p = undefined;
      row.k = undefined;
      return;
    }
    const sex = p.who.startsWith("F") ? "Female" : p.who.startsWith("M") ? "Male" : "Other";
    const meta = `${sex}, ${p.who.split(", ")[1]} · ${p.pid}${p.name === "James Heatfield" ? " · open now" : ""}`;
    const initials = p.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
    const values = texts.length >= 3 ? [initials, p.name, meta] : [p.name, meta];
    texts.forEach((t, k) => {
      if (t.tx) t.tx = { ...t.tx, v: values[k] ?? "" };
    });
    row.a = [{ on: "click", acts: [{ k: "fx", fx: "openPatient", arg: p.name }] }];
  });
}

function notifications(root: DesignNode, name: string) {
  if (!/^Modal \/ notif/.test(name)) return;
  const target: Record<string, string> = {
    "New report": "Patient / Lab results · Kidneys",
    "Holter test": "Patient / Scans · Heart",
    Physiotherapy: "Scan detail / Joints – Physiotherapy plan",
    "Chest X-ray": "Scan detail / Heart – Chest X-ray",
  };
  (root.ch ?? []).forEach(function walk(n) {
    const t = allText(n)[0] ?? "";
    const dest = Object.keys(target).find((k) => t.startsWith(k));
    if (dest && n.a?.length && n.h > 50) {
      n.a = [{ on: "click", acts: [{ k: "fx", fx: "goto", arg: target[dest] }, { k: "close" }] }];
      return;
    }
    n.ch?.forEach(walk);
  });
}

// The Malayalam voice needs longer on each scene than the design's storyboard gives them.
const VIDEOS: Record<string, { file: string; lang: "en" | "ml"; other: string; times?: Record<string, string> }> = {
  "Modal / video preview · heart tracing (ECG)": { file: "heart-tracing-ecg", lang: "en", other: "368:7095" },
  "Modal / video preview · heart tracing (ECG) (Malayalam)": {
    file: "heart-tracing-ecg-ml",
    lang: "ml",
    other: "368:6512",
    times: { "0:00 to 0:08": "0:00 to 0:04", "0:08 to 0:22": "0:04 to 0:22", "0:22 to 0:30": "0:22 to 0:34" },
  },
};

function videoPlayer(root: DesignNode, name: string) {
  const bar = findNode(root, (n) => Boolean(n.ch?.some((c) => c.n === "Play")));
  if (!bar) return;
  const lines: string[] = [];
  const walk = (n: DesignNode) => {
    if (n.n === "Voice" && n.tx) lines.push(n.tx.v.replace(/^[^:]+:\s*/, ""));
    n.ch?.forEach(walk);
  };
  walk(root);
  const film = VIDEOS[name];
  if (film) {
    // This one has a real video, which takes over the design's whole picture area.
    const frame = pathTo(root, bar.id)?.at(-2);
    if (frame) {
      frame.ch = [{ id: "video-player", t: "F", x: 0, y: 0, w: frame.w, h: frame.h, live: "video", props: { src: `/video/${film.file}.mp4`, poster: `/video/${film.file}.jpg`, lang: film.lang, other: film.other } }];
      if (film.times) {
        const labels = film.times;
        const relabel = (n: DesignNode) => {
          if (n.n === "Time" && n.tx && labels[n.tx.v]) n.tx.v = labels[n.tx.v];
          n.ch?.forEach(relabel);
        };
        relabel(root);
      }
      return;
    }
  }
  bar.live = "player";
  bar.props = { lines };
  const audio = (EXPLAIN_AUDIO as Record<string, { file: string; starts: number[]; length: number }>)[name];
  if (audio) {
    // A narrated track in the patient's language. The storyboard's times follow the voice.
    // The same explainer in the other language is its own screen, so the switch moves to it.
    const ml = name.endsWith(" (Malayalam)");
    const otherName = ml ? name.slice(0, -" (Malayalam)".length) : `${name} (Malayalam)`;
    const other = manifest.screens.find((s) => s.name === otherName)?.id;
    bar.props = { lines, src: `/video/${audio.file}.mp3`, length: audio.length, lang: ml ? "ml" : "en", other };
    const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
    const ends = [...audio.starts.slice(1), audio.length];
    let scene = 0;
    const retime = (n: DesignNode) => {
      if (n.n === "Time" && n.tx && / to /.test(n.tx.v) && scene < ends.length) {
        n.tx.v = `${clock(scene ? Math.round(audio.starts[scene]) : 0)} to ${clock(Math.round(ends[scene]))}`;
        scene += 1;
      }
      n.ch?.forEach(retime);
    };
    retime(root);
  }
  bar.ch = [];
}

function ecgMeasure(root: DesignNode) {
  const trace = findNode(root, (n) => n.g !== undefined && n.w > 600 && n.h > 300) ?? findNode(root, (n) => n.w === 930 && n.h > 300 && n.h < 600);
  if (!trace) return;
  const path = pathTo(root, trace.id);
  const parent = path?.[path.length - 2];
  parent?.ch?.push({ id: "ecg-measure", t: "F", x: trace.x, y: trace.y, w: trace.w, h: trace.h, live: "measure" });
}

// Chips the design drew as plain frames: days can be many, the role is one.
const DAYS = new Set(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
const ROLES = new Set(["Owner", "Visiting consultant", "Staff doctor"]);
const NAVY = "rgb(3,28,84)";

function paintChip(n: DesignNode, on: boolean) {
  const label = n.ch?.find((c) => c.t === "T");
  n.p = [{ k: "s", c: on ? NAVY : "rgb(255,255,255)" }];
  n.k = { p: { k: "s", c: on ? NAVY : "rgb(226,232,240)" }, w: 1, a: "INSIDE" };
  if (label) label.p = [{ k: "s", c: on ? "rgb(255,255,255)" : "rgb(15,23,42)" }];
}

function clinicForm(root: DesignNode, live: Live) {
  const walk = (n: DesignNode, parent?: DesignNode) => {
    const t = n.ch?.length === 1 ? n.ch[0].tx?.v : undefined;
    if (t && n.h <= 48 && (DAYS.has(t) || ROLES.has(t))) {
      const was = n.p?.[0]?.k === "s" && n.p[0].c === NAVY;
      if (DAYS.has(t)) {
        const on = live.checks[n.id] ?? was;
        n.a = [{ on: "click", acts: [{ k: "fx", fx: "chip", arg: `${n.id}|${was ? 1 : 0}` }] }];
        paintChip(n, on);
      } else {
        const key = `role:${parent?.id}`;
        const chosen = live.filters[key];
        n.a = [{ on: "click", acts: [{ k: "fx", fx: "chipOne", arg: `${key}|${t}` }] }];
        paintChip(n, chosen ? chosen === t : was);
      }
    }
    n.ch?.forEach((c) => walk(c, n));
  };
  walk(root);
  // Saving the form adds the clinic to "My clinics".
  const save = findNode(root, (n) => allText(n).join("") === "Add clinic" && Boolean(n.a));
  if (save) save.a = [{ on: "click", acts: [{ k: "fx", fx: "saveClinic", arg: root.id }] }];
}

function addedClinics(root: DesignNode, live: Live) {
  const added = (live.filters.clinics ?? "").split("\n").filter(Boolean);
  // The review step lists clinics as lines, so each added clinic gets a line of its own.
  const lastLine = findNode(root, (n) => n.id === "248:6558");
  const box = lastLine && pathTo(root, lastLine.id)?.at(-2);
  if (lastLine?.tx && box && added.length) {
    added.forEach((line, i) => {
      const [name, detail] = line.split("|");
      const copy: DesignNode = { ...lastLine, id: `review-clinic-${i}`, tx: { ...lastLine.tx!, v: `${name} · ${detail} · waiting for verification` } };
      insertAt(root, box, lastLine.y + 24 * (i + 1), copy, 6);
    });
    const count = findNode(root, (n) => n.tx?.v === "2 locations");
    if (count?.tx) count.tx = { ...count.tx, v: `${2 + added.length} locations` };
  }
  const anchor = findNode(root, (n) => /^\+\s+Add (new clinic|a clinic without HFR ID)$/.test(allText(n).join("")) && n.w > 500);
  if (!anchor || !added.length) return;
  const path = pathTo(root, anchor.id);
  const parent = path?.[path.length - 2];
  if (!parent) return;
  added.forEach((line, i) => {
    const [name, detail] = line.split("|");
    insertAt(root, parent, anchor.y, liveRow(`clinic-${i}`, anchor.x, anchor.w, 84, { tone: "plain", title: name, detail, meta: "Waiting for verification", badge: "New" }), 12);
  });
}

function insurers(root: DesignNode, live: Live) {
  const added = (live.filters.insurers ?? "").split("\n").filter(Boolean);
  const anchor = findNode(root, (n) => allText(n).join("").includes("Add insurer or TPA") && n.h < 70);
  if (!anchor || !added.length) return;
  const path = pathTo(root, anchor.id);
  const parent = path?.[path.length - 2];
  if (!parent) return;
  added.forEach((name, i) => {
    insertAt(root, parent, anchor.y, liveRow(`insurer-${i}`, anchor.x, anchor.w, 66, { tone: "plain", title: name, detail: "Tie-up added today" }), 8);
  });
}

// On/off switches in the portals' settings (the patient app wires its own in patient.ts).
function switches(root: DesignNode, live: Live) {
  const TEAL = "rgb(20,184,166)";
  const walk = (n: DesignNode) => {
    if (n.n === "Switch" && !n.a && n.ch?.length === 1) {
      const initial = n.p?.[0]?.k === "s" && n.p[0].c === TEAL;
      const on = live.checks[n.id] ?? initial;
      n.a = [{ on: "click", acts: [{ k: "fx", fx: "check", arg: `${n.id}|${initial ? 1 : 0}` }] }];
      n.role = "checkbox";
      n.pressed = on;
      n.p = [{ k: "s", c: on ? TEAL : "rgb(203,213,225)" }];
      const knob = n.ch[0];
      knob.x = on ? n.w - knob.w - 3 : 3;
    }
    n.ch?.forEach(walk);
  };
  walk(root);
}

// A small box beside a label is a checkbox, and the design left all of these unwired.
function checkboxes(root: DesignNode, live: Live) {
  const walk = (n: DesignNode) => {
    const kids = n.ch ?? [];
    const label = kids.find((c) => c.t === "T" && c.n === "Label");
    const box = kids.find((c) => c.t !== "T" && c.w <= 22 && c.h <= 22 && c.w >= 14);
    // A filled colour swatch with no tick is a legend key (Stable, Monitor, Needs attention), not a checkbox.
    const swatch = box && !box.g && !box.ch?.length && !box.k && Boolean(box.p?.length) && !/^rgb\(255, ?255, ?255\)$/.test((box.p?.[0] as { c?: string })?.c ?? "");
    if (label && box && !swatch && kids.length === 2 && n.h <= 30 && !n.a) {
      const hasTick = Boolean(box.g || box.ch?.length);
      const on = live.checks[n.id] ?? hasTick;
      n.a = [{ on: "click", acts: [{ k: "fx", fx: "check", arg: `${n.id}|${hasTick ? 1 : 0}` }] }];
      n.role = "checkbox";
      n.pressed = on;
      if (!on) {
        box.ch = [];
        box.g = undefined;
        box.p = [{ k: "s", c: "rgb(255,255,255)" }];
        box.k = { p: { k: "s", c: "rgb(148,163,184)" }, w: 1, a: "INSIDE" };
        box.r = box.r ?? 4;
      } else if (!hasTick) {
        box.p = [{ k: "s", c: NAVY }];
        box.r = box.r ?? 4;
        box.ch = [{ id: `${box.id}:tick`, t: "T", x: 0, y: 0, w: box.w, h: box.h, p: [{ k: "s", c: "rgb(255,255,255)" }], tx: { v: "✓", s: 13, w: 700, a: "CENTER", va: "CENTER", r: "NONE" } }];
      }
    }
    kids.forEach(walk);
  };
  walk(root);
}

function bodyMap(root: DesignNode) {
  const hasIcon = (n: DesignNode, icon: string) => n.w === 44 && !!n.ch?.some((c) => c.n === icon);
  const map = findNode(root, (n) => !!n.ch?.some((c) => hasIcon(c, "Icon/heart")));
  if (!map) return;
  map.ch?.forEach((c) => {
    if (!hasIcon(c, "Icon/heart") && !c.ch?.some((i) => i.n?.startsWith("Icon/"))) return;
    // The design's stomach pin covers the heart pin, so the heart moves up level with the lungs.
    if (hasIcon(c, "Icon/heart")) c.y = 136;
    // The open organ's pin pulses softly, and the others lift on hover. See globals.css.
    c.anim = c.n === "Selected=Yes" ? "pin-on" : "pin";
  });
}

// Rebuilds a screen from its design plus what the doctor has done, so lists and numbers stay true.

// Filter chips the design drew without links: each one now narrows the list beside it.
type ListFilter = { rows: (n: DesignNode) => boolean; keep: Record<string, (text: string) => boolean> };
const LIST_FILTERS: Record<string, ListFilter> = {
  "Lab web / Requests": {
    rows: (n) => /^Request \//.test(n.n ?? ""),
    keep: { "Doctor-requested": (t) => /\bDr\. /.test(t), "Patient-selected": (t) => /Patient-selected/.test(t), Urgent: (t) => /Urgent/.test(t) },
  },
  "Platform web / Verification": {
    rows: (n) => /^Case \//.test(n.n ?? ""),
    keep: { Doctors: (t) => / Doctor /.test(t), Clinics: (t) => / Clinic /.test(t), Pharmacies: (t) => / Pharmacy /.test(t), Labs: (t) => / Laboratory /.test(t) },
  },
  "Support web / Tickets": {
    rows: (n) => /^Ticket \//.test(n.n ?? ""),
    keep: { Mine: (t) => / You$/.test(t), "Clinical safety": (t) => /Clinical safety/.test(t), Privacy: (t) => /Privacy/.test(t) },
  },
  "Insurer web / Claims": {
    rows: (n) => /^Claim \//.test(n.n ?? ""),
    keep: { Submitted: (t) => /SUBMITTED/.test(t), "Under review": (t) => /UNDER REVIEW/.test(t), Clarification: (t) => /CLARIFICATION/.test(t), Flagged: (t) => /Flagged/.test(t) },
  },
  "Dealer web / Catalogue": {
    rows: (n) => /^Product \//.test(n.n ?? ""),
    keep: { Medicines: (t) => /Medicine ·/.test(t), Consumables: (t) => /Consumable ·/.test(t), Equipment: (t) => /Equipment ·/.test(t) },
  },
  "Reception web / Live queue": {
    rows: (n) => /^Queue row \//.test(n.n ?? ""),
    keep: { "AroNexa app": (t) => /AroNexa app/.test(t), "Phone & WhatsApp": (t) => /\b(Phone|WhatsApp)\b/.test(t), "Walk-in": (t) => /walk-in/i.test(t) },
  },
  "Dealer web / RFQs": {
    rows: (n) => /^RFQ \//.test(n.n ?? ""),
    keep: { New: (t) => / New$/.test(t), Quoted: (t) => / Quoted$/.test(t), Selected: (t) => / Selected$/.test(t) },
  },
  "Seller web / Orders": {
    rows: (n) => /^Order \//.test(n.n ?? ""),
    keep: { New: (t) => / New /.test(t), "To pack": (t) => / Confirmed /.test(t), Dispatched: (t) => / Dispatched /.test(t), Returns: (t) => /Return/.test(t) },
  },
  "Pathologist web / To review": {
    rows: (n) => /^Report \//.test(n.n ?? ""),
    keep: { Urgent: (t) => / Urgent /.test(t) },
  },
  "Patient web / Bills & payments": {
    rows: (n) => n.t === "F" && /^\d\d [A-Z][a-z]{2} /.test(allText(n).join(" ")) && n.h < 90,
    keep: {
      "Clinic visits": (t) => !/Refund/.test(t) && /(Clinic|Centre) ·|booking fee/.test(t),
      Medicines: (t) => /Medicals|medicines/.test(t) && !/Refund/.test(t),
      "Lab tests": (t) => /Lab|Diagnostics/.test(t) && !/Refund/.test(t),
      Refunds: (t) => /Refund/.test(t),
    },
  },
};

const chipLabel = (n: DesignNode) => allText(n).join(" ").trim();
const withoutCount = (label: string) => label.replace(/\s+\d+$/, "");

// Chips the design drew as a single choice (a reason, a payment method, a period) but left unlinked.
function choiceChips(root: DesignNode, live: Live) {
  const isChip = (c: DesignNode) => /^(Chip|Sort) \//.test(c.n ?? "") && !c.a;
  const walk = (n: DesignNode) => {
    const chips = n.ch?.filter(isChip) ?? [];
    if (chips.length >= 2) chipStyles(chips, `pick:${n.id}`, live);
    n.ch?.forEach(walk);
  };
  walk(root);
}

// Gives each chip the look of the design's chosen or unchosen chip, and a click that chooses it.
// Returns the chosen label, or nothing when the design shows no chosen chip to copy.
function chipStyles(chips: DesignNode[], key: string, live: Live) {
  const lookOf = (c: DesignNode) => JSON.stringify([c.p ?? null, c.k ?? null]);
  const counts = new Map<string, number>();
  chips.forEach((c) => counts.set(lookOf(c), (counts.get(lookOf(c)) ?? 0) + 1));
  const designedOn = chips.find((c) => counts.get(lookOf(c)) === 1 && chips.length > 2) ?? (counts.size === 2 && chips.length === 2 ? chips[0] : undefined);
  if (!designedOn) return undefined;
  const designedOff = chips.find((c) => lookOf(c) !== lookOf(designedOn));
  if (!designedOff) return undefined;
  const look = (c: DesignNode) => JSON.parse(JSON.stringify({ p: c.p, k: c.k, text: findNode(c, (x) => Boolean(x.tx))?.p }));
  const on = look(designedOn);
  const off = look(designedOff);
  const picked = live.filters[key] ?? chipLabel(designedOn);
  for (const chip of chips) {
    const label = chipLabel(chip);
    const yes = label === picked;
    const style = yes ? on : off;
    chip.p = style.p;
    chip.k = style.k;
    const paintText = (n: DesignNode) => {
      if (n.tx && style.text) n.p = style.text;
      n.ch?.forEach(paintText);
    };
    paintText(chip);
    chip.a = [{ on: "click", acts: [{ k: "fx", fx: "pick", arg: `${key}|${label}|one|` }] }];
    chip.role = "button";
    chip.pressed = yes;
  }
  return picked;
}

function listFilters(root: DesignNode, name: string, live: Live) {
  const config = LIST_FILTERS[name];
  if (!config) return;
  const group = findNode(root, (n) => (n.ch?.filter((c) => /^(Chip|Filter) \//.test(c.n ?? "") && !c.a).length ?? 0) >= 2 && /^(All|New)\b/.test(chipLabel(n.ch!.find((c) => /^(Chip|Filter) \//.test(c.n ?? ""))!)));
  if (!group) return;
  const chips = group.ch!.filter((c) => /^(Chip|Filter) \//.test(c.n ?? ""));
  const key = `pick:${group.id}`;
  const picked = chipStyles(chips, key, live);
  if (!picked) return;
  // Until a chip is pressed the list stays as the design drew it.
  const keep = key in live.filters ? config.keep[withoutCount(picked)] : undefined;
  if (!keep) return;
  const rows: DesignNode[] = [];
  const collect = (n: DesignNode) => {
    if (n !== group && config.rows(n)) rows.push(n);
    else n.ch?.forEach(collect);
  };
  collect(root);
  const byParent = new Map<DesignNode, DesignNode[]>();
  for (const row of rows) {
    if (keep(allText(row).join(" "))) continue;
    const parent = (pathTo(root, row.id) ?? []).at(-2);
    if (parent) byParent.set(parent, [...(byParent.get(parent) ?? []), row]);
  }
  byParent.forEach((gone, parent) => removeRows(root, parent, gone));
}

export function liveDoc(doc: DesignNode, name: string, live: Live) {
  const root: DesignNode = JSON.parse(JSON.stringify(doc));
  bodyMap(root);
  if (/Calendar open/.test(name)) calendarPanel(root, name);
  if (name === "Patient / Allergies") allergies(root, live);
  if (name.startsWith("Patient / Timeline")) timeline(root, live, name);
  if (name.startsWith("Patient / Documents")) documents(root, live, name);
  if (name === "Patient / Medications") medicines(root, live);
  orders(root, live, name);
  if (name.startsWith("Doctor home")) home(root, live);
  homeCards(root, name);
  notifications(root, name);
  if (name.startsWith("Doctor view /") || name.startsWith("Patient / Overview")) visitFilter(root, live);
  if (name.startsWith("Patient / Clinical notes")) {
    notesFilter(root, live);
    // Each note template opens the form filled in for that kind of note.
    for (const title of ["Follow-up visit", "New problem", "Result explained", "Referral"]) {
      const label = findNode(root, (n) => n.n === "Title" && n.tx?.v === title);
      const row = label && pathTo(root, label.id)?.find((p) => p.a?.[0]?.acts.some((a) => a.k === "nav"));
      if (row?.a) row.a = [{ on: "click", acts: [{ k: "fx", fx: "noteTemplate", arg: title }, ...row.a[0].acts] }];
    }
  }
  if (name.startsWith("Doctor billing")) billing(root, live, name);
  if (name === "Modal / upload") uploadModal(root, live);
  if (name === "Modal / rx") rxModal(root);
  if (/^Modal \/ video preview/.test(name)) videoPlayer(root, name);
  if (/^Scan detail \/ Heart – Resting ECG/.test(name)) ecgMeasure(root);
  if (/^Modal \/ add clinic/.test(name)) clinicForm(root, live);
  if (/^Doctor settings \/ Clinics/.test(name) || /^Register \/ (3 Clinic locations|4 Review)/.test(name)) addedClinics(root, live);
  if (/^Modal \/ billing settings \(insurance/.test(name)) insurers(root, live);
  if (name === "Modal / search") searchModal(root, live);
  if (name.startsWith("Scan detail /")) scanDetail(root, name, live);
  if (name === "Doctor settings / Clinics and availability") availability(root, live);
  if (name.startsWith("Explain to patient /")) {
    // The doctor can reword the summary before it is sent.
    const message = findNode(root, (n) => n.n === "Message" && Boolean(n.tx));
    const box = message && pathTo(root, message.id)?.at(-2);
    if (message?.tx && box && !box.a) {
      box.n = "Input";
      message.n = "Value";
      message.tx = { ...message.tx, r: "HEIGHT" };
    }
  }
  if (name === "Doctor view / Add clinical note") {
    noteAttachments(root, live);
    oneOfSet(root, "184:4605");
    oneOfSet(root, "184:4627");
  }
  if (isPatientScreen(name)) patientDoc(root, name, live);
  if (name.startsWith("Patient web / Reports & scans")) reportStatus(root, live);
  if (name === "Patient web / Lab tests") lipidBooking(root, live);
  if (name.startsWith("Patient web / Compare lab quotes")) labQuotes(root, live);
  if (name === "PModal / Running late") {
    // The patient picks how late they will be.
    const row = findNode(root, (n) => n.n === "Row" && (n.ch?.length ?? 0) === 4);
    if (row?.ch) chipStyles(row.ch, "lateBy", live);
  }
  if (/^PToast/.test(name) && live.filters.lateBy) {
    const kept = findNode(root, (n) => n.tx?.v === "Your place is kept.");
    if (kept?.tx) kept.tx = { ...kept.tx, v: `Told the clinic you are ${live.filters.lateBy} late. Your place is kept.` };
  }
  checkboxes(root, live);
  if (!isPatientScreen(name)) switches(root, live);
  listFilters(root, name, live);
  choiceChips(root, live);
  clinicalProfile(root, live);
  applyHidden(root, live);
  return root;
}

// Only the state a screen actually draws from, so typing elsewhere doesn't rebuild it.
export function liveKey(live: Live) {
  const { hidden, allergies: a, events, docs, meds, orders: o, walkIns, photo, billingRange, collected, checks, attachments, filters, leaves, blocks } = live;
  // Filters that only change one control's own display don't need the screen rebuilt.
  const shown = Object.fromEntries(Object.entries(filters).filter(([k]) => !["lastField", "reveal", "measure"].includes(k)));
  return JSON.stringify([hidden, a, events, docs.map((d) => d.id), meds, o, walkIns, photo, billingRange, collected, checks, attachments, shown, leaves, blocks]);
}
