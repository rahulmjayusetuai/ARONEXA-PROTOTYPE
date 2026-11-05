import type { DesignNode } from "../types";
import { isPatientScreen, patientDoc } from "./patient";
import { baseAppointments, collectedExtra, TODAY } from "./schedule";
import { useLive } from "./state";

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
function shiftBelow(root: DesignNode, parentId: string, fromY: number, delta: number) {
  const path = pathTo(root, parentId);
  if (!path) return;
  let y = fromY;
  for (let i = path.length - 1; i >= 0; i--) {
    const p = path[i];
    const bottom = p.y + p.h;
    p.ch?.forEach((c) => {
      if (c.y >= y - 0.5) c.y += delta;
    });
    if (p.sc) return;
    p.h += delta;
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

function timeline(root: DesignNode, live: Live, name: string) {
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
      meta: `Sent to ${m.pharmacy} · Dr. Arjun Mehta · 15 May 2025`,
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
      detail: `${o.lab} · ${o.urgency || "Routine"}`,
      meta: `Do before ${o.before} · Ordered today by Dr. Arjun Mehta`,
      badge: "Ordered, result pending",
    }), 12);
  });
}

function home(root: DesignNode, live: Live) {
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
  const list = findNode(root, (n) => n.id === "184:4057");
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

// The top search looks through everyone in the demo.
function searchModal(root: DesignNode, live: Live) {
  const q = (live.filters.search ?? "jam").trim().toLowerCase();
  const seen = new Set<string>();
  const people = [
    ...baseAppointments(TODAY, "thanal", live.walkIns),
    ...baseAppointments(TODAY, "sahya"),
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
    for (let i = 0; i < Math.min(extra, 5); i++) {
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

// The Malayalam voice needs longer on the second and third scenes than the design's storyboard gives them.
const VIDEOS: Record<string, { file: string; lang: "en" | "ml"; other: string; times?: Record<string, string> }> = {
  "Modal / video preview · heart tracing (ECG)": { file: "heart-tracing-ecg", lang: "en", other: "368:7095" },
  "Modal / video preview · heart tracing (ECG) (Malayalam)": {
    file: "heart-tracing-ecg-ml",
    lang: "ml",
    other: "368:6512",
    times: { "0:00 to 0:08": "0:00 to 0:04", "0:08 to 0:22": "0:04 to 0:19", "0:22 to 0:30": "0:19 to 0:30" },
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
  const anchor = findNode(root, (n) => allText(n).join("") === "+ Add new clinic" && n.w > 500);
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

// A small box beside a label is a checkbox, and the design left all of these unwired.
function checkboxes(root: DesignNode, live: Live) {
  const walk = (n: DesignNode) => {
    const kids = n.ch ?? [];
    const label = kids.find((c) => c.t === "T" && c.n === "Label");
    const box = kids.find((c) => c.t !== "T" && c.w <= 22 && c.h <= 22 && c.w >= 14);
    if (label && box && kids.length === 2 && n.h <= 30 && !n.a) {
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
  if (name.startsWith("Patient / Clinical notes")) notesFilter(root, live);
  if (name.startsWith("Doctor billing")) billing(root, live, name);
  if (name === "Modal / upload") uploadModal(root, live);
  if (name === "Modal / rx") rxModal(root);
  if (/^Modal \/ video preview/.test(name)) videoPlayer(root, name);
  if (/^Scan detail \/ Heart – Resting ECG/.test(name)) ecgMeasure(root);
  if (/^Modal \/ add clinic/.test(name)) clinicForm(root, live);
  if (/^Doctor settings \/ Clinics/.test(name)) addedClinics(root, live);
  if (/^Modal \/ billing settings \(insurance/.test(name)) insurers(root, live);
  if (name === "Modal / search") searchModal(root, live);
  if (name === "Doctor view / Add clinical note") noteAttachments(root, live);
  if (isPatientScreen(name)) patientDoc(root, name, live);
  checkboxes(root, live);
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
