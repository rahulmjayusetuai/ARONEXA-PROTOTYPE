"use client";

import { useEffect, useState } from "react";
import { Dialog } from "./Modals";
import { playLeave } from "./motion";

type Step = { title: string; intro?: string; points: string[] };

const DOCTOR: Step[] = [
  {
    title: "Welcome to AroNexa",
    intro: "AroNexa brings each patient’s full health story into one place and helps you explain it in their own language.",
    points: ["This tour walks through every part of the doctor’s side.", "Press Next to continue, or Skip to start right away."],
  },
  {
    title: "Your home page",
    intro: "Everything for today, in one view.",
    points: [
      "The top cards count Patients today, Reports to explain, Results pending and Messages.",
      "Today’s patients lists each token, time, reason and status, with a search box.",
      "Needs your attention picks out the results to look at first.",
      "Add walk-in patient puts someone new on today’s list.",
    ],
  },
  {
    title: "My calendar",
    intro: "Press My calendar at the top of any page. It opens over the page you’re on.",
    points: [
      "Pick a day to see who is booked and when.",
      "Block time closes part of a day for bookings.",
      "Mark as leave takes a day off, and the booked patients are asked to pick a new time.",
    ],
  },
  {
    title: "A patient’s record",
    intro: "Press Open record on a patient, such as James Heatfield.",
    points: [
      "Overview shows today’s visit, vitals against the last reading, active problems and current medicines.",
      "The tabs across the top lead to each part of the record.",
      "Allergies stay visible at the top of the record, so they aren’t missed.",
    ],
  },
  {
    title: "Body map",
    intro: "See a patient’s records by part of the body.",
    points: [
      "Tap an organ, or pick one from the list, to see its records.",
      "Colours show whether an organ is stable, needs monitoring or needs attention.",
      "The number on each organ is how many records it has.",
    ],
  },
  {
    title: "Scans and reports",
    intro: "Every scan and report, with filters by organ and status.",
    points: [
      "Open a scan to compare old and new, either Side by side or with the Slider overlay.",
      "A table sets out what has changed between the two dates.",
      "Upload report adds a new one, and Order scan requests one.",
    ],
  },
  {
    title: "Explain to patient",
    intro: "Press Explain to patient on a scan to turn your screen into a simple view for the patient.",
    points: [
      "Switch between English and മലയാളം.",
      "Drag across the image to show the change from before to now.",
      "Send a visit summary by WhatsApp or in the AroNexa app.",
      "A 30-second explainer video is made from your summary. You watch and approve it before it’s sent.",
    ],
  },
  {
    title: "Timeline and clinical notes",
    intro: "The patient’s history and your own notes.",
    points: [
      "Timeline puts visits, scans, tests, medicines and emergencies in date order. Filter it by type or organ.",
      "Add event and Download timeline are at the top of the page.",
      "Clinical notes follow one layout: symptoms, examination, assessment and plan.",
      "Add clinical note starts a new one for the visit.",
    ],
  },
  {
    title: "Medicines and allergies",
    intro: "Prescribing is checked against what you already know about the patient.",
    points: [
      "Prescribe medicine checks each choice against allergies and current medicines.",
      "A medicine the patient is allergic to is blocked, and a safer one is suggested.",
      "The Allergies tab holds each reaction, with Add allergy and Print allergy card.",
    ],
  },
  {
    title: "Lab results and documents",
    intro: "Test results and paperwork, sorted for you.",
    points: [
      "Lab results show each value with its normal range, previous result and trend.",
      "Only out of range filters down to what needs a look. Order lab test requests a new one.",
      "Documents sorts prescriptions, referral letters, certificates and more into folders.",
      "Upload document, or drag files onto the page, to add to the record.",
    ],
  },
  {
    title: "Billing",
    intro: "Press Open billing on your home page.",
    points: [
      "See money collected, pending and expected for Today, This week or This month.",
      "Collect records a payment, and Receipt gives you a receipt for it.",
      "Download statement and Print day report are for your accounts.",
      "Billing settings hold your fees and receipts, and turn on cashless insurance.",
    ],
  },
  {
    title: "Settings, clinics and alerts",
    intro: "Your own details and where you work.",
    points: [
      "Doctor settings has your Profile, Verification with the medical council and HPR, and Clinics and availability.",
      "Your availability sets the times patients can book.",
      "Your name at the top right opens a menu to switch clinic or Sign out.",
      "The bell shows new reports and messages.",
    ],
  },
  {
    title: "You’re ready to start",
    points: [
      "To see the patient’s side, choose Sign out in the menu at the top right, then pick the Patient tab.",
      "You’ll get a tour of that side the first time you enter it.",
    ],
  },
];

const PATIENT: Step[] = [
  {
    title: "Welcome to AroNexa",
    intro: "Your health, explained by your doctor, with your reports, medicines and appointments in one place.",
    points: ["This tour walks through every part of the patient’s side.", "Press Next to continue, or Skip to start right away."],
  },
  {
    title: "Your home page",
    intro: "What matters today comes first.",
    points: [
      "Your live token shows who is being seen now and how long your wait is.",
      "Upcoming lists your next appointments.",
      "Find a doctor or clinic lets you search from here.",
      "James (me), Mary and Ella switch between the family profiles you manage.",
    ],
  },
  {
    title: "Find care and book",
    intro: "Find the right doctor, then choose a time.",
    points: [
      "Search by doctor, speciality, clinic or hospital, then filter by day, distance, language and fee.",
      "Not sure who to see? Choose your symptoms and you’re matched to the right kind of doctor.",
      "Book appointment shows only real open times, for you or a family member.",
    ],
  },
  {
    title: "Live queue",
    intro: "Wait at home, not in the clinic. Open it from the Queue tab.",
    points: [
      "See your token, the token being served, your expected turn and when to leave home.",
      "I’m on the way lets the clinic know you’re coming.",
      "Check in (QR) marks your arrival at reception.",
      "Running late? tells the clinic, so they can keep your place.",
    ],
  },
  {
    title: "Appointments",
    intro: "Every visit for you and your family.",
    points: [
      "Switch between Upcoming, Past and Cancelled.",
      "If a doctor moves a visit you’ll see why, and can use Review change or Rebook.",
      "If a doctor blocks time or takes leave, you can pick a new time or get a full refund.",
    ],
  },
  {
    title: "My body",
    intro: "Your health records, on a map of your body.",
    points: [
      "Tap an organ, or pick one from the list, to see its reports.",
      "Colours show what’s stable, what’s being monitored and what needs attention.",
      "Your vitals, allergies and timeline sit alongside the map.",
    ],
  },
  {
    title: "Reports and scans",
    intro: "Your reports, explained by your doctor.",
    points: [
      "Open a report to read what the doctor found and what happens next, in English or മലയാളം.",
      "Drag across the image to compare before and now.",
      "Upload an outside report adds one from elsewhere. Book a lab test arranges a new one.",
    ],
  },
  {
    title: "Medicines",
    intro: "Everything your doctors prescribed, checked against your allergies.",
    points: [
      "See what to take, how often and until when.",
      "Order medicines from your usual pharmacy, or use Compare prices to find the best quote.",
      "Track your order through to delivery.",
      "Upload a prescription adds one from another doctor.",
    ],
  },
  {
    title: "Lab tests",
    intro: "Tests your doctor asked for, and tests you book yourself.",
    points: [
      "Asked by your doctor lists what you still need to book.",
      "Compare labs and prices, then choose Home collection or Visit the lab.",
      "Follow each test from sample to published report.",
      "Book a test myself is there for anything else you need.",
    ],
  },
  {
    title: "Bills",
    intro: "Clinic bills, medicines, lab tests and refunds, for you and your family.",
    points: [
      "View bill and pay what’s due from the top of the page.",
      "Download a receipt for any payment.",
      "Follow refunds on their way back to you.",
      "Download yearly statement gives you the full year.",
    ],
  },
  {
    title: "Records and sharing",
    intro: "Your whole health story, and who can see it.",
    points: [
      "The Health timeline shows your visits, tests and outside documents.",
      "Who can see my records lists each doctor, pharmacy and lab, and until when.",
      "Stop sharing ends anyone’s access.",
      "Share my health summary and Upload an outside document are at the top of the page.",
    ],
  },
  {
    title: "Family",
    intro: "Manage the people you look after. They don’t need their own login.",
    points: [
      "Add a family member to create a profile for them.",
      "Records and Book work for each person.",
      "Family tokens show together on the Queue tab.",
    ],
  },
  {
    title: "Emergency and settings",
    intro: "Help when you need it, and control of your account.",
    points: [
      "The Emergency button at the top shows the 108 ambulance and nearby help, with your blood group and allergy.",
      "Your name at the top right opens your health profile, language and notifications.",
      "Settings also covers privacy, payments and help.",
    ],
  },
  {
    title: "You’re ready to start",
    points: [
      "To see the doctor’s side, choose Sign out in the menu at the top right, then pick the Doctor tab.",
      "You’ll get a tour of that side the first time you enter it.",
    ],
  },
];

const SHOW_AFTER_MS = 600;

type Area = "doctor" | "patient";
const keyFor = (area: Area) => `aronexa-tour-seen-${area}`;

function seenBefore(area: Area) {
  try {
    return window.localStorage.getItem(keyFor(area)) === "1";
  } catch {
    return false;
  }
}

function remember(area: Area) {
  try {
    window.localStorage.setItem(keyFor(area), "1");
  } catch {
    // Blocked storage only means the guide shows again next visit.
  }
}

// Shown the first time a browser gets past sign-in on each side, doctor and patient.
export function Guide({ area, entered }: { area: Area; entered: boolean }) {
  const [step, setStep] = useState<number | null>(null);
  const steps = area === "patient" ? PATIENT : DOCTOR;

  useEffect(() => {
    if (!entered) return;
    // Lets the first page settle, so the guide arrives over a finished screen.
    const timer = window.setTimeout(() => {
      if (!seenBefore(area)) setStep(0);
    }, SHOW_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [area, entered]);

  const open = step !== null;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      remember(area);
      playLeave(".lv-guide");
      setStep(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, area]);

  if (step === null) return null;
  const finish = () => {
    remember(area);
    playLeave(".lv-guide");
    setStep(null);
  };
  const current = steps[step];
  const last = step === steps.length - 1;
  return (
    <Dialog
      className="lv-guide"
      title={current.title}
      sub={`Step ${step + 1} of ${steps.length}`}
      onClose={finish}
      foot={
        <>
          {!last && <button type="button" className="lv-btn lv-guide-skip" onClick={finish}>Skip</button>}
          {step > 0 && <button type="button" className="lv-btn" onClick={() => setStep(step - 1)}>Back</button>}
          <button type="button" className="lv-btn lv-btn-dark" autoFocus onClick={last ? finish : () => setStep(step + 1)}>
            {last ? "Start exploring" : "Next"}
          </button>
        </>
      }
    >
      <div className="lv-guide-step" key={step}>
        {current.intro && <p>{current.intro}</p>}
        <ul>
          {current.points.map((point) => <li key={point}>{point}</li>)}
        </ul>
      </div>
    </Dialog>
  );
}
