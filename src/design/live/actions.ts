"use client";

import { calendarReturn, goTo, load, loaded, manifest, screensById, useDesign } from "../store";
import type { Action, DesignNode } from "../types";
import { blocksFrom, exportSource, printBlocks, writePdf } from "./export";
import { bookingWhen, readCart, slotProblem, videoTitles, writeCart } from "./patient";
import { liveDoc, scanOrganOf, TIMELINE_TYPES, timelineScreen } from "./transform";
import { TODAY } from "./schedule";
import { newId, useLive } from "./state";

export type ActionContext = { node?: DesignNode; parent?: DesignNode; overlay?: number };

const screenNamed = (name: string) => manifest.screens.find((s) => s.name === name)?.id;

export function toast(name: string) {
  const id = screenNamed(name);
  if (id) void load(id).then(() => useDesign.getState().openOverlay(id));
}
export const say = (text: string) => useDesign.getState().setNotice(text);

export function collectText(n?: DesignNode, out: string[] = []) {
  if (!n) return out;
  if (n.tx) out.push(n.tx.v);
  n.ch?.forEach((c) => collectText(c, out));
  return out;
}

const walkFind = (n: DesignNode, test: (x: DesignNode) => boolean): DesignNode | undefined => {
  if (test(n)) return n;
  for (const c of n.ch ?? []) {
    const hit = walkFind(c, test);
    if (hit) return hit;
  }
  return undefined;
};

const screenDoc = () => loaded.get(useDesign.getState().screen);
const screenName = () => screensById.get(useDesign.getState().screen)?.name ?? "";

// Reads a form field by its design text, whether or not the doctor changed it.
function formValue(id: string, doc: DesignNode | undefined) {
  const typed = useDesign.getState().values[id];
  if (typed !== undefined) return typed.trim();
  const node = doc && walkFind(doc, (n) => n.id === id);
  return (node?.tx?.v ?? "").replace(/\s*▾$/, "").replace(/\|$/, "").trim();
}

// The chip showing as selected in the group holding `chipId`.
function chipValue(chipId: string, doc: DesignNode | undefined) {
  const group = doc && walkFind(doc, (n) => Boolean(n.ch?.some((c) => c.id === chipId)));
  if (!group) return "";
  const { over } = useDesign.getState();
  const on = group.ch?.find((c) => {
    const cid = over[c.id] ?? c.cid;
    return cid === "189:4360" || cid === "189:4367";
  });
  return collectText(on).join(" ");
}

function overlayDoc(ctx: ActionContext) {
  const o = useDesign.getState().overlays.find((x) => x.key === ctx.overlay);
  return o ? loaded.get(o.id) : undefined;
}

const PENICILLIN_GROUP = /amox|ampicil|penicil|co-?amox|augment/i;

// Saves a pop-up's form. Returns false to keep the pop-up open and show what is wrong.
function submitForm(toastName: string, ctx: ActionContext): boolean {
  const doc = overlayDoc(ctx);
  const live = useLive.getState();
  if (toastName === "Toast / allergy") {
    const substance = formValue("188:4659", doc);
    if (!substance) return say("Enter the substance the patient is allergic to."), false;
    live.add("allergies", {
      id: newId(),
      substance,
      type: chipValue("189:4730", doc),
      severity: chipValue("189:4738", doc),
      reaction: formValue("188:4684", doc),
      year: formValue("188:4690", doc),
      by: formValue("188:4695", doc),
    });
    return true;
  }
  if (toastName === "Toast / event") {
    const what = formValue("188:4943", doc);
    if (!what) return say("Describe what happened."), false;
    live.add("events", { id: newId(), type: chipValue("189:4754", doc), date: formValue("188:4933", doc), where: formValue("188:4938", doc), what });
    return true;
  }
  if (toastName === "Toast / order") {
    const test = formValue("188:4504", doc);
    if (!test) return say("Enter the test to order."), false;
    live.add("orders", { id: newId(), type: chipValue("189:4704", doc), test, lab: formValue("188:4510", doc), before: formValue("188:4515", doc), urgency: chipValue("189:4718", doc) });
    return true;
  }
  if (toastName === "Toast / rx") {
    const name = formValue("188:4551", doc);
    if (!name) return say("Search for a medicine first."), false;
    const added = live.allergies.find((a) => name.toLowerCase().includes(a.substance.toLowerCase().split(" ")[0]));
    if (PENICILLIN_GROUP.test(name)) return say(`Blocked: James is allergic to penicillin. Choose the suggested Azithromycin instead.`), false;
    if (added) return say(`Blocked: James has a recorded allergy to ${added.substance}.`), false;
    // The prescription is issued to the patient; older layouts also picked a pharmacy.
    const pharmacy = formValue("211:4964", doc);
    live.add("meds", { id: newId(), name, dose: formValue("188:4570", doc), often: formValue("188:4575", doc), length: formValue("188:4580", doc), when: chipValue("189:4724", doc), pharmacy });
    if (pharmacy) live.setText("toast:rx", pharmacy.split(",")[0]);
    return true;
  }
  if (toastName === "Toast / upload") {
    const f = pendingUpload;
    live.add("docs", {
      id: newId(),
      name: f?.name ?? "Holter_report_22May2025.pdf",
      size: f?.size ?? "1.2 MB",
      url: f?.url,
      folder: formValue("188:4628", doc),
      organ: formValue("188:4633", doc),
      date: "15 May 2025",
    });
    pendingUpload = null;
    useLive.getState().setFilter("uploadName", "");
    return true;
  }
  return true;
}

type Pending = { name: string; size: string; url: string };
let pendingUpload: Pending | null = null;

const sizeText = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export function acceptUpload(file: File) {
  if (file.size > 20 * 1048576) return say("That file is over the 20 MB limit.");
  if (!/\.(pdf|jpe?g|png)$/i.test(file.name)) return say("Only PDF, JPG or PNG files can be added.");
  pendingUpload = { name: file.name, size: sizeText(file.size), url: URL.createObjectURL(file) };
  useLive.getState().setFilter("uploadName", `${file.name} · ${pendingUpload.size}`);
}

export function pickFile(accept: string, then: (f: File) => void) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.onchange = () => {
    const f = input.files?.[0];
    if (f) then(f);
  };
  input.click();
}

function runExport(kind: "download" | "print", ctx: ActionContext, row?: DesignNode) {
  const src = exportSource(row, ctx.overlay);
  if (kind === "print") return printBlocks(src.title, src.subtitle, src.blocks);
  return void writePdf(src.title, src.subtitle, src.blocks);
}

// The nearest table row holding this button, so a row's Download saves just that row.
function rowOf(node?: DesignNode) {
  const doc = screenDoc();
  if (!node || !doc || useDesign.getState().overlays.length) return undefined;
  let found: DesignNode | undefined;
  const walk = (n: DesignNode, path: DesignNode[]): boolean => {
    if (n.id === node.id) {
      found = [...path].reverse().find((p) => p.h >= 40 && p.h <= 130 && p.w >= 600);
      return true;
    }
    return (n.ch ?? []).some((c) => walk(c, [...path, n]));
  };
  walk(doc, []);
  return found;
}

// Sign-in and registration steps check their fields before moving on.
function checkStep(ctx: ActionContext) {
  const name = screenName();
  const label = collectText(ctx.node).join(" ");
  const doc = screenDoc();
  if (!doc) return false;
  const { values } = useDesign.getState();
  const live = useLive.getState();
  const isForward = /^(Sign in|Continue|Check and submit|Submit for verification|സൈൻ ഇൻ|തുടരുക)/.test(label);
  if (!isForward || !/^(Login|Register)/.test(name)) return false;
  // Optional boxes that only show a hint, like the HFR ID search, may stay empty.
  const cleared = Object.entries(values).some(([id, v]) => !v.trim() && walkFind(doc, (n) => n.id === id && n.n !== "Placeholder"));
  if (cleared) return say("Fill in the empty fields first."), true;
  if (name.startsWith("Register / 1")) {
    const secrets: DesignNode[] = [];
    const walk = (n: DesignNode) => {
      if (n.tx && /^•+$/.test(n.tx.v)) secrets.push(n);
      n.ch?.forEach(walk);
    };
    walk(doc);
    const typed = secrets.map((n) => values[n.id] ?? "password");
    if (typed.length === 2 && typed[0] !== typed[1]) return say("The two passwords don’t match."), true;
    if (typed[0] && (typed[0].length < 8 || (!/\d/.test(typed[0]) && typed[0] !== "password"))) return say("Use at least 8 characters with a number."), true;
  }
  const unticked = Object.entries(live.checks).some(([id, on]) => !on && walkFind(doc, (n) => n.id === id));
  if (name.startsWith("Register /") && unticked) return say("Tick the box to agree before you continue."), true;
  return false;
}

const TABLE_REPORT = /Download (all|timeline|statement)/;

// Runs the real behaviour behind a design action. Returns true when the action should go no further.
// The clinic, lab, AroNexa team and partner portals reuse the pharmacy's top bar and tabs, whose design links
// still point at pharmacy pages. Send them to the matching page of their own portal when one exists,
// and say so plainly when it doesn't.
const OWN_PAGES = /^(Reception web|ClinicAdmin web|Lab web|Pathologist web|Platform web|Support web|Insurer web|Dealer web|Seller web) \//;

const PORTAL_POPUPS: Record<string, string> = { "Reception web": "RcModal", "ClinicAdmin web": "CaModal", "Lab web": "LbModal", "Pathologist web": "PaModal" };

function keepInArea(act: Action, ctx: ActionContext): boolean {
  if (act.k !== "nav" && act.k !== "ov" && act.k !== "swap") return false;
  const here = screensById.get(useDesign.getState().screen);
  const there = screensById.get(act.to);
  if (!here || !there || !here.module || here.module === "pharmacy" || here.module === "patient") return false;
  // Sign-in pages link to the other portals on purpose.
  const prefix = OWN_PAGES.exec(here.name)?.[1];
  if (!prefix) return false;
  // The top bar's pop-ups: each portal has its own profile menu, notifications, branches and staff on duty.
  const popups = PORTAL_POPUPS[prefix];
  const nodeName = ctx.node?.n ?? "";
  const popup = (suffix: string) => (popups ? manifest.screens.find((s) => s.name === `${popups} / ${suffix}`) : undefined);
  if (/Button \/ Profile$/.test(nodeName) && popup("Profile")) {
    act.k = "ov";
    act.to = popup("Profile")!.id;
    return false;
  }
  if (/^PhModal \//.test(there.name) && popups) {
    const suffix = { "PhModal / Switch branch": "Switch branch", "PhModal / Pharmacist on duty": "On duty", "PhModal / Notifications": "Notifications" }[there.name];
    // The clinic admin's "Plan active" pill sits where the others show who is on duty.
    if (suffix === "On duty" && prefix === "ClinicAdmin web") {
      const plan = manifest.screens.find((s) => s.name === "ClinicAdmin web / Subscription");
      if (plan) {
        Object.assign(act, { k: "nav", to: plan.id });
        return false;
      }
    }
    const own = suffix ? popup(suffix) : undefined;
    if (own) {
      act.to = own.id;
      return false;
    }
  }
  if (there.module !== "pharmacy") return false;
  const label = (ctx.node?.n ?? "").split(" / ").pop()?.trim() ?? "";
  const own = label ? manifest.screens.find((s) => s.module === here.module && s.name === `${prefix} / ${label}`) : undefined;
  if (own && act.k === "nav") {
    act.to = own.id;
    return false;
  }
  // Name the page only when the button shows that name; a pill like "Plan active" reuses the "On duty" link.
  const shown = collectText(ctx.node).join(" ").trim();
  const named = label && shown.toLowerCase().startsWith(label.toLowerCase());
  say(`${named ? label : "This"} isn’t designed for the ${here.module} portal yet.`);
  return true;
}

export function intercept(act: Action, ctx: ActionContext): boolean {
  if (act.k === "fx") {
    runFx(act.fx, act.arg, ctx);
    return true;
  }
  if (keepInArea(act, ctx)) return true;
  if (act.k === "nav" && /^Patient web \/ Book appointment$/.test(screensById.get(act.to)?.name ?? "")) {
    // Rescheduling moves a booking that is already paid for; a new booking pays the fee.
    useLive.getState().setFilter("rebook", /Reschedul/i.test(collectText(ctx.node).join(" ")) ? "1" : "");
  }
  if (act.k === "nav" && /^Scan detail \//.test(screensById.get(act.to)?.name ?? "")) {
    // The chest X-ray belongs to both the heart and the lungs, so remember which one the doctor came from.
    const from = scanOrganOf(screenName(), useLive.getState().filters.scanOrgan);
    useLive.getState().setFilter("scanOrgan", from ?? "Heart");
  }
  if (act.k === "close" && collectText(ctx.node).join("") === "Message") say("Your question was sent to the clinic’s WhatsApp desk.");
  if (act.k === "nav" && checkStep(ctx)) return true;
  if (act.k === "nav" && !screensById.has(act.to) && !manifest.nodes.includes(act.to)) {
    say("This isn’t available yet.");
    return true;
  }
  if (act.k === "nav" && /Calendar open/.test(screensById.get(act.to)?.name ?? "")) {
    const name = screensById.get(act.to)!.name;
    // Every saved calendar state is one live calendar now, so they all open the same screen.
    if (!/Sahya/.test(name) && !/Sahya/.test(screenName())) {
      useLive.getState().showDate(TODAY);
      act.to = manifest.screens.find((s) => s.name === "Doctor view / Calendar open")!.id;
    }
    return false;
  }
  if (act.k !== "ov" && act.k !== "swap") return false;
  const dest = screensById.get(act.to)?.name ?? "";
  if (/^(PToast|PModal) \//.test(dest)) return patientAction(dest, ctx);
  if (dest === "Toast / download") {
    const label = collectText(ctx.node).join(" ");
    if (TABLE_REPORT.test(label)) {
      useLive.getState().openModal("format", { ctx });
      return true;
    }
    runExport("download", ctx, ctx.overlay === undefined && /^Download$/.test(label) ? rowOf(ctx.node) : undefined);
    return false;
  }
  if (dest === "Toast / print") {
    runExport("print", ctx);
    return false;
  }
  if (dest === "Toast / receipt") {
    const row = rowOf(ctx.node);
    if (row) void writeReceipt(row);
    return false;
  }
  if (dest === "Toast / bill collected") {
    useLive.getState().openModal("collect", {});
    return true;
  }
  if (dest === "Toast / measure") {
    useLive.getState().setFilter("measure", useLive.getState().filters.measure ? "" : "on");
    return false;
  }
  if (dest === "Toast / compare") {
    const table = screenDoc() && walkFind(screenDoc()!, (n) => n.tx?.v === "Compared with previous ECG");
    if (table) document.querySelector(`[data-nid="${table.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    return false;
  }
  if (dest === "Toast / demo patient") {
    const label = collectText(ctx.node).join(" ");
    if (/walk-in patient/i.test(label)) useLive.getState().openModal("walkin");
    else useLive.getState().openModal("patient", { text: label, row: collectText(rowOf(ctx.node) ?? ctx.node).join(" ") });
    return true;
  }
  if (dest === "Toast / dictate") {
    dictate();
    return true;
  }
  if (dest === "Toast / attach") {
    useLive.getState().openModal("attach");
    return true;
  }
  if (/^Toast \/ (allergy|event|order|rx|upload)$/.test(dest)) return !submitForm(dest, ctx);
  return false;
}

const RECORD_SCREENS = ["Patient web / Home", "Patient web / Appointments", "Patient web / Medicines", "Patient web / Lab tests", "Patient web / Reports & scans", "Patient web / Bills & payments", "Patient web / Records & sharing", "Patient web / Family"];

// "Download all my data" gathers the patient's own screens into one file.
async function downloadAllData() {
  const blocks = [];
  for (const name of RECORD_SCREENS) {
    const id = screenNamed(name);
    if (!id) continue;
    const doc = await load(id);
    if (doc) blocks.push(...blocksFrom(liveDoc(doc, name, useLive.getState())));
  }
  await writePdf("My AroNexa data", "James Heatfield - Male, 34 - ANX-78291", blocks);
}

let speaking = false;
let narration: HTMLAudioElement | null = null;

// Cards whose summary has a narrated recording, in the same voice as the explainer videos.
const NARRATED: [RegExp, string][] = [[/heart tracing \(ECG\)/, "/video/explain-heart-tracing-ecg.mp3"]];

// The recording for the card around a Listen button: the nearest enclosing card that names a narrated report.
// The Health hub video whose panel holds this button, if any.
function videoNear(node?: DesignNode) {
  const root = screenDoc();
  if (!node || !root) return undefined;
  const path: DesignNode[] = [];
  const walk = (n: DesignNode): boolean => {
    path.push(n);
    if (n.id === node.id || n.ch?.some(walk)) return true;
    path.pop();
    return false;
  };
  if (!walk(root)) return undefined;
  const titles = videoTitles();
  for (const box of [...path].reverse().slice(1, 6)) {
    const text = collectText(box);
    const title = titles.find((t) => text.includes(t));
    if (title) return title;
  }
  return undefined;
}

function narrationFor(node?: DesignNode) {
  const root = screenDoc();
  if (!node || !root) return undefined;
  const path: DesignNode[] = [];
  const walk = (n: DesignNode): boolean => {
    path.push(n);
    if (n.id === node.id || n.ch?.some(walk)) return true;
    path.pop();
    return false;
  };
  if (!walk(root)) return undefined;
  for (const card of [...path].reverse().slice(0, 4)) {
    const text = collectText(card).join(" ");
    const hit = NARRATED.find(([pattern]) => pattern.test(text));
    if (hit) return hit[1];
  }
  return undefined;
}

function readAloud(ctx: ActionContext) {
  if (narration && !narration.paused) {
    narration.pause();
    narration = null;
    return say("Stopped reading.");
  }
  const recording = narrationFor(ctx.node);
  if (recording) {
    narration = new Audio(recording);
    narration.onended = () => {
      narration = null;
    };
    void narration.play().catch(() => say("Press Listen again to play the summary."));
    toast("PToast / listen");
    return;
  }
  const speech = window.speechSynthesis;
  if (!speech) return say("This browser can’t read aloud.");
  if (speaking) {
    speech.cancel();
    speaking = false;
    return say("Stopped reading.");
  }
  const card = rowFor(ctx.node);
  const words = collectText(card).filter((t) => t.split(" ").length > 3).join(". ");
  const talk = new SpeechSynthesisUtterance(words || "Your doctor’s approved summary is on this page.");
  talk.onend = () => {
    speaking = false;
  };
  speaking = true;
  speech.speak(talk);
  toast("PToast / listen");
}

const screenId = (name: string) => screenNamed(name);

// Real behaviour behind the patient screens' pop-ups and messages. True stops the design's own action.
function patientAction(dest: string, ctx: ActionContext): boolean {
  const live = useLive.getState();
  const label = collectText(ctx.node).join(" ");
  const go = (name: string) => {
    useDesign.getState().closeOverlay(ctx.overlay);
    const id = screenId(name);
    if (id) gotoScreen(id);
    return true;
  };
  switch (dest) {
    case "PToast / download": {
      if (/all my data|എന്റെ എല്ലാ/.test(label)) {
        void downloadAllData();
        return false;
      }
      const onRow = ctx.overlay === undefined && /^(Receipt|View|Download bill|Download PDF)$/.test(label);
      runExport("download", ctx, onRow ? rowOf(ctx.node) : undefined);
      return false;
    }
    case "PToast / upload":
      pickFile(".pdf,.jpg,.jpeg,.png", (f) => {
        live.setFilter("uploads", `${live.filters.uploads ? `${live.filters.uploads}\n` : ""}${f.name}`);
        toast("PToast / upload");
      });
      return true;
    case "PToast / listen":
      readAloud(ctx);
      return true;
    case "PToast / ask":
      // The question is written first; the design's "Question sent" message follows.
      if (ctx.overlay === undefined) {
        const page = screenName().replace(/^Patient web \/ /, "");
        live.openModal("ask", { about: videoNear(ctx.node) ?? page });
        return true;
      }
      return false;
    case "PToast / share":
      void navigator.clipboard?.writeText(`${window.location.origin}/patient/patient-web-records-sharing`).catch(() => undefined);
      return false;
    case "PToast / stop": {
      const row = rowFor(ctx.node);
      if (row) live.hide(row.id);
      return false;
    }
    case "PToast / ok":
      if (label === "Mark taken" && ctx.node) {
        const text = walkFind(ctx.node, (n) => Boolean(n.tx));
        if (text) live.setText(text.id, "✓ Taken");
      }
      return false;
    case "PToast / cancelled": {
      const overlayName = screensById.get(useDesign.getState().overlays.find((o) => o.key === ctx.overlay)?.id ?? "")?.name ?? "";
      const row = /Leave rebook/.test(overlayName) ? "401:8958" : "401:8934";
      const line = row === "401:8958"
        ? "JAMES · FRI 23 MAY 11:00 AM|Follow-up · Dr. Arjun Mehta|Cancelled because the doctor is on leave · ₹20 refund on its way"
        : "MARY · TODAY 3:30 PM|Dr. Arjun Mehta · Thanal Heart Clinic|Cancelled by you · refund on its way";
      live.hide(row);
      if (!live.filters.cancelled?.includes(line)) live.setFilter("cancelled", `${live.filters.cancelled ? `${live.filters.cancelled}\n` : ""}${line}`);
      return false;
    }
    case "PToast / family added":
      live.setFilter("familyAdded", "1");
      return false;
    case "PModal / Booked": {
      const problem = slotProblem(live, live.filters.bookDay || "Thu 29", live.filters.bookSlot || "11:00");
      if (problem) return say(problem), true;
      const who = live.filters.bookFor || "James";
      live.setFilter("bookings", `${live.filters.bookings ? `${live.filters.bookings}\n` : ""}${bookingWhen(live)}|${who}`);
      return false;
    }
    case "PModal / Receipt TH-0518":
      if (/^Pay/.test(label)) {
        live.setFilter("billPaid", "1");
        // The clinic's billing screen shows the same payment.
        live.update({ collected: { ...live.collected, "T-04": "UPI" } });
      }
      return false;
    case "PToast / call":
      if (label === "Directions") {
        window.open("https://www.google.com/maps/search/?api=1&query=Thanal+Heart+Clinic+Kakkanad+Kochi", "_blank", "noopener");
        return true;
      }
      return false;
    case "PToast / demo":
      if (/^(Mary|Ella) Heatfield/.test(label)) {
        live.setFilter("profile", label.split(" ")[0]);
        return go("Patient web / Home");
      }
      if (label === "Book") {
        const card = collectText(rowFor(ctx.node)).join(" ");
        const person = /Mary Heatfield/.test(card) ? "Mary" : /Ella Heatfield/.test(card) ? "Ella" : "James";
        live.setFilter("bookFor", person);
        return go("Patient web / Book appointment");
      }
      if (label === "View clinic") return /Thanal/.test(collectText(rowOf(ctx.node)).join(" ")) ? go("Patient web / Clinic profile · Thanal Heart Clinic") : (say("Only Thanal Heart Clinic’s page is available."), true);
      if (label === "View profile") return go("Patient web / Doctor profile · Dr. Arjun Mehta");
      if (label === "Book a lab test") return go("Patient web / Lab tests");
      if (label === "Records") {
        const card = collectText(rowFor(ctx.node)).join(" ");
        const person = /Mary Heatfield/.test(card) ? "Mary" : /Ella Heatfield/.test(card) ? "Ella" : "";
        live.setFilter("profile", person);
        return go(person ? "Patient web / Home" : "Patient web / Records & sharing");
      }
      if (/^Upload/.test(label)) return patientAction("PToast / upload", ctx);
      return false;
    default:
      return false;
  }
}

const CARE_ROUTES: [RegExp, string][] = [
  [/general|physician|fever|cough/i, "Patient web / Find care · General physician"],
  [/child|paediat|pediat|baby/i, "Patient web / Find care · Children"],
  [/bone|joint|knee|ortho/i, "Patient web / Find care · Bones and joints"],
  [/skin|derma/i, "Patient web / Find care · Skin"],
  [/women|gynae|gyne/i, "Patient web / Find care · Women’s health"],
];

function careSearch() {
  const live = useLive.getState();
  const doc = screenDoc();
  const text = doc && walkFind(doc, (n) => /^(Search doctor|Cardiologist$)/.test(n.tx?.v ?? ""));
  const typed = text ? (useDesign.getState().values[text.id] ?? "").trim() : "";
  const route = CARE_ROUTES.find(([re]) => re.test(typed))?.[1];
  live.setFilter("careQuery", route ? "" : typed);
  const here = screenName();
  const target = route ?? "Patient web / Find care · results";
  if (here !== target) {
    const id = screenId(target);
    if (id) gotoScreen(id);
  }
  if (!typed) say("Showing every doctor near you. Type a name or speciality to narrow it.");
}

async function writeReceipt(row: DesignNode) {
  const t = collectText(row);
  await writePdf(
    `Receipt ${t[0] ?? ""}`,
    "Thanal Heart Clinic - Thursday, 15 May 2025",
    [
      {
        width: 600,
        pictures: [],
        rows: [
          ["Token", t[0]],
          ["Patient", t[1]],
          ["Services", t[2]],
          ["Amount paid", t[3]],
          ["Paid by", t[4]],
          ["Status", t[5]],
          ["Received by", "Dr. Arjun Mehta, Thanal Heart Clinic"],
        ].map(([k, v], i) => [
          { x: 0, y: i * 30, w: 180, text: k ?? "", size: 12, weight: 600 },
          { x: 200, y: i * 30, w: 380, text: v ?? "", size: 12, weight: 400 },
        ]),
      },
    ],
  );
}

type Recognition = { lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };
let listening: Recognition | null = null;

function dictate() {
  if (listening) {
    listening.stop();
    listening = null;
    say("Dictation stopped.");
    return;
  }
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const Engine = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Engine) return say("This browser has no speech recognition. Try Chrome, or type the note.");
  const rec = new Engine();
  rec.lang = "en-IN";
  rec.continuous = true;
  rec.interimResults = false;
  // Spoken words go into the box the doctor last clicked, or Symptoms if none.
  const target = useLive.getState().filters.lastField || "184:4644";
  const start = useDesign.getState().values[target] ?? "";
  rec.onresult = (e) => {
    const said = Array.from(e.results).map((r) => r[0].transcript).join(" ");
    useDesign.getState().setValue(target, `${start} ${said}`.trim());
  };
  rec.onerror = () => {
    say("The microphone isn’t available. Allow it in your browser, or type the note.");
    listening = null;
  };
  rec.onend = () => {
    listening = null;
  };
  rec.start();
  listening = rec;
  toast("Toast / dictate");
}

// The Add clinical note form starts from a template for the organ the doctor picks.
export const NOTE_FIELDS = ["184:4638", "184:4644", "184:4650", "184:4656", "184:4662"];
const NOTE_TEMPLATES: Record<string, string[]> = {
  Heart: ["Cardiology follow-up: palpitations", "Palpitations 2–3 times a week, a few seconds each. No chest pain or fainting.", "Heart rate 72, BP 128/78. Heart sounds normal.", "Likely harmless palpitations. ECG today is normal.", "24-hour Holter test on 22 May. Review results on 29 May."],
  Lungs: ["Lung review: breathing test follow-up", "Mild breathlessness on stairs. No cough or wheeze.", "Chest clear, SpO₂ 98%. Breathing test from January in normal range.", "Lungs healthy. Breathlessness likely from low fitness.", "Walk 30 minutes a day. Review in 3 months if not better."],
  Brain: ["Headache review", "Headaches 1–2 times a month, worse after poor sleep.", "Nerve checks normal. MRI from March 2024 normal.", "Tension-type headaches.", "Regular sleep, paracetamol when needed. Review if headaches get more frequent."],
  Liver: ["Liver check: ultrasound follow-up", "No pain. Mild tiredness.", "Abdomen soft, not tender. Liver tests in range.", "Mild fatty liver on ultrasound.", "Less sugar and fried food, more exercise. Repeat liver tests in 6 months."],
  Stomach: ["Reflux review", "Heartburn after late meals, 2–3 nights a week.", "Abdomen soft, mild upper tenderness. Breath test negative.", "Acid reflux, no infection.", "Omeprazole 20 mg before breakfast for 4 weeks. Eat 3 hours before bed."],
  Kidneys: ["Kidney check", "No swelling. No change in passing urine.", "BP 128/78. Creatinine and eGFR in range.", "Kidneys working normally.", "Drink 2–3 litres of water a day. Repeat kidney tests in 1 year."],
  Intestines: ["Bowel review", "Bloating now and then. No blood in stool.", "Abdomen soft, not tender. Stool test normal.", "Mild irritable bowel.", "More fibre and water. Review in 3 months."],
  Joints: ["Knee review: right knee", "Right knee pain after climbing stairs.", "Mild swelling, full movement. X-ray shows no fracture.", "Knee strain, healing well.", "Physiotherapy twice a week. Review in 4 weeks."],
  General: ["General review", "Feels well. No new complaints.", "BP 128/78, heart rate 72, temperature 36.7 °C.", "Healthy, no new problems.", "Annual check-up in 1 year."],
};

// The four starting points in "Note templates" on the clinical notes page.
const NOTE_STARTERS: Record<string, string[]> = {
  "Follow-up visit": NOTE_TEMPLATES.Heart,
  "New problem": ["New problem: ", "History: when it started, how often, what makes it better or worse.", "Examination findings.", "Most likely cause.", "Tests ordered and when to review."],
  "Result explained": ["Result explained: Resting ECG", "Asked what today’s ECG means.", "ECG normal. Heart rate 72, regular rhythm.", "Explained in simple words that the heart tracing is normal.", "Visit summary sent on WhatsApp. Holter test on 22 May as planned."],
  Referral: ["Referral: 24-hour Holter test", "Reason: palpitations 2–3 times a week.", "ECG today normal. Symptoms come and go.", "Needs a full day’s heart recording.", "Referred to Sahya Heart Care for a Holter test on 22 May. Urgency: routine."],
};

function runFx(name: string, arg: string | undefined, ctx: ActionContext) {
  const live = useLive.getState();
  switch (name) {
    case "say":
      return say(arg ?? "Done.");
    case "cart": {
      // Health store cart: add, change how many, remove, buy one thing now, or buy the whole cart.
      const [op, item, how] = (arg ?? "").split("|");
      const lines = readCart(live.filters.cart);
      const line = lines.find((l) => l.name === item);
      if (op === "add") {
        if (line) line.qty = Math.min(line.qty + 1, 5);
        else lines.push({ name: item, qty: 1 });
        live.setFilter("cart", writeCart(lines));
        return say(`${item} added to your cart.`);
      }
      if (op === "inc" && line) {
        if (line.qty >= 5) return say("You can buy up to 5 of each item.");
        line.qty += 1;
      }
      if (op === "dec" && line) {
        if (line.qty <= 1) return say("Use Delete to take it out of your cart.");
        line.qty -= 1;
      }
      if (op === "del") {
        live.setFilter("cart", writeCart(lines.filter((l) => l.name !== item)));
        return say(how === "saved" ? `${item} saved for later.` : `${item} removed from your cart.`);
      }
      if (op === "buy") return live.setFilter("buyNow", item);
      if (op === "all") return live.setFilter("buyNow", "");
      if (op === "order") {
        const bought = live.filters.buyNow ? [{ name: live.filters.buyNow, qty: 1 }] : lines;
        live.setFilter("lastOrder", writeCart(bought));
        // Buying the whole cart empties it; "Buy now" leaves the cart as it was.
        if (!live.filters.buyNow) live.setFilter("cart", "empty");
        return;
      }
      return live.setFilter("cart", writeCart(lines));
    }
    case "timeline": {
      // Start from what the page on screen shows, then change one of the two.
      const [kind, label] = (arg ?? "").split("|");
      const here = screenName();
      const code = /· (t:\w+)$/.exec(here)?.[1];
      let type = Object.entries(TIMELINE_TYPES).find(([, c]) => c === code)?.[0] ?? "";
      let organ = /· o:(\w+)$/.exec(here)?.[1] ?? (code ? (live.filters.tlOrgan ?? "All") : "All");
      if (kind === "type") type = label;
      else organ = label;
      live.setFilter("tlType", type);
      live.setFilter("tlOrgan", organ);
      const to = timelineScreen(type, organ);
      if (to) goTo(to, { t: "d", ms: 150 });
      return;
    }
    case "noteTemplate": {
      const template = NOTE_STARTERS[arg ?? ""];
      if (template) NOTE_FIELDS.forEach((id, i) => useDesign.getState().setValue(id, template[i]));
      return;
    }
    case "pickOne": {
      // One chip of a set is on: "chosen|id,id,…|on variant|off variant".
      const [chosen, ids, on, off] = (arg ?? "").split("|");
      const design = useDesign.getState();
      ids.split(",").forEach((id) => design.setVariant(id, id === chosen ? on : off));
      const organ = ctx.node ? collectText(ctx.node).join("").trim() : "";
      const template = NOTE_TEMPLATES[organ];
      if (template) NOTE_FIELDS.forEach((id, i) => design.setValue(id, template[i]));
      return;
    }
    case "photo":
      return pickFile("image/png,image/jpeg", (f) => {
        const reader = new FileReader();
        reader.onload = () => {
          useLive.getState().update({ photo: String(reader.result) });
          say("Profile photo updated.");
        };
        reader.readAsDataURL(f);
      });
    case "password":
      return live.openModal("password");
    case "devices":
      return live.openModal("devices");
    case "selfie":
      return live.openModal("selfie", { nodeId: ctx.node?.id });
    case "verify":
      say("Checking the council register…");
      window.setTimeout(() => {
        live.setText("verify:done", "1");
        say("Registration 45219 still has no match. Fix the number in Profile, then verify again.");
      }, 900);
      return;
    case "findClinic":
      return live.openModal("findClinic");
    case "addClinicByHand": {
      const id = manifest.screens.find((s) => s.name === "Modal / add clinic")?.id;
      if (id) void load(id).then(() => useDesign.getState().openOverlay(id));
      return;
    }
    case "locate":
      if (!navigator.geolocation) return say("This browser can’t share a location.");
      say("Finding your location…");
      navigator.geolocation.getCurrentPosition(
        (p) => {
          const text = `Pin set · ${p.coords.latitude.toFixed(4)}° N, ${p.coords.longitude.toFixed(4)}° E`;
          useLive.getState().setText("370:6808", text);
          useLive.getState().setFilter("pin", `${p.coords.latitude},${p.coords.longitude}`);
          say("Pin moved to your current location.");
        },
        () => say("Location access was blocked. Allow it in your browser, or use Move pin."),
      );
      return;
    case "movePin":
      return live.openModal("pin");
    case "maps": {
      const pin = live.filters.pin || "10.1076,76.3516";
      window.open(`https://www.google.com/maps?q=${encodeURIComponent(pin)}`, "_blank", "noopener");
      return;
    }
    case "addInsurer":
      return live.openModal("value", { title: "Add insurer or TPA", label: "Company name", apply: "insurer" });
    case "removeRow": {
      const row = rowFor(ctx.node);
      if (row) live.openModal("confirm", { title: `Remove ${collectText(row)[0] ?? "this item"}?`, hide: row.id });
      return;
    }
    case "reveal": {
      const key = "reveal";
      live.setFilter(key, live.filters[key] ? "" : "1");
      return;
    }
    case "segment":
      return live.update({ billingRange: (arg ?? "today") as "today" | "week" | "month" });
    case "openPatient": {
      useDesign.getState().closeOverlay(ctx.overlay);
      if (arg === "James Heatfield") {
        const id = screenNamed("Patient / Overview");
        if (id) gotoScreen(id);
      } else {
        live.openModal("patient", { name: arg, text: arg });
      }
      return;
    }
    case "mainLocation":
      live.setText("286:6648", "Other clinic");
      live.setText("286:6678", "Main location");
      return say("Sahya Heart Care is now your main location.");
    case "goto": {
      const id = manifest.screens.find((s) => s.name === arg)?.id;
      if (id) gotoScreen(id);
      return;
    }
    case "editClinic":
      return live.openModal("value", { title: "Edit clinic", label: "Clinic hours", value: "Mon to Sat · 9:00 AM to 4:30 PM", apply: "say" });
    case "changeSetting":
      return changeSetting(arg ?? "generic", ctx);
    case "closeCalendar": {
      const home = manifest.screens.find((s) => s.name === arg)?.id;
      if (home) gotoScreen(calendarReturn(home));
      return;
    }
    case "calendarDay":
      if (arg) {
        live.showDate(arg);
        const id = manifest.screens.find((s) => s.name === "Doctor view / Calendar open")?.id;
        if (id) gotoScreen(id);
      }
      return;
    case "scrollTo":
      if (arg) document.querySelector(`[data-nid="${arg}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    case "openDoc": {
      const d = live.docs.find((x) => x.id === arg);
      if (d?.url) window.open(d.url, "_blank", "noopener");
      else say("This file was added before the page reloaded, so it’s no longer available.");
      return;
    }
    case "pickUpload":
      return pickFile(".pdf,.jpg,.jpeg,.png", acceptUpload);
    case "edit": {
      // Opens a text in the design for editing: "nodeId|title|label|original text".
      const [id, title, field, original] = (arg ?? "").split("|");
      return live.openModal("value", { title, label: field, value: live.texts[id] ?? original, nodeId: id });
    }
    case "questions":
      return live.openModal("questions");
    case "reel":
      return live.openModal("reel", JSON.parse(arg ?? "{}") as Record<string, unknown>);
    case "share":
      void navigator.clipboard?.writeText(window.location.href).catch(() => undefined);
      return say(arg ?? "Link copied.");
    case "useRx":
      useDesign.getState().setValue("188:4551", arg ?? "");
      return;
    case "check": {
      const [id, initial] = (arg ?? "").split("|");
      return live.toggleCheck(id, initial === "1");
    }
    case "chip": {
      const [id, initial] = (arg ?? "").split("|");
      return live.toggleCheck(id, initial === "1");
    }
    case "chipOne": {
      const [key, value] = (arg ?? "").split("|");
      return live.setFilter(key, value);
    }
    case "pick": {
      const [key, value, mode, designed] = (arg ?? "").split("|");
      if (mode !== "many") return live.setFilter(key, value);
      const start = key in live.filters ? live.filters[key].split("\n").filter(Boolean) : (designed ?? "").split("\t").filter(Boolean);
      const none = /^None/.test(value);
      const kept = start.filter((v) => (none ? false : !/^None/.test(v)));
      return live.setFilter(key, (start.includes(value) ? kept.filter((v) => v !== value) : [...kept, value]).join("\n"));
    }
    case "addOther":
      return live.openModal("value", { title: "Add other", label: "Name", value: "", nodeId: arg });
    case "viewDoctor":
      if (/Arjun Mehta/.test(arg ?? "")) {
        const id = screenNamed("Patient web / Doctor profile · Dr. Arjun Mehta");
        if (id) gotoScreen(id);
        return;
      }
      return say("Only Dr. Arjun Mehta’s profile is available.");
    case "careSearch":
      return careSearch();
    case "careClear": {
      Object.keys(live.filters).filter((k) => k.startsWith("care")).forEach((k) => live.setFilter(k, ""));
      const { over, setVariant } = useDesign.getState();
      const doc = screenDoc();
      Object.keys(over).forEach((id) => {
        const design = doc && walkFind(doc, (n) => n.id === id);
        if (design?.cid === "449:11693" || design?.cid === "449:11695") setVariant(id, design.cid);
      });
      return say("Filters cleared.");
    }
    case "saveClinic": {
      const doc = overlayDoc(ctx);
      const name = doc ? formValue("288:6494", doc) || formValue("356:6532", doc) : "";
      if (doc && doc.id === "288:6467" && !name) return say("Enter the clinic’s name first.");
      const address = (doc && formValue("288:6501", doc)) || "Address to be confirmed";
      const list = live.filters.clinics ? `${live.filters.clinics}\n` : "";
      live.setFilter("clinics", `${list}${name}|${address}`);
      useDesign.getState().closeOverlay(ctx.overlay);
      return say(/^Register/.test(screenName()) ? `${name} added. It is verified after you submit.` : "Clinic added to My clinics.");
    }
    default:
      return;
  }
}

export const gotoScreen = (id: string) => goTo(id);

function rowFor(node?: DesignNode) {
  const root = useDesign.getState().overlays.length
    ? loaded.get(useDesign.getState().overlays[useDesign.getState().overlays.length - 1].id)
    : screenDoc();
  if (!node || !root) return undefined;
  let found: DesignNode | undefined;
  const walk = (n: DesignNode, path: DesignNode[]): boolean => {
    if (n.id === node.id) {
      // The whole card, not an inner row, so removing it leaves no empty shell.
      found = path.filter((p) => p.w >= 300 && p.h >= 56 && p.h <= 220).pop();
      const inner = [...path].reverse().find((p) => p.w >= 300 && p.h >= 56);
      if (inner && inner.h <= 220) {
        let i = path.indexOf(inner);
        while (i > 0 && path[i - 1].h <= 220 && path[i - 1].w >= 300) i--;
        found = path[i];
      }
      return true;
    }
    return (n.ch ?? []).some((c) => walk(c, [...path, n]));
  };
  walk(root, []);
  return found;
}

function changeSetting(kind: string, ctx: ActionContext) {
  const live = useLive.getState();
  const texts = collectText(ctx.parent);
  const sibling = ctx.parent?.ch?.filter((c) => c.t === "T") ?? [];
  // The value is the second text of the row: label, value, then the Change link.
  const valueNode = sibling[1];
  if (kind === "password") return live.openModal("password");
  if (kind === "appLanguage") {
    return live.openModal("choice", { title: "App language", options: ["English", "മലയാളം"], nodeId: valueNode?.id, value: texts[1] });
  }
  if (kind === "theme") {
    return live.openModal("choice", { title: "Theme", options: ["Light", "Dark"], nodeId: valueNode?.id, value: live.theme, apply: "theme" });
  }
  const titles: Record<string, string> = { mobile: "Change mobile number", email: "Change email", languages: "Languages you consult in" };
  const rule: Record<string, string> = { mobile: "phone", email: "email" };
  live.openModal("value", { title: titles[kind] ?? `Change ${texts[0] ?? "value"}`, label: texts[0] ?? "Value", value: live.texts[valueNode?.id ?? ""] ?? texts[1] ?? "", nodeId: valueNode?.id, rule: rule[kind] });
}

