import type { Block, Leave, WalkIn } from "./state";

export const TODAY = "2025-05-15";

const pad = (n: number) => String(n).padStart(2, "0");
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parse = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const short = (s: string) => s.slice(0, 3);

export const longDate = (s: string) => {
  const d = parse(s);
  return `${WEEK[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};
export const fieldDate = (s: string) => {
  const d = parse(s);
  return `${short(WEEK[d.getDay()])}, ${d.getDate()} ${short(MONTHS[d.getMonth()])} ${d.getFullYear()}`;
};
export const plainDate = (s: string) => {
  const d = parse(s);
  return `${pad(d.getDate())} ${short(MONTHS[d.getMonth()])} ${d.getFullYear()}`;
};
export const weekdayShort = (s: string) => short(WEEK[parse(s).getDay()]);
export const monthLabel = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return `${MONTHS[mo - 1]} ${y}`;
};
export const shiftMonth = (m: string, by: number) => {
  const [y, mo] = m.split("-").map(Number);
  return iso(new Date(y, mo - 1 + by, 1)).slice(0, 7);
};
export const daysIn = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  const last = new Date(y, mo, 0).getDate();
  return Array.from({ length: last }, (_, i) => `${m}-${pad(i + 1)}`);
};

// "2:00 PM" or "14:00" to minutes after midnight.
export function minutes(t: string) {
  const m = t.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return 0;
  let h = Number(m[1]);
  const ap = m[3]?.toUpperCase();
  if (ap === "PM" && h < 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return h * 60 + Number(m[2]);
}
export const time12 = (mins: number) => {
  const h = Math.floor(mins / 60);
  const hh = h % 12 || 12;
  return `${hh}:${pad(mins % 60)} ${h < 12 ? "AM" : "PM"}`;
};
export const TIME_OPTIONS = Array.from({ length: 30 }, (_, i) => time12(7 * 60 + i * 30));

export type Clinic = "thanal" | "sahya";

export type Appt = {
  time: string;
  name: string;
  initials: string;
  reason: string;
  status: "Seen" | "With you now" | "Booked" | "Rescheduled" | "Rebooking sent";
  pid: string;
  who: string;
  via: string;
  james?: boolean;
};

type P = [name: string, who: string, pid: string, via: string, reason: string];

// Today's list, the same as the Doctor home screen and Billing.
const TODAY_THANAL: (P & unknown[])[] = [
  ["Priya Sharma", "F, 29", "ANX-71245", "AroNexa app", "Chest pain review"],
  ["Rahul Verma", "M, 52", "ANX-68830", "Phone call", "ECG follow-up"],
  ["Anita Joseph", "F, 38", "ANX-73102", "Walk-in", "New consultation"],
  ["James Heatfield", "M, 34", "ANX-78291", "AroNexa app", "Cardiology follow-up"],
  ["Mohammed Ali", "M, 47", "ANX-69311", "WhatsApp", "Blood pressure check"],
  ["Kavya Reddy", "F, 36", "ANX-74102", "AroNexa app", "Lipid report to explain"],
  ["Vikram Rao", "M, 58", "ANX-66104", "Phone call", "Palpitations"],
  ["Fathima Beevi", "F, 63", "ANX-61889", "AroNexa app", "Medicine review"],
  ["Arun Kumar", "M, 39", "ANX-72540", "Walk-in", "Post-surgery review"],
];
const TODAY_TIMES = ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "14:00", "14:30"];

const SAHYA: P[] = [
  ["Sneha Pillai", "F, 41", "ANX-70027", "AroNexa app", "Echo results"],
  ["Thomas Varghese", "M, 66", "ANX-58812", "Hospital desk", "Pacemaker check"],
  ["Rekha Menon", "F, 54", "ANX-63390", "AroNexa app", "Holter report review"],
  ["Abdul Kareem", "M, 49", "ANX-67745", "Phone call", "Echo after heart attack"],
  ["Gopika Das", "F, 31", "ANX-74410", "AroNexa app", "Palpitations"],
  ["Sanjay Pillai", "M, 58", "ANX-65021", "Walk-in", "Blood pressure review"],
];

const POOL: P[] = [
  ...TODAY_THANAL.filter((p) => p[0] !== "James Heatfield") as P[],
  ...SAHYA,
  ["Deepa Nair", "F, 44", "ANX-70981", "AroNexa app", "Blood pressure check"],
  ["Lijo Mathew", "M, 37", "ANX-71833", "Phone call", "ECG follow-up"],
  ["Jincy Kurian", "F, 52", "ANX-66720", "WhatsApp", "Medicine review"],
  ["Faisal Rahman", "M, 61", "ANX-60144", "AroNexa app", "Angina review"],
  ["Meera Krishnan", "F, 27", "ANX-75502", "Walk-in", "New consultation"],
  ["George Paul", "M, 70", "ANX-57311", "Phone call", "Heart failure review"],
];

// The counts the design shows for May and June 2025. Other months follow the same weekly rhythm.
const MAY = [8, 10, 4, 0, 6, 8, 10, 7, 9, 4, 0, 10, 7, 9, 9, 8, 4, 0, 9, 6, 8, 10, 8, 4, 0, 8, 10, 7, 9, 6, 4];
const JUNE = [0, 10, 7, 9, 6, 8, 4, 0, 9, 6, 8, 10, 7, 4, 0, 8, 10, 7, 9, 6, 4, 0, 7, 9, 6, 8, 10, 4, 0, 6];

function seed(s: string) {
  let h = 7;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 100003;
  return h;
}

function designedCount(date: string) {
  const d = parse(date);
  const day = d.getDate() - 1;
  if (date.startsWith("2025-05")) return MAY[day];
  if (date.startsWith("2025-06")) return JUNE[day];
  const wd = d.getDay();
  if (wd === 0) return 0;
  if (wd === 6) return 4;
  return 6 + (seed(date) % 5);
}

export function clinicHours(date: string, clinic: Clinic): [string, string] | null {
  const wd = parse(date).getDay();
  if (clinic === "sahya") return wd === 2 || wd === 4 ? ["17:00", "20:00"] : null;
  if (wd === 0) return null;
  return wd === 6 ? ["09:00", "11:00"] : ["09:00", "16:30"];
}

function slots(date: string, clinic: Clinic, count: number) {
  const hours = clinicHours(date, clinic);
  if (!hours) return [];
  const out: string[] = [];
  const end = minutes(hours[1]);
  for (let t = minutes(hours[0]); t < end && out.length < count; t += 30) {
    if (clinic === "thanal" && t >= 12 * 60 + 30 && t < 14 * 60) continue;
    out.push(`${pad(Math.floor(t / 60))}:${pad(t % 60)}`);
  }
  // A busy day doubles up slots rather than running past clinic hours.
  for (let t = minutes(hours[0]) + 15; out.length < count && t < end; t += 30) {
    if (clinic === "thanal" && t >= 12 * 60 + 30 && t < 14 * 60) continue;
    out.push(`${pad(Math.floor(t / 60))}:${pad(t % 60)}`);
  }
  return out.sort();
}

const initials = (name: string) => name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

function toAppt(p: P, time: string, status: Appt["status"]): Appt {
  return { time, name: p[0], who: p[1], pid: p[2], via: p[3], reason: p[4], initials: initials(p[0]), status, james: p[0] === "James Heatfield" };
}

export function baseAppointments(date: string, clinic: Clinic, walkIns: WalkIn[] = []): Appt[] {
  const past = date < TODAY;
  if (clinic === "sahya") {
    const hours = clinicHours(date, clinic);
    if (!hours) return [];
    const times = ["17:00", "17:30", "18:00", "18:30", "19:00", "19:30"];
    const shift = seed(date) % SAHYA.length;
    return times.map((t, i) => toAppt(date === TODAY ? SAHYA[i] : SAHYA[(i + shift) % SAHYA.length], t, past ? "Seen" : "Booked"));
  }
  if (date === TODAY) {
    const list = TODAY_THANAL.map((p, i) =>
      toAppt(p as P, TODAY_TIMES[i], i < 3 ? "Seen" : i === 3 ? "With you now" : "Booked"),
    );
    const extra = walkIns.map((w) => ({
      time: w.time,
      name: w.name,
      who: `${w.sex}, ${w.age}`,
      pid: w.pid,
      via: "Walk-in",
      reason: w.reason,
      initials: initials(w.name),
      status: "Booked" as const,
    }));
    return [...list, ...extra];
  }
  const count = designedCount(date);
  const offset = seed(date) % POOL.length;
  return slots(date, clinic, count).map((t, i) => toAppt(POOL[(offset + i * 3) % POOL.length], t, past ? "Seen" : "Booked"));
}

export function leaveWindow(l: Leave): [number, number] {
  if (l.part === "Morning only") return [0, 13 * 60];
  if (l.part === "Afternoon only") return [13 * 60, 24 * 60];
  if (l.part === "From a time" && l.fromTime) return [minutes(l.fromTime), 24 * 60];
  return [0, 24 * 60];
}

export const leaveFor = (date: string, leaves: Leave[]) => leaves.find((l) => date >= l.from && date <= l.to);
export const blocksFor = (date: string, blocks: Block[]) => blocks.filter((b) => b.date === date);

export type DayView = {
  date: string;
  hours: [string, string] | null;
  leave?: Leave;
  blocks: Block[];
  appts: Appt[];
  active: number;
};

// Applies leave and blocked time to a day's bookings, and reports who is still coming.
const FAMILY: Record<string, { name: string; who: string; pid: string }> = {
  James: { name: "James Heatfield", who: "M, 34", pid: "ANX-78291" },
  Mary: { name: "Mary Heatfield", who: "F, 62", pid: "ANX-78292" },
  Ella: { name: "Ella Heatfield", who: "F, 6", pid: "ANX-78293" },
};

// A patient's booking, saved as "Mon 26 May · 2:30 PM|James", on the doctor's calendar.
export function bookedBy(date: string, bookings = ""): Appt[] {
  return bookings.split("\n").filter(Boolean).flatMap((line) => {
    const [when, person] = line.split("|");
    const m = when.match(/^\w+ (\d+) May · (.+)$/);
    const f = FAMILY[person];
    if (!m || !f || `2025-05-${m[1].padStart(2, "0")}` !== date) return [];
    const mins = minutes(m[2]);
    const time = `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
    return [{ time, name: f.name, who: f.who, pid: f.pid, via: "AroNexa app", reason: "Follow-up · booked by the patient", initials: initials(f.name), status: "Booked" as const, james: person === "James" }];
  });
}

export function dayView(date: string, clinic: Clinic, leaves: Leave[], blocks: Block[], walkIns: WalkIn[], bookings = ""): DayView {
  const leave = leaveFor(date, leaves);
  const dayBlocks = blocksFor(date, blocks);
  const fromPatients = clinic === "thanal" ? bookedBy(date, bookings) : [];
  const appts = [...baseAppointments(date, clinic, walkIns), ...fromPatients].sort((a, b) => minutes(a.time) - minutes(b.time)).map((a) => {
    const t = minutes(a.time);
    if (a.status === "Seen" || a.status === "With you now") return a;
    if (leave) {
      const [from, to] = leaveWindow(leave);
      if (t >= from && t < to) return { ...a, status: "Rebooking sent" as const };
    }
    if (dayBlocks.some((b) => t >= minutes(b.from) && t < minutes(b.to))) return { ...a, status: "Rescheduled" as const };
    return a;
  });
  const active = appts.filter((a) => a.status !== "Rescheduled" && a.status !== "Rebooking sent").length;
  return { date, hours: clinicHours(date, clinic), leave, blocks: dayBlocks, appts, active };
}

// Billing figures, shared by the screen and its downloads.
export const TODAY_BILLS = [
  { token: "T-01", name: "Priya Sharma", services: "Follow-up consultation", amount: 400, mode: "UPI", paid: "Paid 9:21" },
  { token: "T-02", name: "Rahul Verma", services: "Follow-up + ECG", amount: 700, mode: "Cash", paid: "Paid 9:49" },
  { token: "T-03", name: "Anita Joseph", services: "New consultation", amount: 600, mode: "Card", paid: "Paid 10:21" },
  { token: "T-04", name: "James Heatfield", services: "Follow-up + ECG", amount: 700, mode: "", paid: "" },
  { token: "T-05", name: "Mohammed Ali", services: "Follow-up consultation", amount: 400, mode: "", paid: "" },
  { token: "T-06", name: "Kavya Reddy", services: "Follow-up consultation", amount: 400, mode: "", paid: "" },
  { token: "T-07", name: "Vikram Rao", services: "New consultation", amount: 600, mode: "", paid: "" },
  { token: "T-08", name: "Fathima Beevi", services: "Follow-up consultation", amount: 400, mode: "", paid: "" },
  { token: "T-09", name: "Arun Kumar", services: "Follow-up consultation", amount: 400, mode: "", paid: "" },
];

export const WEEK_ROWS = [
  ["Mon, 12 May", 10, 4300, 4300],
  ["Tue, 13 May", 7, 3100, 3100],
  ["Wed, 14 May", 9, 3900, 3900],
  ["Thu, 15 May", 9, 4600, 1700],
  ["Fri, 16 May", 8, 3500, 0],
  ["Sat, 17 May", 4, 1800, 0],
] as const;

export const MONTH_ROWS = [
  ["1 to 3 May", 22, 9400, 9400],
  ["5 to 10 May", 44, 18800, 18800],
  ["12 to 17 May", 47, 24800, 15000],
  ["19 to 24 May", 37, 12100, 12000],
  ["26 to 31 May", 44, 6400, 7200],
] as const;

const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export const collectedExtra = (collected: Record<string, string>) =>
  TODAY_BILLS.filter((b) => collected[b.token]).reduce((sum, b) => sum + b.amount, 0);

// One range of bills as rows of text, for the PDF and CSV.
export function billingTable(range: "today" | "week" | "month", collected: Record<string, string>, clinic: Clinic = "thanal"): string[][] {
  if (range === "today") {
    return [
      ["Token", "Patient", "Services", "Amount", "Paid by", "Status"],
      ...TODAY_BILLS.map((b) => {
        const mode = b.mode || collected[b.token] || "-";
        const status = b.paid || (collected[b.token] ? "Paid now" : b.token === "T-04" ? "Pending" : "Not billed yet");
        return [b.token, b.name, b.services, rupees(b.amount), mode, status];
      }),
      ["Total", "9 patients", "", rupees(TODAY_BILLS.reduce((s, b) => s + b.amount, 0)), "", ""],
    ];
  }
  const rows = range === "week" ? WEEK_ROWS : MONTH_ROWS;
  const extra = collectedExtra(collected);
  const share = clinic === "sahya" ? 0.7 : 1;
  const current = range === "week" ? "Thu, 15 May" : "12 to 17 May";
  const lines = rows.map((r) => [r[0], String(r[1]), rupees(Math.round(r[2] * share)), rupees(Math.round((r[3] + (r[0] === current ? extra : 0)) * share))]);
  const sum = rows.reduce((a, r) => [a[0] + r[1], a[1] + r[2], a[2] + r[3]], [0, 0, 0]);
  return [
    [range === "week" ? "Day" : "Week", "Patients", "Expected", clinic === "sahya" ? "Your share" : "Collected"],
    ...lines,
    ["Total", String(sum[0]), rupees(Math.round(sum[1] * share)), rupees(Math.round((sum[2] + extra) * share))],
  ];
}
