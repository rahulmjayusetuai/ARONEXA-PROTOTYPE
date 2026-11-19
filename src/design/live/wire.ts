import rawManifest from "../manifest.json";
import type { Action, DesignNode } from "../types";

// The design left these controls unwired. Labels are matched, so regenerated screens keep working.
const fx = (name: string, arg?: string): Action => ({ k: "fx", fx: name, arg });

const BY_LABEL: Record<string, Action> = {
  "Upload photo": fx("photo"),
  "Change photo": fx("photo"),
  "Change password": fx("password"),
  Manage: fx("devices"),
  "Take selfie": fx("selfie"),
  "സെൽഫി എടുക്കുക": fx("selfie"),
  "Save availability": fx("say", "Availability saved. Patients now book from these hours."),
  "Make main location": fx("mainLocation"),
  "Verify now": fx("verify"),
  "Find clinic": fx("findClinic"),
  "ക്ലിനിക് കണ്ടെത്തുക": fx("findClinic"),
  "+  Add a clinic without HFR ID": fx("addClinicByHand"),
  "+  HFR ഐഡി ഇല്ലാതെ ക്ലിനിക് ചേർക്കുക": fx("addClinicByHand"),
  "📍 Use my current location": fx("locate"),
  "Move pin": fx("movePin"),
  "Open in Google Maps": fx("maps"),
  "+  Add insurer or TPA": fx("addInsurer"),
  Remove: fx("removeRow"),
  Home: fx("goto", "Doctor home (landing)"),
  "Save doctor details": fx("say", "Press Edit profile first. This page is view only."),
  Show: fx("reveal"),
  Hide: fx("reveal"),
  Today: fx("segment", "today"),
  "This week": fx("segment", "week"),
  "This month": fx("segment", "month"),
};

const HAS_ACTION = (n: DesignNode) => n.a?.some((i) => i.on === "click");

const attach = (n: DesignNode, parent: DesignNode | undefined, act: Action) => {
  const pill = parent && parent.t !== "T" && parent.w <= 320 && parent.h <= 60 && (parent.ch?.length ?? 0) <= 2 && !HAS_ACTION(parent) && (parent.p?.length || parent.k);
  const target = pill ? parent : n;
  if (HAS_ACTION(target)) return;
  target.a = [...(target.a ?? []), { on: "click", acts: [act] }];
};

const SECTION_CHANGE: Record<string, string> = {
  Mobile: "mobile",
  Email: "email",
  "Languages you consult in": "languages",
  "App language": "appLanguage",
  Theme: "theme",
  Password: "password",
};

const REGISTER_EDIT = ["Register / 1 Account", "Register / 2b Registration verified", "Register / 2b Registration verified", "Register / 3 Clinic locations"];

// Wording in the design that a resync would otherwise bring back.
const REWORD: Record<string, string> = {
  "In the demo, press Sign in to continue.": "Press Sign in to continue.",
  "Only James’s record is in this demo": "Only James’s record is available",
  "✓  Demo shows James’s record": "✓  Showing James’s record",
  "Prototype: these checks are simulated. In production, connect them to the council / Indian Medical Register lookup and the ABDM HPR API. Changing your registration number, council or HPR ID sets the check back to Pending.":
    "Changing your registration number, council or HPR ID sets the check back to Pending.",
};

const ADD_CLINIC_SAMPLE: Record<string, string> = {
  "IN32 1000 ...": "IN3210045678",
  "e.g. Lakeshore Hospital": "Lakeshore Hospital",
  "Building, street, area, city, PIN code": "NH 66, Maradu, Kochi, Ernakulam 682304",
  "e.g. OPD 2, Room 11": "OPD 2, Room 11",
};

function reword(n: DesignNode) {
  const text = n.tx && REWORD[n.tx.v];
  if (n.tx && text) n.tx = { ...n.tx, v: text };
  n.ch?.forEach(reword);
}

// Adds the missing clicks to a screen, pop-up or component state when it loads.
export function wire(doc: DesignNode, screenName: string) {
  reword(doc);
  fillGaps(doc, screenName);
  // Patient screens have their own controls, which share labels with the doctor's. See patient.ts.
  // The other areas are wired by their own prototype links only.
  if (/^(Patient web|Patient mobile|PModal|PToast|Patient sign up|Login · (Patient|Pharmacy|Clinic staff|Lab|AroNexa team|Insurer|Dealer|Seller)|Pharmacy (web|register)|Lab register|Clinic invite|Ph(Modal|Toast)|Reception web|Rc(Modal|Toast)|ClinicAdmin web|Ca(Modal|Toast)|Lab web|Lb(Modal|Toast)|Pathologist web|Pa(Modal|Toast)|Rider|Platform web|Pl(Modal|Toast)|Support web|Sp(Modal|Toast)|(Insurer|Dealer|Seller) web|(In|Dl|Sl)(Modal|Toast))/.test(screenName)) return doc;
  let reviewEdit = 0;
  const walk = (n: DesignNode, parent?: DesignNode, inClick = false) => {
    // "Today's patients" filters in place, so this box is a real search field and not a pop-up link.
    if (n.n === "Search" && n.ch?.some((c) => c.tx?.v === "Search by name, phone or ID")) n.a = undefined;
    // The add-clinic form starts filled with a sample clinic, so it can be saved straight away.
    const sample = n.t === "T" && n.n === "Value" && parent?.n === "Input" ? ADD_CLINIC_SAMPLE[n.tx?.v ?? ""] : undefined;
    if (sample && n.tx) n.tx = { ...n.tx, v: sample };
    const clicks = inClick || Boolean(HAS_ACTION(n));
    if (n.t === "T" && !clicks) {
      const v = n.tx?.v.trim() ?? "";
      // Availability hours are drawn as plain boxes, so they become time fields.
      if (/^\d{2}:\d{2} (AM|PM)$/.test(v) && parent && parent.w <= 110 && parent.h <= 50 && parent.n !== "Input") {
        parent.n = "Input";
        n.n = "Value";
        return;
      }
      if (v === "Show" && n.n !== "Action") {
        // The heading of a filter panel, not a password control.
      } else if (v === "Today" && !/calendar|billing/i.test(screenName)) {
        // A "Today" status label rather than a control.
      } else if ((v === "This month" || v === "This week") && !(parent && parent.h <= 40 && parent.w <= 110)) {
        // A stat heading.
      } else if (v === "Remove" && n.tx?.d !== "UNDERLINE" && !/settings|clinic/i.test(screenName)) {
        // Not a row action here.
      } else if (BY_LABEL[v]) {
        attach(n, parent, BY_LABEL[v]);
      } else if (v === "Change" || v === "Edit" || v === "മാറ്റുക") {
        const row = parent?.ch?.filter((c) => c.t === "T").map((c) => c.tx?.v ?? "") ?? [];
        if (/^Register \/ 4/.test(screenName)) {
          const step = REGISTER_EDIT[reviewEdit++] ?? REGISTER_EDIT[0];
          const ml = `${step} (Malayalam)`;
          attach(n, parent, { k: "fx", fx: "goto", arg: screenName.endsWith("(Malayalam)") && SCREEN_ID.has(ml) ? ml : step });
        } else if (/^Register \/ 3/.test(screenName)) {
          attach(n, parent, fx("editClinic"));
        } else {
          attach(n, parent, fx("changeSetting", SECTION_CHANGE[row.find((t) => SECTION_CHANGE[t]) ?? ""] ?? "generic"));
        }
      }
    }
    n.ch?.forEach((c) => walk(c, n, clicks));
  };
  walk(doc);
  wireHistory(doc);
  relabelToasts(doc, screenName);
  return doc;
}

// Older entries in "Report history" show what that report found.
function wireHistory(doc: DesignNode) {
  const text = (n: DesignNode, out: string[] = []) => {
    if (n.tx) out.push(n.tx.v);
    n.ch?.forEach((c) => text(c, out));
    return out;
  };
  const walk = (n: DesignNode) => {
    if (n.ch?.some((c) => c.tx?.v === "Report history")) {
      n.ch.forEach((row) => {
        const parts = text(row);
        if (row.tx || parts.length < 2 || parts.some((p) => p.includes("this report")) || HAS_ACTION(row)) return;
        row.a = [{ on: "click", acts: [fx("say", parts.join(" · "))] }];
      });
      return;
    }
    n.ch?.forEach(walk);
  };
  walk(doc);
}

// Toasts that promised something the demo did not do now describe what really happens.
const TOAST_TEXT: Record<string, Record<string, string>> = {
  "Toast / allergy": { "It now shows as a warning on every screen and when prescribing.": "Added to James’s allergies. New prescriptions are checked against it." },
  "Toast / print": { "Sent to printer": "Print window opened", "Printing on the OPD reception printer.": "Choose a printer in your browser’s print window." },
  "Toast / receipt": { "Receipt printed": "Receipt downloaded", "A copy was also sent to the patient on WhatsApp.": "The PDF is in your Downloads folder." },
  "Toast / compare": { "No significant change. See the comparison table below the ECG.": "No significant change. Scrolled to the comparison table." },
};

function relabelToasts(doc: DesignNode, screenName: string) {
  const map = TOAST_TEXT[screenName];
  if (!map) return;
  const walk = (n: DesignNode) => {
    if (n.tx && map[n.tx.v]) n.tx = { ...n.tx, v: map[n.tx.v] };
    n.ch?.forEach(walk);
  };
  walk(doc);
}

// Controls the design drew but never linked. Matched by layer name, on every screen, and only when nothing is linked yet.
const SCREEN_ID = new Map(rawManifest.screens.map((x) => [x.name, x.id]));
const overlay = (name: string): Action | undefined => {
  const to = SCREEN_ID.get(name);
  return to ? { k: "ov", to } : undefined;
};
const goto = (name: string) => fx("goto", name);

const PATIENT_TABS: Record<string, string> = {
  "PTab / Home": "Patient web / Home",
  "PTab / Health hub": "Patient web / Health hub",
  "PTab / Health store": "Patient web / Health store",
  "PTab / Reports & scans": "Patient web / Reports & scans",
};

const BY_NAME: [RegExp, (n: DesignNode, screen: string) => Action | undefined][] = [
  // Navigation tabs that lost their link; the tab for the page you are on stays as it is.
  [/^PTab \//, (n, screen) => (PATIENT_TABS[n.n ?? ""] && PATIENT_TABS[n.n ?? ""] !== screen ? goto(PATIENT_TABS[n.n ?? ""]) : undefined)],
  [/^Tab \/ Body map$/, (_, screen) => (screen.startsWith("Doctor view /") ? goto("Doctor view / Body map – Heart") : undefined)],
  // Sign-in pages
  [/^Link \/ Forgot password/, () => fx("say", "We’ve sent a link to reset your password to your registered mobile and email.")],
  [/^Link \/ Register pharmacy$/, (_, screen) =>
    /AroNexa team/.test(screen) ? fx("say", "Your team lead adds you from Team settings. You’ll get an invite by email.")
    : /Login · (Insurer|Dealer|Seller)/.test(screen) ? fx("say", "Thanks for your interest. Our partner team will call you within 2 working days to set up your account.")
    : undefined],
  // Pharmacy counter, reports and requests
  [/^Button \/ Save and print$/, () => overlay("PhModal / Bill saved")],
  [/^Button \/ New bill$/, () => fx("say", "This is a new bill. Scan or search a medicine to add it.")],
  [/^Button \/ Apply range$/, () => fx("say", "Range applied. The report now covers the dates you chose.")],
  [/^Button \/ View quote (RQ-\d+)$/, (n) => fx("say", `Quote ${n.n?.split(" ").pop()} was sent to the patient. We’ll tell you when they choose a pharmacy.`)],
  [/^Button \/ View (RQ-\d+)$/, (n, screen) => fx("say", /Rejected/.test(screen)
    ? `You rejected ${n.n?.split(" ").pop()}. The patient was told and asked other pharmacies.`
    : `For ${n.n?.split(" ").pop()}, the patient chose another pharmacy. No action is needed.`)],
  // Patient pages
  [/^Button \/ View profile (.+)$/, (n) => fx("say", `Dr. ${n.n?.replace("Button / View profile ", "")}: full profile coming soon. You can book from this card.`)],
  [/^Link \/ Other patients’ names are hidden$/, () => fx("say", "For privacy, the queue shows only token numbers for other patients.")],
  [/^Button \/ Not available$/, () => fx("say", "This lab doesn’t offer this test. Choose another lab.")],
  [/^Link \/ \+ Add$/, (_, screen) => (/Bills/.test(screen) ? fx("say", "You can add a card or UPI ID the next time you pay a bill.") : undefined)],
  [/^Action \/ Ask doctor$/, () => overlay("PToast / ask")],
  [/^Action \/ Save$/, () => fx("say", "Saved to your videos.")],
  [/^Action \/ Share$/, () => fx("share", "Link to this video copied.")],
  [/^Action \/ Report$/, () => fx("say", "Thanks for telling us. Our team will review this video.")],
  // Call pop-up
  [/^Button \/ Mute$/, () => fx("say", "You’re muted. The clinic can’t hear you.")],
  [/^Button \/ Speaker$/, () => fx("say", "Speaker on.")],
  [/^Button \/ Keypad$/, () => fx("say", "The clinic answers directly, so you don’t need the keypad.")],
];

function fillGaps(doc: DesignNode, screenName: string) {
  const walk = (n: DesignNode, inClick: boolean) => {
    const clicks = inClick || Boolean(HAS_ACTION(n));
    if (!clicks && n.n) {
      const rule = BY_NAME.find(([re]) => re.test(n.n ?? ""));
      const act = rule?.[1](n, screenName);
      if (act) n.a = [...(n.a ?? []), { on: "click", acts: [act] }];
    }
    n.ch?.forEach((c) => walk(c, clicks || Boolean(HAS_ACTION(n))));
  };
  walk(doc, false);
}
