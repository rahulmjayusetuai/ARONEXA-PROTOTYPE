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

// "Doctor on leave" doesn't fit a day tile, so the tile says "On leave".
function onLeave(tile: DesignNode, text: DesignNode) {
  const width = 48;
  text.x = (tile.w - width) / 2;
  text.w = width;
  setWords(text, "On leave");
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
        onLeave(n, parts[2]);
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
      } else if (designedLeave && leave) {
        onLeave(n, parts[2]);
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
  if (name === "Patient web / Book appointment" || name === "Patient web / Book appointment · from Health Hub") {
    bookScreen(root, live);
    reasonLine(root);
  }
  if (/^Patient web \/ (Health (hub|Hub|store)|Book appointment · from Health Hub)/.test(name)) healthScreens(root, name, live);
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

// Health hub and Health store: controls the design left unlinked, or linked to the Medicines page's pop-ups.
const REELS = [
  "Patient web / Health hub · reels viewer 1 (starts: 5-minute walk to lower your BP)",
  "Patient web / Health hub · reels viewer 2 (starts: How much salt is too much?)",
  "Patient web / Health hub · reels viewer 3 (starts: Slow breathing: 2 minutes for BP)",
  "Patient web / Health hub · reels viewer 4 (starts: Taking BP tablets the right way)",
];
const REEL_TITLES = ["5-minute walk to lower your BP", "How much salt is too much?", "Slow breathing: 2 minutes for BP", "Taking BP tablets the right way"];
// The four videos from the patient's doctor, with their real lengths. The design's lengths were placeholders.
const REEL_VIDEOS: Record<string, { file: string; was: string; length: string }> = {
  "5-minute walk to lower your BP": { file: "walk", was: "0:48", length: "0:46" },
  "How much salt is too much?": { file: "salt", was: "0:52", length: "0:48" },
  "Slow breathing: 2 minutes for BP": { file: "breathing", was: "1:05", length: "1:09" },
  "Taking BP tablets the right way": { file: "tablets", was: "0:40", length: "0:34" },
};
const HUB_SORTS = ["Most viewed", "Shortest first"];
const BOOK_FROM_HUB = "Patient web / Book appointment · from Health Hub";
const CART = "Patient web / Health store · Cart";
const goTo = (screen: string) => click("goto", screen);
const PAYING_WITH: Record<string, string> = { "Credit or debit card": "Card", "Net banking": "Net banking", "Pay on delivery": "On delivery", UPI: "UPI" };

function healthScreens(root: DesignNode, name: string, live: Live) {
  const all: DesignNode[] = [];
  const collect = (n: DesignNode) => {
    all.push(n);
    n.ch?.forEach(collect);
  };
  collect(root);
  const named = (prefix: string) => all.filter((n) => n.n?.startsWith(prefix));
  const set = (n: DesignNode | undefined, a: DesignNode["a"]) => {
    if (n && !n.a) n.a = a;
  };

  const ordered = live.filters.storeOrdered === "1" || name.endsWith("Order placed");
  const orders = [
    ordered && "AH-2042 · BP monitor and pulse oximeter · arriving Fri, 20 Nov",
    "Digital thermometer · ₹249 · delivered 4 Nov",
    "Knee support brace · ₹599 · delivered 28 Oct",
    "Omega-3 fish oil · ₹449 · delivered 12 Oct",
  ].filter(Boolean);
  for (const n of all) {
    if (n.t === "T") continue;
    const w = words(n).trim();
    // The store's header buttons were copied from the Medicines page and still opened its pop-ups.
    if (w === "View cart (2)" && n.a) n.a = goTo(CART);
    if (w === "My orders" && n.a) n.a = click("say", `Your orders: ${orders.join(". ")}.`);
    if (w === "Place your order" && n.a && !n.a[0].acts.some((x) => x.k === "fx")) {
      n.a = [{ ...n.a[0], acts: [{ k: "fx", fx: "chipOne", arg: "storeOrdered|1" } as Action, ...n.a[0].acts] }];
    }
  }

  // Health hub
  set(named("Button / Saved")[0], click("say", `Saved videos: ${REEL_TITLES.join(", ")}.`));
  named("Button / Ask doctor").forEach((n) => set(n, goTo(BOOK_FROM_HUB)));
  named("Action / Ask doctor").forEach((n) => set(n, goTo(BOOK_FROM_HUB)));
  named("Button / View lab result").forEach((n) => set(n, goTo("Patient web / Lab tests")));
  named("Button / Update my topics").forEach((n) => set(n, goTo("Patient web / Settings · Health profile")));
  named("Signal / Lab test").forEach((n) => set(n, goTo("Patient web / Lab tests")));
  named("Signal / Body map").forEach((n) => set(n, goTo("Patient web / My body · Joints")));
  named("Product row").forEach((row) => {
    const add = find(row, (n) => n.n === "Button / Add");
    set(add, goTo(CART));
    set(row, /BP monitor/.test(words(row)) ? goTo("Patient web / Health store · Digital BP monitor") : goTo("Patient web / Health store"));
  });
  reelVideos(all);
  // Only the four videos from the patient's doctor have been made; the other cards say so instead of doing nothing.
  all.filter((n) => n.cid === "832:15188" && !n.a).forEach((card) => {
    const title = [...texts(card)].sort((a, b) => (b.tx!.s ?? 0) - (a.tx!.s ?? 0))[0]?.tx!.v;
    card.a = click("say", `“${title}” is coming soon. For now, watch the videos from your doctor.`);
  });
  hubSort(all, live);
  hubFilter(root, all, live);

  // Reels viewer
  const reel = REELS.indexOf(name);
  if (reel >= 0) {
    set(named("Previous reel")[0], reel > 0 ? goTo(REELS[reel - 1]) : click("say", "This is the first video."));
    set(named("Next reel")[0], reel < REELS.length - 1 ? goTo(REELS[reel + 1]) : click("say", "You’ve reached the last video."));
  }
  named("Next / ").forEach((n) => {
    const at = REEL_TITLES.indexOf(n.n!.slice("Next / ".length));
    if (at >= 0) set(n, goTo(REELS[at]));
  });
  named("Action / Save").forEach((n) => set(n, click("say", "Saved to your videos.")));
  named("Action / Share").forEach((n) => set(n, click("share", "Link to this video copied.")));
  named("Action / Report").forEach((n) => set(n, click("say", "Thanks for telling us. Our team will review this video.")));

  // Health store
  storeSearch(root, all, live);
  named("Stepper").forEach((s) => s.ch?.forEach((c) => /^[−+]$/.test(words(c).trim()) && set(c, click("say", "Health devices are limited to one of each per order."))));
  named("Button / Apply").forEach((n) => set(n, click("say", "No coupons are available for these items right now.")));
  named("Button / Verify").forEach((n) => set(n, click("say", "UPI ID verified: james.heatfield@upi")));
  named("Button / Track order").forEach((n) =>
    set(n, click("say", "AH-2042: placed 18 Nov, packed today, out for delivery and delivered on Fri, 20 Nov.")),
  );
  radioGroup(named("Address / "), "storeAddress", live);
  radioGroup(named("Payment / "), "storePay", live);
  const paying = find(root, (n) => n.tx?.v === "Paying with");
  const payingValue = paying && (pathTo(root, paying.id) ?? []).at(-2)?.ch?.find((c) => c.tx && c !== paying);
  if (payingValue && live.filters.storePay) {
    const value = PAYING_WITH[live.filters.storePay] ?? live.filters.storePay;
    // The value is right-aligned in a box sized for "UPI", so it grows to the left.
    const width = Math.max(payingValue.w, value.length * 8.5);
    payingValue.x -= width - payingValue.w;
    payingValue.w = width;
    setWords(payingValue, value);
  }
  for (const n of all) {
    if (n.tx?.v === "Edit") {
      const card = (pathTo(root, n.id) ?? []).find((p) => p.n?.startsWith("Address / "));
      const line = card && texts(card)[1];
      if (line) set(n, click("edit", `${line.id}|Edit address|Address|${line.tx!.v}`));
    }
    if (n.tx?.v === "+ Add a new address" || n.tx?.v === "+  Add a new address") {
      set(n, click("say", "You can keep two delivery addresses. Edit one of them to change it."));
    }
  }

  // Booking from the Health hub
  if (name === BOOK_FROM_HUB) {
    const who = live.filters.bookFor || "James";
    named("For / ").forEach((c) => {
      const first = label(c).split(" ")[0];
      pickChip(c, first === who, click("pick", `bookFor|${first}|one|`));
    });
    const reasons = named("Reason / ");
    const reason = live.filters.bookReason || label(reasons.find((c) => fillOf(c) === NAVY) ?? reasons[0] ?? root);
    reasons.forEach((c) => pickChip(c, label(c) === reason, click("pick", `bookReason|${label(c)}|one|`)));
    const summary = find(root, (n) => /^James · /.test(n.tx?.v ?? "") && n.h < 30);
    if (summary && (live.filters.bookFor || live.filters.bookReason)) setWords(summary, `${who} · ${live.filters.bookReason || summary.tx!.v.split(" · ")[1]}`);
    const header = all.find((n) => words(n).trim() === "Book appointment" && n.t !== "T" && !n.a && n.h <= 50);
    set(header, goTo("Patient web / Book appointment"));
  }
}

// The design fits "For" and "Reason" on one line that clips the reasons, so "Reason" moves to a line of its own.
function reasonLine(root: DesignNode) {
  const reasonLabel = find(root, (n) => n.t === "T" && n.tx?.v === "Reason");
  const row = reasonLabel && (pathTo(root, reasonLabel.id) ?? []).at(-2);
  const card = row && (pathTo(root, row.id) ?? []).at(-2);
  if (!reasonLabel || !row || !card || reasonLabel.x <= 0) return;
  const shift = reasonLabel.x;
  const step = row.h + 8;
  row.ch?.forEach((c) => {
    if (c.x >= shift) {
      c.x -= shift;
      c.y += step;
    }
  });
  const bottom = row.y + row.h;
  row.h += step;
  reflow(root, card, bottom, step);
}

function pickChip(chip: DesignNode, on: boolean, a: DesignNode["a"]) {
  chip.a = a;
  chip.role = "button";
  chip.pressed = on;
  chip.p = solid(on ? NAVY : "rgb(255,255,255)");
  chip.k = on ? undefined : stroke(LINE);
  paintText(chip, on ? "rgb(255,255,255)" : "rgb(51,65,85)");
}

// One choice in a list of cards, each with a round radio: an address or a way to pay.
function radioGroup(cards: DesignNode[], key: string, live: Live) {
  const radioOf = (c: DesignNode) => find(c, (n) => n.n === "Radio");
  const designed = cards.find((c) => Boolean(radioOf(c)?.ch?.length));
  const plain = cards.find((c) => c !== designed);
  if (!designed || !plain) return;
  const copy = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  const onRadio = copy(radioOf(designed)!);
  const offRadio = copy(radioOf(plain)!);
  const on = { k: copy(designed.k), p: copy(designed.p) };
  const off = { k: copy(plain.k), p: copy(plain.p) };
  const picked = live.filters[key] ?? label(designed);
  cards.forEach((c) => {
    const yes = label(c) === picked;
    const r = radioOf(c);
    if (r) {
      r.ch = yes ? copy(onRadio.ch) : [];
      r.k = copy(yes ? onRadio.k : offRadio.k);
      r.p = copy(yes ? onRadio.p : offRadio.p);
    }
    c.k = copy(yes ? on.k : off.k);
    c.p = copy(yes ? on.p : off.p);
    c.a = click("pick", `${key}|${label(c)}|one|`);
    c.role = "button";
    c.pressed = yes;
  });
}

// The Topic and Type chips narrow the video sections and cards.
function hubFilter(root: DesignNode, all: DesignNode[], live: Live) {
  const groupOf = (chip: string) => all.find((n) => n.ch?.some((c) => c.n === chip));
  const topics = groupOf("Chip / For you");
  const types = groupOf("Chip / All types");
  if (!topics || !types) return;
  const topic = live.filters[`pick:${topics.id}`] || "For you";
  const type = live.filters[`pick:${types.id}`] || "All types";
  if ((topic === "For you" || topic === "All topics") && type === "All types") return;
  const isCard = (n: DesignNode) => n.cid === "832:15188" || n.n === "Hub / Video card";
  const rows = all.filter((n) => (n.ch?.filter(isCard).length ?? 0) >= 2);
  const sections = rows.map((r) => (pathTo(root, r.id) ?? []).at(-2)).filter((s): s is DesignNode => Boolean(s));
  const topicFits = (title: string) =>
    topic === "For you" || topic === "All topics" || (topic === "Hypertension" && /doctors|Hypertension/i.test(title)) || (topic === "Knee pain" && /knee/i.test(title)) || (topic === "Cholesterol" && /cholesterol/i.test(title));
  let left = 0;
  const empty: DesignNode[] = [];
  sections.forEach((section, i) => {
    const row = rows[i];
    const title = texts(section)[0]?.tx?.v ?? "";
    const cards = row.ch!.filter(isCard);
    const slots = cards.map((c) => c.x).sort((a, b) => a - b);
    const keep = topicFits(title) ? cards.filter((c) => type === "All types" || texts(c).some((t) => t.tx?.v === type)) : [];
    row.ch = row.ch!.filter((c) => !isCard(c) || keep.includes(c));
    [...keep].sort((a, b) => a.x - b.x).forEach((c, at) => (c.x = slots[at]));
    left += keep.length;
    if (!keep.length) empty.push(section);
  });
  const first = sections[0];
  for (const section of [...empty].reverse()) {
    const parent = (pathTo(root, section.id) ?? []).at(-2);
    if (parent && (left || section !== first)) removeRows(root, parent, [section]);
  }
  if (!left && first) {
    const heading = texts(first)[0];
    const kind = type === "All types" ? "" : `${type.toLowerCase()} `;
    if (heading) setWords(heading, `No ${kind}videos for ${topic === "For you" || topic === "All topics" ? "you" : topic} yet`);
    const sub = texts(first)[1];
    if (sub) setWords(sub, "Try another topic or type.");
  }
}

// Each of the doctor's video cards plays its real video, and every card and list shows its real length.
function reelVideos(all: DesignNode[]) {
  const titleIn = (n: DesignNode) => Object.keys(REEL_VIDEOS).find((t) => texts(n).some((x) => x.tx?.v === t));
  let first = true;
  for (const n of all) {
    if (n.t === "T" || !n.ch) continue;
    const title = titleIn(n);
    if (!title) continue;
    const video = REEL_VIDEOS[title];
    const isCard = n.cid === "832:15188" || n.n?.startsWith("Next / ");
    if (isCard) {
      texts(n).forEach((t) => {
        if (t.tx && t.tx.v.endsWith(video.was)) setWords(t, t.tx.v.slice(0, -video.was.length) + video.length);
      });
    }
    if (n.n === "Video" && n.p?.some((p) => p.k === "i")) {
      const tag = find(n, (c) => c.n === "Tag");
      const play = find(n, (c) => c.n === "Play");
      n.ch = [{
        id: `${n.id}:reel`, t: "F", x: 0, y: 0, w: n.w, h: n.h, live: "reel",
        props: { src: `/video/reel-${video.file}.mp4`, poster: `/video/reel-${video.file}.jpg`, captions: `/video/reel-${video.file}.vtt`, title, tag: tag ? words(tag).trim() : "", play: play?.g, first },
      }];
      first = false;
    }
  }
}

// Sorts each row of video cards by views or by length.
function hubSort(all: DesignNode[], live: Live) {
  const sort = all.find((n) => n.n === "Sort" && /^Sort:/.test(words(n)));
  if (!sort) return;
  const current = live.filters.hubSort || HUB_SORTS[0];
  const next = HUB_SORTS[(HUB_SORTS.indexOf(current) + 1) % HUB_SORTS.length];
  const text = texts(sort)[0];
  if (text) setWords(text, `Sort: ${current}  ▾`);
  sort.a = click("pick", `hubSort|${next}|one|`);
  const isCard = (n: DesignNode) => n.cid === "832:15188" || n.n === "Hub / Video card";
  const views = (n: DesignNode) => {
    const m = words(n).match(/([\d.]+)([KM]) views/);
    return m ? Number(m[1]) * (m[2] === "M" ? 1e6 : 1e3) : 0;
  };
  const seconds = (n: DesignNode) => {
    const m = words(n).match(/\b(\d+):(\d\d)\b/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
  };
  for (const row of all) {
    const cards = row.ch?.filter(isCard) ?? [];
    if (cards.length < 2) continue;
    const slots = cards.map((c) => c.x).sort((a, b) => a - b);
    const order = [...cards].sort((a, b) => (current === "Shortest first" ? seconds(a) - seconds(b) : views(b) - views(a)));
    order.forEach((c, i) => (c.x = slots[i]));
  }
}

// The store's search box and category chips filter its product sections.
const SECTION_OF: Record<string, (section: string, product: string, price: number) => boolean> = {
  "Health devices": (s, p) => /^Popular/.test(s) && !/Omega-3/.test(p),
  "Baby care": (s) => /^Baby care/.test(s),
  "Women’s hygiene": (s) => /^Women’s hygiene/.test(s),
  Supplements: (_s, p) => /Omega-3/.test(p),
  "Under ₹500": (_s, _p, price) => price < 500,
};

function storeSearch(root: DesignNode, all: DesignNode[], live: Live) {
  const field = all.find((n) => n.n === "Search field");
  const placeholder = field?.ch?.find((c) => c.tx);
  if (field && placeholder) {
    field.n = "Search";
    field.props = { ...field.props, filterKey: "store" };
    placeholder.n = "Placeholder";
  }
  const sections = all.filter((n) => (n.ch?.filter((c) => c.n?.startsWith("PProduct /")).length ?? 0) >= 2);
  if (!sections.length) return;
  named(all, "Button / Search").forEach((b) => !b.a && (b.a = click("scrollTo", sections[0].id)));
  const chips = all.find((n) => n.ch?.some((c) => c.n === "Chip / All"));
  const category = (chips && live.filters[`pick:${chips.id}`]) || "All";
  const q = (live.filters.store ?? "").trim();
  if (!q && category === "All") return;
  const keep = SECTION_OF[category];
  let shown = 0;
  for (const section of sections) {
    const header = find(section, (n) => n.n === "Header");
    const title = header ? words(header).replace(/\s*\(\d+\)$/, "") : "";
    const rows = section.ch!.filter((c) => c.n?.startsWith("PProduct /"));
    const misses = rows.filter((r) => {
      const text = words(r);
      const price = Number(text.match(/₹([\d,]+)/)?.[1].replace(/,/g, "") ?? 0);
      return (q && !text.toLowerCase().includes(q.toLowerCase())) || (keep && !keep(title, text, price));
    });
    const left = rows.length - misses.length;
    shown += left;
    const parent = (pathTo(root, section.id) ?? []).at(-2);
    if (!left && parent && (section !== sections[0] || !q)) {
      removeRows(root, parent, [section]);
      continue;
    }
    removeRows(root, section, misses);
    const heading = header && texts(header)[0];
    if (heading) setWords(heading, `${title} (${left})`);
  }
  const first = find(sections[0], (n) => n.n === "Header");
  const firstText = first && texts(first)[0];
  if (firstText && q) setWords(firstText, shown ? `Results for “${q}” (${shown})` : `No products match “${q}”`);
}

const named = (all: DesignNode[], prefix: string) => all.filter((n) => n.n?.startsWith(prefix));
