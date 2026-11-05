import type { Action, DesignNode, Paint } from "../types";
import { blocksFor, leaveFor, leaveWindow, minutes } from "./schedule";
import { useLive } from "./state";

type Live = ReturnType<typeof useLive.getState>;

// Controls the patient screens draw but the design left unwired, plus the changes a patient's actions make.
export const isPatientScreen = (name: string) => /^(Patient web|PModal|PToast|Patient sign up|Login · Patient)/.test(name);

const NAVY = "rgb(3,28,84)";
const TEAL = "rgb(20,184,166)";
const LINE = "rgb(226,232,240)";
const solid = (c: string): Paint[] => [{ k: "s", c }];
const stroke = (c: string): DesignNode["k"] => ({ p: { k: "s", c }, w: 1, a: "INSIDE" });
const click = (fx: string, arg?: string): DesignNode["a"] => [{ on: "click", acts: [{ k: "fx", fx, arg } as Action] }];
const fillOf = (n: DesignNode) => (n.p?.[0]?.k === "s" ? n.p[0].c : "");

const find = (n: DesignNode, test: (x: DesignNode) => boolean): DesignNode | undefined => {
  if (test(n)) return n;
  for (const c of n.ch ?? []) {
    const hit = find(c, test);
    if (hit) return hit;
  }
  return undefined;
};
const texts = (n: DesignNode, out: DesignNode[] = []) => {
  if (n.tx) out.push(n);
  n.ch?.forEach((c) => texts(c, out));
  return out;
};
const words = (n: DesignNode) => texts(n).map((t) => t.tx!.v).join(" ");
const label = (n: DesignNode) => n.n?.split(" / ")[1]?.trim() ?? words(n);
const setWords = (n: DesignNode, v: string) => {
  if (n.tx) n.tx = { ...n.tx, v };
};
const paintText = (n: DesignNode, c: string) => texts(n).forEach((t) => (t.p = solid(c)));
const list = (v?: string) => (v ? v.split("\n").filter(Boolean) : []);

function pathTo(root: DesignNode, id: string): DesignNode[] | null {
  if (root.id === id) return [root];
  for (const c of root.ch ?? []) {
    const p = pathTo(c, id);
    if (p) return [root, ...p];
  }
  return null;
}

// Everything below a removed or added row moves with it, up through its parents.
function reflow(root: DesignNode, parent: DesignNode, from: number, delta: number) {
  parent.ch?.forEach((c) => {
    if (c.y >= from) c.y += delta;
  });
  const path = pathTo(root, parent.id) ?? [];
  parent.h += delta;
  for (let i = path.length - 2; i >= 0; i--) {
    const child = path[i + 1];
    path[i].ch?.forEach((c) => {
      if (c !== child && c.y >= child.y + child.h - delta) c.y += delta;
    });
    path[i].h += delta;
  }
}

function removeRows(root: DesignNode, parent: DesignNode, rows: DesignNode[]) {
  for (const row of [...rows].sort((a, b) => b.y - a.y)) {
    const below = parent.ch?.filter((c) => c !== row && c.y > row.y).sort((a, b) => a.y - b.y)[0];
    const step = below ? below.y - row.y : row.h;
    parent.ch = parent.ch?.filter((c) => c !== row);
    reflow(root, parent, row.y + 0.5, -step);
  }
}

function controls(root: DesignNode, live: Live) {
  const walk = (n: DesignNode, field: string) => {
    const name = n.n ?? "";
    if (name.startsWith("Field /")) field = name;
    if (name === "Switch" && !n.a) {
      const initial = fillOf(n) === TEAL;
      const on = live.checks[n.id] ?? initial;
      n.a = click("check", `${n.id}|${initial ? 1 : 0}`);
      n.role = "checkbox";
      n.pressed = on;
      n.p = solid(on ? TEAL : "rgb(203,213,225)");
      const knob = n.ch?.[0];
      if (knob) knob.x = on ? n.w - knob.w - 3 : 3;
    }
    if (name === "Checkbox" && !n.a) {
      const initial = Boolean(n.ch?.length);
      const on = live.checks[n.id] ?? initial;
      n.a = click("check", `${n.id}|${initial ? 1 : 0}`);
      n.role = "checkbox";
      n.pressed = on;
      if (!on) {
        n.ch = [];
        n.p = solid("rgb(255,255,255)");
        n.k = stroke("rgb(148,163,184)");
      }
    }
    const kids = n.ch ?? [];
    const chips = kids.filter((c) => c.n?.startsWith("Chip /") && !c.a);
    if (chips.length >= 2) chipGroup(n, chips, field, live);
    const options = kids.filter((c) => c.n?.startsWith("Option /") && !c.a);
    if (options.length >= 2) optionGroup(n, options, live);
    kids.forEach((c) => walk(c, field));
  };
  walk(root, "");
}

function chipGroup(group: DesignNode, chips: DesignNode[], field: string, live: Live) {
  const many = /allerg|condition/i.test(field);
  const key = `pick:${group.id}`;
  const designed = chips.filter((c) => fillOf(c) === NAVY).map(label);
  const picked = key in live.filters ? list(live.filters[key]) : designed;
  chips.forEach((chip) => {
    const value = label(chip);
    const textNode = texts(chip)[0];
    const typed = textNode && live.texts[textNode.id];
    if (typed) {
      // The text a patient typed into "+ Add other", so the chip grows to fit it.
      chip.w = Math.max(chip.w, typed.length * 7 + 26);
    }
    const on = picked.includes(value);
    chip.a = /^\+/.test(value)
      ? click("addOther", textNode?.id)
      : click("pick", `${key}|${value}|${many ? "many" : "one"}|${designed.join("\t")}`);
    chip.role = "button";
    chip.pressed = on;
    chip.p = solid(on || typed ? NAVY : "rgb(255,255,255)");
    chip.k = on || typed ? undefined : stroke(LINE);
    paintText(chip, on || typed ? "rgb(255,255,255)" : "rgb(51,65,85)");
  });
}

function optionGroup(group: DesignNode, options: DesignNode[], live: Live) {
  const key = `pick:${group.id}`;
  const isOn = (o: DesignNode) => o.k?.p.k === "s" && o.k.p.c === TEAL;
  const designed = options.find(isOn);
  const picked = live.filters[key] ?? (designed ? label(designed) : "");
  options.forEach((o) => {
    const on = label(o) === picked;
    o.a = click("pick", `${key}|${label(o)}|one|`);
    o.k = { p: { k: "s", c: on ? TEAL : LINE }, w: on ? 2 : 1, a: "INSIDE" };
    const tile = o.ch?.find((c) => !c.tx && c.w <= 40 && c.h <= 40);
    if (tile) tile.p = solid(on ? TEAL : "rgb(248,250,252)");
  });
}

const DAY_STATUS = /^(Open|Till \d+ AM|Selected)$/;
export const slotTime = (slot: string) => {
  const hour = Number(slot.split(":")[0]);
  return `${slot} ${hour >= 9 && hour <= 11 ? "AM" : "PM"}`;
};
export const bookingWhen = (live: Live) => `${live.filters.bookDay || "Thu 29"} May · ${slotTime(live.filters.bookSlot || "11:00")}`;

const dayIso = (day: string) => `2025-05-${day.split(" ")[1].padStart(2, "0")}`;

// Whether the doctor's leave, blocked time or an earlier booking has taken this slot. Empty means it's free.
export function slotProblem(live: Live, day: string, slot: string) {
  const date = dayIso(day);
  const at = minutes(slotTime(slot));
  const leave = leaveFor(date, live.leaves);
  if (leave) {
    const [from, to] = leaveWindow(leave);
    if (at >= from && at < to) return "Dr. Mehta is on leave then. Pick another time.";
  }
  if (blocksFor(date, live.blocks).some((b) => at >= minutes(b.from) && at < minutes(b.to))) return "Dr. Mehta has blocked that time. Pick another one.";
  if (list(live.filters.bookings).some((b) => b.startsWith(`${day} May · ${slotTime(slot)}|`))) return "That time was just booked. Pick another one.";
  return "";
}

function bookScreen(root: DesignNode, live: Live) {
  const day = live.filters.bookDay || "Thu 29";
  const slot = live.filters.bookSlot || "11:00";
  const walk = (n: DesignNode) => {
    if (n.n?.startsWith("Slot /")) {
      const value = label(n);
      const closed = texts(n)[0]?.p?.[0]?.k === "s" && (texts(n)[0].p![0] as { c: string }).c === "rgb(203,213,225)";
      const problem = slotProblem(live, day, value);
      if (problem) {
        n.a = click("say", problem);
        n.p = solid("rgb(248,250,252)");
        n.k = undefined;
        paintText(n, "rgb(203,213,225)");
      } else if (!closed) {
        const on = value === slot;
        n.a = click("pick", `bookSlot|${value}|one|`);
        n.role = "button";
        n.pressed = on;
        n.p = solid(on ? NAVY : "rgb(255,255,255)");
        n.k = on ? undefined : stroke(LINE);
        paintText(n, on ? "rgb(255,255,255)" : "rgb(15,23,42)");
      } else {
        n.a = click("say", "That time is already taken. Pick an open one.");
      }
    }
    const parts = n.ch?.filter((c) => c.tx) ?? [];
    if (parts.length === 3 && n.h >= 78 && n.h <= 84 && n.w <= 70 && (!n.a || parts[2].tx!.v === "Doctor on leave")) {
      const name = `${parts[0].tx!.v} ${parts[1].tx!.v}`;
      const leave = leaveFor(dayIso(name), live.leaves);
      const designedLeave = parts[2].tx!.v === "Doctor on leave";
      // The doctor's calendar decides, so leave added or cancelled there shows up here.
      if (designedLeave && !leave) n.a = undefined;
      const status = designedLeave && !leave ? "Open" : parts[2].tx!.v;
      if (leave && !designedLeave && leave.part === "Whole day") {
        n.a = click("say", "Dr. Mehta is on leave that day. Pick another date.");
        n.p = solid("rgb(255,237,213)");
        n.k = undefined;
        parts[1].p = solid("rgb(148,163,184)");
        parts[2].p = solid("rgb(154,52,18)");
        parts[2].x = -9;
        parts[2].w = 83;
        setWords(parts[2], "Doctor on leave");
      } else if (DAY_STATUS.test(status)) {
        const on = name === day;
        n.a = click("pick", `bookDay|${name}|one|`);
        n.role = "button";
        n.pressed = on;
        n.p = solid(on ? NAVY : "rgb(255,255,255)");
        n.k = on ? undefined : stroke(LINE);
        parts[0].p = solid(on ? "rgb(184,199,230)" : "rgb(100,116,139)");
        parts[1].p = solid(on ? "rgb(255,255,255)" : "rgb(15,23,42)");
        parts[2].p = solid(on ? "rgb(199,255,235)" : "rgb(11,95,87)");
        const shown = on ? "Selected" : status === "Selected" ? "Open" : status;
        if (shown !== parts[2].tx!.v) {
          const width = shown.length * 6;
          parts[2].x = (n.w - width) / 2;
          parts[2].w = width;
          setWords(parts[2], shown);
        }
      } else if (status === "Closed" || status === "Full") {
        n.a = click("say", status === "Full" ? "That day is full. Pick another date." : "The clinic is closed that day.");
      }
    }
    n.ch?.forEach(walk);
  };
  walk(root);
  const summary = find(root, (n) => n.tx?.v === "Thu 29 May · 11:00 AM");
  if (summary) setWords(summary, bookingWhen(live));
  const who = find(root, (n) => n.tx?.v.startsWith("James · Follow-up") ?? false);
  if (who && live.filters.bookFor) setWords(who, who.tx!.v.replace("James", live.filters.bookFor));
}

const APPT_TABS = ["Upcoming", "Past", "Cancelled"];
const PAST: string[][] = [
  ["JAMES · TUE 15 APR 10:00 AM", "Dr. Arjun Mehta · Thanal Heart Clinic", "Follow-up visit · paid ₹400"],
  ["JAMES · MON 10 MAR 11:30 AM", "Dr. Arjun Mehta · Thanal Heart Clinic", "New consultation · paid ₹600"],
  ["MARY · FRI 21 FEB 3:00 PM", "Dr. Arjun Mehta · Thanal Heart Clinic", "Blood pressure check · paid ₹400"],
];

function cloneRow(template: DesignNode, id: string, line: string[], status: string, note: string) {
  const row: DesignNode = JSON.parse(JSON.stringify(template));
  const walk = (n: DesignNode) => {
    n.id = `${id}:${n.id}`;
    n.ch?.forEach(walk);
  };
  walk(row);
  const all = texts(row);
  line.forEach((v, i) => all[i] && setWords(all[i], v));
  if (all[3]) setWords(all[3], status);
  const button = row.ch?.[row.ch.length - 1];
  if (button) {
    button.a = click("say", note);
    const buttonText = texts(button)[0];
    if (buttonText) setWords(buttonText, "Details");
  }
  return row;
}

function appointments(root: DesignNode, live: Live) {
  const tabs = find(root, (n) => Boolean(n.ch?.some((c) => c.n?.startsWith("Tab /"))));
  const rows = tabs && (pathTo(root, tabs.id) ?? []).slice(-2)[0];
  if (!tabs || !rows) return;
  const active = live.filters.apptTab || "Upcoming";
  const cards = (rows.ch ?? []).filter((c) => c !== tabs);
  const template = cards[cards.length - 1];
  if (!template) return;
  const booked = list(live.filters.bookings);
  const cancelled = list(live.filters.cancelled);
  const shownHere = cards.filter((c) => !live.hidden[c.id]).length;
  tabs.ch?.forEach((tab) => {
    if (!tab.n?.startsWith("Tab /")) return;
    const name = APPT_TABS.find((t) => label(tab).startsWith(t)) ?? "";
    const on = name === active;
    tab.a = click("pick", `apptTab|${name}|one|`);
    tab.role = "button";
    tab.pressed = on;
    tab.p = on ? solid(NAVY) : [];
    paintText(tab, on ? "rgb(255,255,255)" : "rgb(71,85,105)");
    const textNode = texts(tab)[0];
    if (name === "Upcoming" && textNode) setWords(textNode, `Upcoming (${shownHere + booked.length})`);
    if (name === "Cancelled" && textNode && cancelled.length) setWords(textNode, `Cancelled (${cancelled.length})`);
  });
  const add = (made: DesignNode[]) => {
    const step = template.h + 16;
    made.forEach((row, i) => {
      row.x = template.x;
      row.y = 62 + i * step;
    });
    const top = rows.ch?.filter((c) => c.y >= 62) ?? [];
    top.forEach((c) => (c.y += made.length * step));
    rows.ch = [...(rows.ch ?? []), ...made];
    reflow(root, rows, 1e9, made.length * step);
  };
  if (active === "Upcoming") {
    add(booked.map((b, i) => {
      const [when, who] = b.split("|");
      return cloneRow(template, `booked-${i}`, [`${who.toUpperCase()} · ${when.replace(" · ", " ").toUpperCase()}`, "Follow-up · Dr. Arjun Mehta", "Booking APT-58213 · paid ₹20"], "Booked", `${who}’s visit is booked for ${when}.`);
    }));
    return;
  }
  removeRows(root, rows, cards);
  if (active === "Past") {
    add(PAST.map((line, i) => cloneRow(template, `past-${i}`, line, "Done", `${line[1]}. ${line[2]}.`)));
    return;
  }
  const empty = ["YOUR CANCELLED VISITS", "Nothing cancelled", "Visits you cancel show here with their refund."];
  add((cancelled.length ? cancelled : [empty.join("|")]).map((c, i) => {
    const line = c.split("|");
    return cloneRow(template, `cancelled-${i}`, line, cancelled.length ? "Cancelled" : "None", cancelled.length ? "This visit was cancelled and any refund is on its way." : "Nothing has been cancelled.");
  }));
}

const FEMALE_DOCTORS = /Leena|Meera|Priya|Nair/;

function careFilters(root: DesignNode, live: Live) {
  const f = live.filters;
  const q = (f.careQuery ?? "").trim().toLowerCase();
  const show = f["care:Doctors"];
  const when = f["care:Today"];
  const distance = f["care:Under 5 km"];
  const language = f["care:English"];
  const doctor = f["care:Any"];
  const fee = f["care:Under ₹500"];
  const keep = (card: DesignNode, isDoctor: boolean) => {
    const t = words(card);
    if (q && !t.toLowerCase().includes(q)) return false;
    if (show === "Clinics" && isDoctor) return false;
    if (show === "Doctors" && !isDoctor) return false;
    const km = Number(t.match(/([\d.]+) km/)?.[1] ?? 0);
    if (distance === "Under 5 km" && km >= 5) return false;
    if (distance === "Under 10 km" && km >= 10) return false;
    if (!isDoctor) return true;
    if (when === "Today" && !/Next open: Today/.test(t)) return false;
    if (when === "Tomorrow" && !/Next open: Tomorrow/.test(t)) return false;
    if (language && language !== "Any" && !t.includes(language)) return false;
    if (doctor === "Female" && !FEMALE_DOCTORS.test(t)) return false;
    if (doctor === "Male" && FEMALE_DOCTORS.test(t)) return false;
    const price = Number(t.match(/₹([\d,]+)/)?.[1].replace(",", "") ?? 0);
    if (fee === "Under ₹500" && price >= 500) return false;
    if (fee === "Under ₹800" && price >= 800) return false;
    return true;
  };
  const walk = (n: DesignNode) => {
    const kids = n.ch ?? [];
    const cards = kids.filter((c) => c.w >= 900 && c.h <= 220 && /View (profile|clinic)/.test(words(c)));
    if (cards.length) {
      const gone = cards.filter((c) => !keep(c, /View profile/.test(words(c))));
      if (gone.length === cards.length && gone.length) {
        // Every result filtered out, so the first card becomes the message instead of a blank page.
        const first = gone.shift()!;
        const all = texts(first);
        all.forEach((t, i) => setWords(t, i === 0 ? "No results match these filters" : i === 1 ? "Press Clear to see everyone again." : ""));
        first.ch = first.ch?.filter((c) => texts(c).some((t) => t.tx!.v));
      }
      removeRows(root, n, gone);
      return;
    }
    kids.forEach(walk);
  };
  walk(root);
}

function wireFindCare(root: DesignNode) {
  const walk = (n: DesignNode, parent?: DesignNode, card?: string) => {
    const place = n.w >= 900 && n.h <= 220 && /View (profile|clinic)/.test(words(n)) ? words(n) : card;
    if (n.n === "Button / View profile" && !n.a) n.a = click("viewDoctor", place?.split(" ").slice(0, 3).join(" "));
    if (n.ch?.length === 1 && n.ch[0].tx?.v === "Search" && n.w <= 120) n.a = click("careSearch");
    if (n.tx?.v === "Clear" && !n.a) n.a = click("careClear");
    // The design draws the search boxes as plain frames, so they become real fields.
    if (parent && n.tx && /^(Search doctor|Cardiologist$)/.test(n.tx.v) && parent.w >= 400 && parent.n !== "Input") {
      parent.n = "Input";
      parent.a = undefined;
      n.n = "Value";
    }
    n.ch?.forEach((c) => walk(c, n, place));
  };
  walk(root);
}

function billPaid(root: DesignNode, name: string) {
  const walk = (n: DesignNode) => {
    const gone = n.ch?.filter((c) => c.w >= 300 && c.h <= 110 && (/^Bill to pay/.test(words(c)) || /^TO PAY NOW/.test(words(c)))) ?? [];
    if (gone.length) removeRows(root, n, gone);
    n.ch?.forEach(walk);
  };
  walk(root);
  if (!name.startsWith("Patient web / Bills")) return;
  const heading = find(root, (n) => n.tx?.v === "Pending");
  const card = heading && (pathTo(root, heading.id) ?? []).slice(-2)[0];
  card?.ch?.forEach((c) => {
    if (c.tx?.v === "₹700") setWords(c, "₹0");
    if (c.tx?.v === "Today’s visit") setWords(c, "Nothing due");
  });
  const status = find(root, (n) => n.tx?.v === "To pay");
  if (status) setWords(status, "Paid");
  const pay = find(root, (n) => n.n === "Button / Pay TH-0518");
  const payText = pay && texts(pay)[0];
  if (pay && payText) {
    setWords(payText, "Paid");
    pay.a = click("say", "Bill TH-0518 is paid. Your receipt is in Records.");
  }
}

const BILL_KINDS: Record<string, RegExp> = {
  "Clinic visits": /Clinic ·|Centre|booking fee/,
  Medicines: /Pharmacy|medicines/,
  "Lab tests": /Lab|Diagnostics/,
  Refunds: /Refund/,
};

function billFilter(root: DesignNode, live: Live) {
  const chips = find(root, (n) => Boolean(n.ch?.some((c) => c.n === "Filter / All")));
  const list = chips && (pathTo(root, chips.id) ?? []).slice(-2)[0];
  if (!chips || !list) return;
  const active = live.filters.billKind || "All";
  chips.ch?.forEach((chip) => {
    const value = label(chip);
    const on = value === active;
    chip.a = click("pick", `billKind|${value}|one|`);
    chip.role = "button";
    chip.pressed = on;
    chip.p = solid(on ? NAVY : "rgb(255,255,255)");
    chip.k = on ? undefined : stroke(LINE);
    paintText(chip, on ? "rgb(255,255,255)" : "rgb(51,65,85)");
  });
  const test = BILL_KINDS[active];
  if (test) removeRows(root, list, (list.ch ?? []).filter((c) => c !== chips && !test.test(words(c))));
}

function uploads(root: DesignNode, live: Live) {
  const files = list(live.filters.uploads);
  const outside = find(root, (n) => n.w >= 800 && n.h <= 70 && /Emergency visit/.test(words(n)));
  const rows = outside && (pathTo(root, outside.id) ?? []).slice(-2)[0];
  if (!outside || !rows || !files.length) return;
  const first = rows.ch?.filter((c) => c.w >= 800).sort((a, b) => a.y - b.y)[0]?.y ?? outside.y;
  const step = 72;
  rows.ch?.forEach((c) => {
    if (c.y >= first) c.y += files.length * step;
  });
  const made = files.map((file, i) => {
    const row: DesignNode = JSON.parse(JSON.stringify(outside));
    const walk = (n: DesignNode) => {
      n.id = `upload-${i}:${n.id}`;
      n.ch?.forEach(walk);
    };
    walk(row);
    row.y = first + i * step;
    row.a = click("say", `${file} is kept in your records as an outside document.`);
    const all = texts(row);
    [`15 May`, file, "Uploaded by you · kept as an outside document", "Outside"].forEach((v, at) => all[at] && setWords(all[at], v));
    return row;
  });
  rows.ch = [...(rows.ch ?? []), ...made];
  reflow(root, rows, 1e9, files.length * step);
}

// The member added in the design's three-step "Add family" pop-up.
function familyAdded(root: DesignNode) {
  const third = find(root, (n) => n.w > 400 && n.w < 500 && n.h > 190 && n.h <= 210 && /Ella Heatfield/.test(words(n)));
  const row = third && (pathTo(root, third.id) ?? []).slice(-2)[0];
  if (!third || !row) return;
  const card: DesignNode = JSON.parse(JSON.stringify(third));
  const walk = (n: DesignNode) => {
    n.id = `thomas:${n.id}`;
    n.ch?.forEach(walk);
  };
  walk(card);
  card.x = 0;
  card.y = third.h + 20;
  const all = texts(card);
  ["TH", "Thomas Heatfield", "Father · 64 · O+", "Added today · agreed by OTP"].forEach((v, i) => all[i] && setWords(all[i], v));
  row.ch = [...(row.ch ?? []), card];
  reflow(root, row, 1e9, third.h + 20);
}

// What the doctor added on their side, shown on the patient's.
function fromDoctor(root: DesignNode, name: string, live: Live) {
  if (live.allergies.length) {
    const extra = live.allergies.map((a) => a.substance).join(", ");
    const walk = (n: DesignNode) => {
      if (n.tx?.v.startsWith("Allergy: Penicillin") ) setWords(n, n.tx.v.replace("Allergy: Penicillin", `Allergies: Penicillin, ${extra}`));
      n.ch?.forEach(walk);
    };
    walk(root);
  }
  if (name !== "Patient web / Medicines" || !live.meds.length) return;
  const first = find(root, (n) => n.w >= 900 && n.h <= 100 && /^Omeprazole 20 mg capsule/.test(words(n)));
  const rows = first && (pathTo(root, first.id) ?? []).slice(-2)[0];
  if (!first || !rows) return;
  const step = 98;
  rows.ch?.forEach((c) => {
    if (c.y >= first.y) c.y += live.meds.length * step;
  });
  const made = live.meds.map((m, i) => {
    const row: DesignNode = JSON.parse(JSON.stringify(first));
    const walk = (n: DesignNode) => {
      n.id = `med-${i}:${n.id}`;
      n.ch?.forEach(walk);
    };
    walk(row);
    row.y = first.y + i * step;
    const all = texts(row);
    [m.name, [m.dose, m.often, m.length].filter(Boolean).join(" · "), `Prescribed today · Dr. Arjun Mehta${m.when ? ` · ${m.when}` : ""}`, m.pharmacy ? `Sent to ${m.pharmacy.split(",")[0]}` : "New"].forEach((v, at) => all[at] && setWords(all[at], v));
    return row;
  });
  const title = find(rows, (n) => /^Current medicines/.test(n.tx?.v ?? ""));
  if (title) setWords(title, `Current medicines (${3 + live.meds.length})`);
  rows.ch = [...(rows.ch ?? []), ...made];
  reflow(root, rows, 1e9, live.meds.length * step);
}

const PROFILES: Record<string, { rows: [string, string, string, DesignNode["a"]][] }> = {
  Mary: {
    rows: [
      ["Refund of ₹620 on the way", "Mary’s visit moved by the doctor · back by 19 May", "Refund", [{ on: "click", acts: [{ k: "fx", fx: "goto", arg: "Patient web / Bills & payments" }] }]],
      ["Mary · Mother · 62 · Blood group B+", "Her full record isn’t available here. James’s is the complete record.", "Profile", [{ on: "click", acts: [{ k: "fx", fx: "goto", arg: "Patient web / Family" }] }]],
    ],
  },
  Ella: {
    rows: [
      ["Vaccination review on Sat 31 May", "Dr. Meera Nair · Paediatrics · 10:00 AM", "Booked", [{ on: "click", acts: [{ k: "fx", fx: "goto", arg: "Patient web / Appointments" }] }]],
      ["Ella · Daughter · 6 · Blood group A+", "Her full record isn’t available here. James’s is the complete record.", "Profile", [{ on: "click", acts: [{ k: "fx", fx: "goto", arg: "Patient web / Family" }] }]],
    ],
  },
};

function familyHome(root: DesignNode, live: Live) {
  const chips = find(root, (n) => n.ch?.length === 3 && words(n).startsWith("James (me)"));
  if (!chips) return;
  const person = live.filters.profile || "James";
  chips.ch?.forEach((chip) => {
    const value = words(chip).split(" ")[0];
    const on = value === person;
    chip.a = click("pick", `profile|${value}|one|`);
    chip.role = "button";
    chip.pressed = on;
    chip.p = on ? solid(NAVY) : [];
    paintText(chip, on ? "rgb(255,255,255)" : "rgb(51,65,85)");
  });
  const plan = PROFILES[person];
  if (!plan) return;
  const hello = find(root, (n) => n.tx?.v === "Good morning, James");
  if (hello) setWords(hello, `${person}’s health`);
  const attention = find(root, (n) => n.w >= 900 && /^Needs your attention/.test(words(n)) && !n.ch?.some((c) => c.w > 950 && c.h > 400));
  const rows = attention?.ch?.filter((c) => !c.tx && c.h >= 50 && c.h <= 80 && c.w >= 600).sort((a, b) => a.y - b.y) ?? [];
  if (attention && rows.length >= 3) {
    // Mary's change keeps its own row, because the design already has that pop-up.
    const own = person === "Mary" ? rows.find((r) => /^Mary’s visit/.test(words(r))) : undefined;
    const reuse = rows.filter((r) => r !== own).slice(0, plan.rows.length);
    reuse.forEach((row, i) => {
      const [title, sub, tag, act] = plan.rows[i];
      const all = texts(row);
      [title, sub, tag].forEach((v, at) => all[at] && setWords(all[at], v));
      row.a = act;
      // The status pill grows left to fit its new word.
      const pill = row.ch?.find((c) => c.t === "I" || (c.ch?.length === 1 && c.ch[0].tx));
      const pillText = pill?.ch?.[0];
      if (pill && pillText) {
        const grow = Math.max(0, tag.length * 7 - pillText.w);
        pill.x -= grow;
        pill.w += grow;
        pillText.w += grow;
      }
    });
    removeRows(root, attention, rows.filter((r) => r !== own && !reuse.includes(r)));
    const heading = texts(attention)[0];
    if (heading) setWords(heading, `For ${person}`);
  }
  const gone = root.ch?.filter((c) => /^(TODAY · 10:30 AM|Latest reports)/.test(words(c))) ?? [];
  removeRows(root, root, gone);
  const medicines = find(root, (n) => n.h <= 220 && /^Medicines today/.test(words(n)));
  const holder = medicines && (pathTo(root, medicines.id) ?? []).slice(-2)[0];
  if (holder) holder.ch = holder.ch?.filter((c) => c !== medicines);
}

function navLabels(root: DesignNode) {
  // The design clips this one label inside its tab.
  const label = find(root, (n) => n.tx?.v === "Records & sharing" && n.h < 30);
  const tab = label && (pathTo(root, label.id) ?? []).slice(-2)[0];
  if (tab && tab.w < 150) tab.c = undefined;
}

// Tests the doctor orders appear with the ones already asked for.
function labOrders(root: DesignNode, live: Live) {
  if (!live.orders.length) return;
  const first = find(root, (n) => n.w >= 800 && n.h <= 90 && /^Kidney panel \+ urine albumin/.test(words(n)));
  const model = find(root, (n) => n.w >= 800 && n.h <= 90 && /^Lipid profile/.test(words(n)));
  const rows = first && (pathTo(root, first.id) ?? []).at(-2);
  if (!first || !model || !rows) return;
  const step = 80;
  const added = live.orders.length * step;
  rows.ch?.forEach((c) => {
    if (c.y >= first.y) c.y += added;
  });
  const made = live.orders.map((o, i) => {
    const row: DesignNode = JSON.parse(JSON.stringify(model));
    const rename = (n: DesignNode) => {
      n.id = `order-${i}:${n.id}`;
      n.ch?.forEach(rename);
    };
    rename(row);
    row.y = first.y + i * step;
    const [title, line, status] = texts(row);
    if (title) setWords(title, o.test);
    if (line) setWords(line, ["Dr. Arjun Mehta", o.lab, o.before && `do before ${o.before}`, o.urgency].filter(Boolean).join(" · "));
    if (status) setWords(status, "Not booked yet");
    return row;
  });
  rows.ch = [...(rows.ch ?? []), ...made];
  reflow(root, rows, 1e9, added);
}

export function patientDoc(root: DesignNode, name: string, live: Live) {
  controls(root, live);
  wireFindCare(root);
  if (name === "Patient web / Book appointment") bookScreen(root, live);
  if (name === "PModal / Booked") {
    const when = find(root, (n) => n.tx?.v === "Thu 29 May · 11:00 AM");
    if (when) setWords(when, bookingWhen(live));
  }
  if (name === "Patient web / Lab tests") labOrders(root, live);
  if (name === "Patient web / Appointments") appointments(root, live);
  if (name.startsWith("Patient web / Find care")) careFilters(root, live);
  if (name === "Patient web / Bills & payments") billFilter(root, live);
  if (name === "Patient web / Records & sharing") uploads(root, live);
  if (name === "Patient web / Family" && live.filters.familyAdded) familyAdded(root);
  if (name.startsWith("Patient web")) {
    navLabels(root);
    fromDoctor(root, name, live);
    if (live.filters.billPaid || live.collected["T-04"]) billPaid(root, name);
    if (name === "Patient web / Home") familyHome(root, live);
  }
}
