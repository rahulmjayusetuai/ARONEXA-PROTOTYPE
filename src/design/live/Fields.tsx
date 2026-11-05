"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { playLeave } from "./motion";
import { daysIn, fieldDate, iso, monthLabel, parse, plainDate, shiftMonth, TIME_OPTIONS, TODAY } from "./schedule";

// Popups render on <body> so a clipped pop-up frame can't cut them off.
function Popup({ anchor, onClose, children, width }: { anchor: HTMLElement | null; onClose: () => void; children: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({ visibility: "hidden" });
  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const a = anchor.getBoundingClientRect();
    const h = ref.current.offsetHeight;
    const w = Math.max(width ?? a.width, 220);
    const below = a.bottom + 6 + h < window.innerHeight;
    setPos({
      left: Math.min(a.left, window.innerWidth - w - 8),
      top: below ? a.bottom + 6 : Math.max(8, a.top - h - 6),
      width: w,
    });
  }, [anchor, width]);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor?.contains(t)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key, true);
    };
  }, [anchor, onClose]);
  // Plays the close however the list got dismissed. The time check skips the extra
  // unmount React's development mode does straight after opening.
  useLayoutEffect(() => {
    const el = ref.current;
    const opened = performance.now();
    return () => {
      if (el && performance.now() - opened > 50) playLeave(el);
    };
  }, []);
  return createPortal(
    <div ref={ref} className="lv-pop" style={pos} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>,
    document.body,
  );
}

const WEEK_HEAD = ["M", "T", "W", "T", "F", "S", "S"];

export function DateGrid({ value, onPick }: { value: string; onPick: (iso: string) => void }) {
  const [month, setMonth] = useState(value.slice(0, 7));
  const days = daysIn(month);
  const lead = (parse(days[0]).getDay() + 6) % 7;
  return (
    <div className="lv-grid">
      <div className="lv-grid-head">
        <button type="button" aria-label="Previous year" onClick={() => setMonth(shiftMonth(month, -12))}>«</button>
        <button type="button" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
        <b>{monthLabel(month)}</b>
        <button type="button" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
        <button type="button" aria-label="Next year" onClick={() => setMonth(shiftMonth(month, 12))}>»</button>
      </div>
      <div className="lv-grid-days" key={month}>
        {WEEK_HEAD.map((d, i) => <small key={i}>{d}</small>)}
        {Array.from({ length: lead }, (_, i) => <span key={`x${i}`} />)}
        {days.map((d) => (
          <button type="button" key={d} data-date={d} className={`${d === value ? "is-on" : ""}${d === TODAY ? " is-today" : ""}`} onClick={() => onPick(d)}>
            {parse(d).getDate()}
          </button>
        ))}
      </div>
    </div>
  );
}

const MONTH_INDEX = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// Reads "Thu, 15 May 2025", "15 Nov 2025" or "12 Mar 1984".
export function readDate(text: string): string | null {
  const m = text.match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/);
  if (!m) return null;
  const month = MONTH_INDEX.indexOf(m[2].toLowerCase());
  if (month < 0) return null;
  return iso(new Date(Number(m[3]), month, Number(m[1])));
}

export const isDateText = (t: string) => readDate(t) !== null;
export const isTimeText = (t: string) => /^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(t.trim());

export function DateField({ value, style, label, onChange, withDay }: { value: string; style: CSSProperties; label: string; onChange: (v: string) => void; withDay: boolean }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const current = readDate(value) ?? TODAY;
  return (
    <>
      <button ref={setAnchor} type="button" aria-label={label} aria-expanded={open} className="fg-field lv-fieldbtn" style={style} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
        {value}
      </button>
      {open && (
        <Popup anchor={anchor} onClose={() => setOpen(false)} width={280}>
          <DateGrid
            value={current}
            onPick={(d) => {
              onChange(withDay ? fieldDate(d) : plainDate(d));
              setOpen(false);
            }}
          />
        </Popup>
      )}
    </>
  );
}

export function SelectField({ value, options, style, label, onChange }: { value: string; options: string[]; style: CSSProperties; label: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  return (
    <>
      <button ref={setAnchor} type="button" aria-label={label} aria-expanded={open} aria-haspopup="listbox" className="fg-field lv-fieldbtn" style={style} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
        {value}
      </button>
      {open && (
        <Popup anchor={anchor} onClose={() => setOpen(false)}>
          <div role="listbox" className="lv-options">
            {options.map((o) => (
              <button
                type="button"
                role="option"
                aria-selected={o === value}
                key={o}
                className={o === value ? "is-on" : ""}
                onClick={() => {
                  onChange(o);
                  setOpen(false);
                }}
              >
                {o}
              </button>
            ))}
          </div>
        </Popup>
      )}
    </>
  );
}

const LABS = ["Thejus Clinical Lab, Thrissur (patient’s preferred)", "Thanal clinic lab, Kakkanad", "Nila Diagnostics, Kochi", "Sahya Hospital lab, Edappally"];
const PHARM = ["Periyar Medicals, Kakkanad (patient’s preferred)", "Thanal Heart Clinic pharmacy", "Apollo Pharmacy, Edappally"];
const DISTRICTS = ["Ernakulam", "Thrissur", "Kottayam", "Idukki", "Alappuzha", "Palakkad", "Malappuram", "Kozhikode", "Thiruvananthapuram", "Kollam"];
const SPECIALITY = ["Cardiology", "General Medicine", "Orthopaedics", "Neurology", "Gastroenterology", "Nephrology", "Pulmonology", "Paediatrics", "Psychiatry", "Dermatology"];
const COUNCIL = ["Travancore-Cochin Council of Modern Medicine (Kerala)", "National Medical Commission (Indian Medical Register)", "Tamil Nadu Medical Council", "Karnataka Medical Council", "Maharashtra Medical Council", "Delhi Medical Council"];
const YEARS = Array.from({ length: 45 }, (_, i) => String(2025 - i));

// Dropdown choices, found from the value the design shows in that field.
const OPTIONS: [RegExp, string[]][] = [
  [/^Thejus Clinical Lab, Thrissur \(/, LABS],
  [/^Thejus Clinical Lab, Thrissur$/, ["Thejus Clinical Lab, Thrissur", "Thanal clinic lab, Kakkanad", "Sahya Hospital lab, Edappally"]],
  [/^Nila Diagnostics, Kochi$/, ["Nila Diagnostics, Kochi", "Vembanad Scan Centre, Kottayam", "Sahya Heart Care, Edappally"]],
  [/^Periyar Medicals, Kakkanad \(/, PHARM],
  [/^Periyar Medicals, Kakkanad$/, ["Periyar Medicals, Kakkanad", "Thanal Heart Clinic pharmacy", "Apollo Pharmacy, Edappally"]],
  [/^WhatsApp$/, ["WhatsApp", "SMS", "Email", "AroNexa app"]],
  [/^Scans and reports$/, ["Scans and reports", "Visit summaries", "Prescriptions", "Referral letters", "Certificates", "Consent forms", "Insurance", "ID and registration"]],
  [/^Heart$/, ["Heart", "Lungs", "Brain", "Liver", "Stomach", "Kidneys", "Intestines", "Joints", "General"]],
  [/^Travancore-Cochin Council/, COUNCIL],
  [/^Cardiology$/, SPECIALITY],
  [/^Thanal Heart Clinic$/, ["Thanal Heart Clinic", "Sahya Heart Care"]],
  [/^15 minutes$/, ["10 minutes", "15 minutes", "20 minutes", "30 minutes"]],
  [/^Ernakulam$/, DISTRICTS],
  [/^Owner$/, ["Owner", "Visiting consultant", "Staff doctor"]],
  [/^Male$/, ["Male", "Female", "Other", "Prefer not to say"]],
  [/^2014$/, YEARS],
  [/^Once a day$/, ["Once a day", "Twice a day", "Three times a day", "At bedtime", "When needed"]],
  [/^3 days$/, ["3 days", "5 days", "7 days", "10 days", "14 days", "1 month", "3 months"]],
  [/^English, Malayalam, Hindi$/, ["English, Malayalam, Hindi", "English, Malayalam", "English", "Malayalam", "Hindi"]],
];

export function optionsFor(value: string): string[] | null {
  const clean = value.replace(/\s*▾\s*$/, "").trim();
  for (const [test, list] of OPTIONS) if (test.test(clean)) return list;
  if (isTimeText(clean)) return TIME_OPTIONS.map((t) => (/^0\d:/.test(clean) && /^\d:/.test(t) ? `0${t}` : t));
  return null;
}

export { TIME_OPTIONS };
