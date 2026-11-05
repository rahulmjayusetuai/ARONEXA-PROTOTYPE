"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { say, toast, type ActionContext } from "./actions";
import { exportSource, printBlocks, writeCsv, writePdf, type Block } from "./export";
import { DateGrid, optionsFor, SelectField } from "./Fields";
import { baseAppointments, fieldDate, MONTHS, minutes, plainDate, TIME_OPTIONS, TODAY, type Appt } from "./schedule";
import { newId, useLive } from "./state";

export function Dialog({ title, sub, children, foot, onClose, className }: { title: string; sub?: string; children: ReactNode; foot?: ReactNode; onClose: () => void; className?: string }) {
  return (
    <div className={className ? `lv-backdrop ${className}` : "lv-backdrop"} onClick={onClose}>
      <div className="lv-dialog" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="lv-dialog-head">
          <div>
            <h2>{title}</h2>
            {sub && <p>{sub}</p>}
          </div>
          <button type="button" className="lv-round" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="lv-dialog-body">{children}</div>
        {foot && <div className="lv-dialog-foot">{foot}</div>}
      </div>
    </div>
  );
}

function Chips({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="lv-chips">
      {options.map((o) => (
        <button type="button" key={o} aria-pressed={o === value} className={`lv-chip${o === value ? " is-on" : ""}`} onClick={() => onChange(o)}>{o}</button>
      ))}
    </div>
  );
}

function DateInput({ value, onChange, label }: { value: string; onChange: (iso: string) => void; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <label className="lv-label">
      {label}
      <button type="button" className="lv-input" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{fieldDate(value)}</button>
      {open && (
        <span className="lv-pop" style={{ position: "static", maxHeight: "none" }}>
          <DateGrid value={value} onPick={(d) => { onChange(d); setOpen(false); }} />
        </span>
      )}
    </label>
  );
}

function TimeSelect({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="lv-label">
      {label}
      <select className="lv-input" value={value} onChange={(e) => onChange(e.target.value)}>
        {TIME_OPTIONS.map((t) => <option key={t}>{t}</option>)}
      </select>
    </label>
  );
}

function BlockTime({ date: start, close }: { date: string; close: () => void }) {
  const add = useLive((s) => s.add);
  const setText = useLive((s) => s.setText);
  const [date, setDate] = useState(start);
  const [from, setFrom] = useState("2:00 PM");
  const [to, setTo] = useState("3:00 PM");
  const [reason, setReason] = useState("Meeting");
  const [note, setNote] = useState("Department meeting, conference room 2");
  const [notify, setNotify] = useState(true);
  const wrong = minutes(to) <= minutes(from);
  const save = () => {
    add("blocks", { id: newId(), date, from, to, reason, note, notify });
    setText("toast:block", `${plainDate(date).slice(0, 6)}, ${from} to ${to} is closed for bookings.`);
    close();
    say(`Time blocked: ${fieldDate(date)}, ${from} to ${to}.${notify ? " Moved patients were messaged." : ""}`);
  };
  return (
    <Dialog title="Block time" sub="No bookings can be made in this time" onClose={close} foot={<>
      <button type="button" className="lv-btn" onClick={close}>Cancel</button>
      <button type="button" className="lv-btn lv-btn-dark" disabled={wrong} onClick={save}>Block time</button>
    </>}>
      <div className="lv-form-row">
        <DateInput label="Date" value={date} onChange={setDate} />
        <TimeSelect label="From" value={from} onChange={setFrom} />
        <TimeSelect label="To" value={to} onChange={setTo} />
      </div>
      {wrong && <p className="lv-error">The end time must be after the start time.</p>}
      <div className="lv-label">Reason<Chips options={["Surgery", "Meeting", "Ward round", "Lunch", "Personal"]} value={reason} onChange={setReason} /></div>
      <label className="lv-label">Note (only you can see)<input className="lv-input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <label className="lv-label" style={{ flexDirection: "row", alignItems: "center" }}>
        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Message rescheduled patients by WhatsApp, SMS and the AroNexa app
      </label>
    </Dialog>
  );
}

function MarkLeave({ date, close }: { date: string; close: () => void }) {
  const add = useLive((s) => s.add);
  const [from, setFrom] = useState(date);
  const [until, setUntil] = useState(date);
  const [part, setPart] = useState("Whole day");
  const [fromTime, setFromTime] = useState("11:00 AM");
  const [reason, setReason] = useState("Personal");
  const [notify, setNotify] = useState(true);
  const wrong = until < from;
  const save = () => {
    add("leaves", { id: newId(), from, to: until, part, fromTime: part === "From a time" ? fromTime : undefined, reason, notify });
    close();
    toast("Toast / leave");
  };
  return (
    <Dialog title="Mark as leave" sub="Patients booked in this time get an SMS to choose a new time" onClose={close} foot={<>
      <button type="button" className="lv-btn" onClick={close}>Cancel</button>
      <button type="button" className="lv-btn lv-btn-dark" disabled={wrong} onClick={save}>Mark as leave</button>
    </>}>
      <div className="lv-form-row">
        <DateInput label="From date" value={from} onChange={(d) => { setFrom(d); if (until < d) setUntil(d); }} />
        <DateInput label="Until date" value={until} onChange={setUntil} />
      </div>
      {wrong && <p className="lv-error">The last day can’t be before the first day.</p>}
      <div className="lv-label">Which part of the day<Chips options={["Whole day", "Morning only", "Afternoon only", "From a time"]} value={part} onChange={setPart} /></div>
      {part === "From a time" && <TimeSelect label="From time" value={fromTime} onChange={setFromTime} />}
      <div className="lv-label">Reason<Chips options={["Personal", "Sick leave", "Conference", "Holiday", "Family function"]} value={reason} onChange={setReason} /></div>
      <label className="lv-label" style={{ flexDirection: "row", alignItems: "center" }}>
        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Send an SMS to booked patients so they can pick a new time
      </label>
    </Dialog>
  );
}

function MonthPicker({ close }: { close: () => void }) {
  const calMonth = useLive((s) => s.calMonth);
  const showDate = useLive((s) => s.showDate);
  const [year, setYear] = useState(Number(calMonth.slice(0, 4)));
  return (
    <Dialog title="Go to month" onClose={close}>
      <div className="lv-yearbar">
        <button type="button" className="lv-btn lv-btn-sm" aria-label="Previous year" onClick={() => setYear(year - 1)}>‹</button>
        <span>{year}</span>
        <button type="button" className="lv-btn lv-btn-sm" aria-label="Next year" onClick={() => setYear(year + 1)}>›</button>
      </div>
      <div className="lv-months" key={year}>
        {MONTHS.map((m, i) => {
          const key = `${year}-${String(i + 1).padStart(2, "0")}`;
          return (
            <button
              type="button"
              key={m}
              className={`lv-chip${key === calMonth ? " is-on" : ""}`}
              onClick={() => {
                showDate(TODAY.startsWith(key) ? TODAY : `${key}-01`);
                close();
              }}
            >
              {m}
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}

function FormatChooser({ ctx, close }: { ctx: ActionContext; close: () => void }) {
  const src = exportSource(undefined, ctx.overlay);
  const run = (kind: "pdf" | "csv") => {
    if (kind === "pdf") void writePdf(src.title, src.subtitle, src.blocks);
    else writeCsv(src.title, src.blocks);
    close();
    if (kind === "pdf") toast("Toast / download");
    else say("CSV saved to your Downloads folder. It opens in Excel or Google Sheets.");
  };
  return (
    <Dialog title={`Download: ${src.title}`} sub="Choose a file type" onClose={close} foot={<button type="button" className="lv-btn" onClick={close}>Cancel</button>}>
      <p className="lv-help">PDF is ready to print or share. CSV opens in Excel or Google Sheets for working with the numbers.</p>
      <div className="lv-actions">
        <button type="button" className="lv-btn lv-btn-dark" onClick={() => run("pdf")}>Download PDF</button>
        <button type="button" className="lv-btn" onClick={() => run("csv")}>Download CSV</button>
      </div>
    </Dialog>
  );
}

const PEOPLE = () => {
  const out: Appt[] = [];
  const seen = new Set<string>();
  for (const a of [...baseAppointments(TODAY, "thanal", useLive.getState().walkIns), ...baseAppointments(TODAY, "sahya")]) {
    if (!seen.has(a.name)) {
      seen.add(a.name);
      out.push(a);
    }
  }
  return out;
};

function PatientCard({ name, appt, text, row, close }: { name?: string; appt?: Appt; text?: string; row?: string; close: () => void }) {
  const hay = `${text ?? ""} ${row ?? ""}`;
  const person = appt ?? PEOPLE().find((p) => p.name === name || hay.includes(p.name));
  const seen = useLive((s) => s.seenTokens);
  const update = useLive((s) => s.update);
  if (!person) {
    return (
      <Dialog title={name ?? "Patient"} onClose={close}>
        <p className="lv-help">{name ? "No visits are booked today. A full record is available for James Heatfield only." : hay.trim()}</p>
      </Dialog>
    );
  }
  const isSeen = seen.includes(person.pid) || person.status === "Seen";
  const summary = (): Block[] => [{
    width: 600,
    pictures: [],
    rows: [["Patient", person.name], ["Patient ID", person.pid], ["Sex and age", person.who], ["Appointment", person.time], ["Reason", person.reason], ["Booked through", person.via], ["Status", isSeen ? "Seen" : person.status]].map(([k, v], i) => [
      { x: 0, y: i * 30, w: 180, text: k, size: 12, weight: 600 },
      { x: 200, y: i * 30, w: 380, text: v, size: 12, weight: 400 },
    ]),
  }];
  return (
    <Dialog title={person.name} sub={`${person.who} · ${person.pid}`} onClose={close} foot={<>
      <button type="button" className="lv-btn" onClick={() => { void writePdf(`${person.name} visit summary`, "Thanal Heart Clinic - 15 May 2025", summary()); toast("Toast / download"); }}>Download summary</button>
      <button type="button" className="lv-btn" onClick={() => printBlocks(`${person.name} visit summary`, "Thanal Heart Clinic - 15 May 2025", summary())}>Print</button>
      {!isSeen && <button type="button" className="lv-btn lv-btn-dark" onClick={() => { update({ seenTokens: [...seen, person.pid] }); say(`${person.name} marked as seen.`); close(); }}>Mark as seen</button>}
    </>}>
      <div className="lv-facts">
        <div><small>Appointment</small><b>{person.time}</b></div>
        <div><small>Status</small><b>{isSeen ? "Seen" : person.status}</b></div>
        <div><small>Reason</small><b>{person.reason}</b></div>
        <div><small>Booked through</small><b>{person.via}</b></div>
      </div>
      <p className="lv-help">A full record is available for James Heatfield only, so other patients open this summary.</p>
    </Dialog>
  );
}

function WalkIn({ close }: { close: () => void }) {
  const walkIns = useLive((s) => s.walkIns);
  const add = useLive((s) => s.add);
  const [name, setName] = useState("");
  const [sex, setSex] = useState("F");
  const [age, setAge] = useState("");
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("New consultation");
  const [time, setTime] = useState("3:00 PM");
  const [error, setError] = useState("");
  const save = () => {
    if (!name.trim()) return setError("Enter the patient’s name.");
    const years = Number(age);
    if (!age || Number.isNaN(years) || years < 0 || years > 120) return setError("Enter an age from 0 to 120.");
    const number = 10 + walkIns.length;
    const pid = `ANX-${80000 + walkIns.length + 1}`;
    add("walkIns", { id: newId(), token: `T-${number}`, name: name.trim(), sex, age, phone, reason, time, pid });
    close();
    say(`${name.trim()} added as walk-in. Token T-${number}.`);
  };
  return (
    <Dialog title="Add walk-in patient" sub="Thanal Heart Clinic · Thursday, 15 May 2025" onClose={close} foot={<>
      <button type="button" className="lv-btn" onClick={close}>Cancel</button>
      <button type="button" className="lv-btn lv-btn-dark" onClick={save}>Add patient</button>
    </>}>
      <label className="lv-label">Full name<input autoFocus className="lv-input" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <div className="lv-form-row">
        <div className="lv-label">Sex<Chips options={["F", "M", "Other"]} value={sex} onChange={setSex} /></div>
        <label className="lv-label">Age<input className="lv-input" inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value)} /></label>
      </div>
      <div className="lv-form-row">
        <label className="lv-label">Mobile<input className="lv-input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
        <TimeSelect label="Time" value={time} onChange={setTime} />
      </div>
      <label className="lv-label">Reason<input className="lv-input" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      {error && <p className="lv-error" role="alert">{error}</p>}
    </Dialog>
  );
}

function Collect({ token, name, amount, close }: { token?: string; name?: string; amount?: number; close: () => void }) {
  const collected = useLive((s) => s.collected);
  const update = useLive((s) => s.update);
  const setText = useLive((s) => s.setText);
  const [mode, setMode] = useState("UPI");
  const t = token ?? "T-04";
  const who = name ?? "James Heatfield";
  const rupees = amount ?? 700;
  const save = () => {
    update({ collected: { ...collected, [t]: mode } });
    setText("toast:collected", who);
    close();
    say(`₹${rupees} collected from ${who} by ${mode}.`);
  };
  return (
    <Dialog title={`Collect ₹${rupees}`} sub={`${who} · ${t}`} onClose={close} foot={<>
      <button type="button" className="lv-btn" onClick={close}>Cancel</button>
      <button type="button" className="lv-btn lv-btn-dark" onClick={save}>Record payment</button>
    </>}>
      <div className="lv-label">Paid by<Chips options={["UPI", "Cash", "Card"]} value={mode} onChange={setMode} /></div>
    </Dialog>
  );
}

function Receipt({ bill, close }: { bill: { token: string; name: string; services: string; amount: number; mode: string; paid: string }; close: () => void }) {
  const blocks: Block[] = [{
    width: 600,
    pictures: [],
    rows: [["Token", bill.token], ["Patient", bill.name], ["Services", bill.services], ["Amount paid", `₹${bill.amount}`], ["Paid by", bill.mode], ["Status", bill.paid], ["Received by", "Thanal Heart Clinic"]].map(([k, v], i) => [
      { x: 0, y: i * 30, w: 180, text: k, size: 12, weight: 600 },
      { x: 200, y: i * 30, w: 380, text: v, size: 12, weight: 400 },
    ]),
  }];
  const title = `Receipt ${bill.token} ${bill.name}`;
  const sub = "Thanal Heart Clinic - Thursday, 15 May 2025";
  return (
    <Dialog title={`Receipt ${bill.token}`} sub={bill.name} onClose={close} foot={<>
      <button type="button" className="lv-btn" onClick={() => printBlocks(title, sub, blocks)}>Print</button>
      <button type="button" className="lv-btn lv-btn-dark" onClick={() => { void writePdf(title, sub, blocks); close(); toast("Toast / receipt"); }}>Download PDF</button>
    </>}>
      <div className="lv-facts">
        <div><small>Services</small><b>{bill.services}</b></div>
        <div><small>Amount</small><b>₹{bill.amount}</b></div>
        <div><small>Paid by</small><b>{bill.mode}</b></div>
        <div><small>Status</small><b>{bill.paid}</b></div>
      </div>
    </Dialog>
  );
}

function Password({ close }: { close: () => void }) {
  const setText = useLive((s) => s.setText);
  const [now, setNow] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState("");
  const save = () => {
    if (!now) return setError("Enter your current password.");
    if (next.length < 8 || !/\d/.test(next)) return setError("Use at least 8 characters with a number.");
    if (next !== again) return setError("The new passwords don’t match.");
    setText("354:6580", "Changed just now");
    setText("285:6668", "Last changed: just now");
    close();
    say("Password changed.");
  };
  return (
    <Dialog title="Change password" onClose={close} foot={<>
      <button type="button" className="lv-btn" onClick={close}>Cancel</button>
      <button type="button" className="lv-btn lv-btn-dark" onClick={save}>Save password</button>
    </>}>
      <label className="lv-label">Current password<input autoFocus type="password" className="lv-input" value={now} onChange={(e) => setNow(e.target.value)} /></label>
      <label className="lv-label">New password<input type="password" className="lv-input" value={next} onChange={(e) => setNext(e.target.value)} /></label>
      <label className="lv-label">Confirm new password<input type="password" className="lv-input" value={again} onChange={(e) => setAgain(e.target.value)} /></label>
      {error && <p className="lv-error" role="alert">{error}</p>}
    </Dialog>
  );
}

function Devices({ close }: { close: () => void }) {
  const setText = useLive((s) => s.setText);
  const [devices, setDevices] = useState(["This laptop · Chrome, Kochi · now", "Phone · AroNexa app · 2 hours ago"]);
  const sync = (list: string[]) => {
    setDevices(list);
    setText("354:6589", list.map((d) => d.split(" · ")[0]).join(" · "));
  };
  return (
    <Dialog title="Signed-in devices" onClose={close}>
      <ul className="lv-devices">
        {devices.map((d, i) => (
          <li key={d}>
            {d}
            {i > 0 ? <button type="button" className="lv-link" onClick={() => sync(devices.filter((x) => x !== d))}>Sign out</button> : <small>This device</small>}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

function Selfie({ close }: { close: () => void }) {
  const setText = useLive((s) => s.setText);
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(() => !navigator.mediaDevices);
  useEffect(() => {
    let stream: MediaStream | undefined;
    navigator.mediaDevices?.getUserMedia({ video: true }).then((s) => {
      stream = s;
      if (video.current) video.current.srcObject = s;
    }).catch(() => setFailed(true));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);
  const done = () => {
    setText("248:6372", "Retake");
    setText("248:6370", "Selfie saved for the face match");
    close();
    say("Selfie saved.");
  };
  return (
    <Dialog title="Take a selfie" sub="Used once, to match your face with your ID" onClose={close} foot={<>
      <button type="button" className="lv-btn" onClick={close}>Cancel</button>
      <button type="button" className="lv-btn lv-btn-dark" disabled={failed} onClick={done}>Capture</button>
    </>}>
      {failed
        ? <p className="lv-error" role="alert">The camera isn’t available. Allow it in your browser and try again.</p>
        : <video ref={video} className="lv-selfie" autoPlay playsInline muted />}
    </Dialog>
  );
}

const KNOWN_HFR: Record<string, string> = {
  IN3210045678: "Periyar Family Clinic, MG Road, Aluva",
  IN3210012345: "Thanal Heart Clinic, Infopark Road, Kakkanad",
  IN3210067890: "Sahya Heart Care, NH 66, Edappally",
};

function FindClinic({ close }: { close: () => void }) {
  const setFilter = useLive((s) => s.setFilter);
  const clinics = useLive((s) => s.filters.clinics);
  const [hfr, setHfr] = useState("IN3210045678");
  const [result, setResult] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const find = () => {
    setChecked(true);
    setResult(KNOWN_HFR[hfr.replace(/\s/g, "").toUpperCase()] ?? null);
  };
  const add = () => {
    if (!result) return;
    setFilter("clinics", `${clinics ? `${clinics}\n` : ""}${result.split(",")[0]}|${result.split(",").slice(1).join(",").trim()}`);
    close();
    say(`${result.split(",")[0]} added.`);
  };
  return (
    <Dialog title="Find clinic" sub="ABDM Health Facility Registry" onClose={close} foot={<>
      <button type="button" className="lv-btn" onClick={close}>Close</button>
      {result ? <button type="button" className="lv-btn lv-btn-dark" onClick={add}>Add this clinic</button> : <button type="button" className="lv-btn lv-btn-dark" onClick={find}>Find clinic</button>}
    </>}>
      <label className="lv-label">HFR ID<input autoFocus className="lv-input" value={hfr} onChange={(e) => { setHfr(e.target.value); setResult(null); setChecked(false); }} /></label>
      {checked && (result ? <p className="lv-help"><b>Found:</b> {result}</p> : <p className="lv-error" role="alert">No clinic found with that HFR ID. Try IN3210045678, IN3210012345, IN3210067890.</p>)}
    </Dialog>
  );
}

function ValueEditor({ title, label, value, nodeId, rule, apply, close }: { title: string; label: string; value?: string; nodeId?: string; rule?: string; apply?: string; close: () => void }) {
  const setText = useLive((s) => s.setText);
  const setFilter = useLive((s) => s.setFilter);
  const insurers = useLive((s) => s.filters.insurers);
  const [text, setTextValue] = useState(value ?? "");
  const [error, setError] = useState("");
  const options = optionsFor(value ?? "");
  const save = () => {
    const v = text.trim();
    if (!v) return setError(`Enter the ${label.toLowerCase()}.`);
    if (rule === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return setError("Enter a valid email address.");
    if (rule === "phone" && v.replace(/\D/g, "").length < 10) return setError("Enter a 10-digit mobile number.");
    if (rule === "pin") {
      const m = v.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
      if (!m) return setError("Enter latitude and longitude, like 10.1076, 76.3516.");
      setFilter("pin", `${m[1]},${m[2]}`);
      setText("370:6808", `Pin set · ${Number(m[1]).toFixed(4)}° N, ${Number(m[2]).toFixed(4)}° E`);
      close();
      return say("Pin moved.");
    }
    if (apply === "insurer") setFilter("insurers", `${insurers ? `${insurers}\n` : ""}${v}`);
    else if (nodeId) setText(nodeId, v);
    close();
    say("Saved.");
  };
  return (
    <Dialog title={title} onClose={close} foot={<>
      <button type="button" className="lv-btn" onClick={close}>Cancel</button>
      <button type="button" className="lv-btn lv-btn-dark" onClick={save}>Save</button>
    </>}>
      <label className="lv-label">{label}
        {options
          ? <SelectField value={text} options={options} label={label} style={{ position: "relative" }} onChange={setTextValue} />
          : <input autoFocus className="lv-input" value={text} onChange={(e) => setTextValue(e.target.value)} />}
      </label>
      {error && <p className="lv-error" role="alert">{error}</p>}
    </Dialog>
  );
}

function Choice({ title, options, nodeId, value, apply, close }: { title: string; options: string[]; nodeId?: string; value: string; apply?: string; close: () => void }) {
  const setText = useLive((s) => s.setText);
  const update = useLive((s) => s.update);
  const [picked, setPicked] = useState(value);
  const save = () => {
    if (nodeId) setText(nodeId, picked);
    if (apply === "theme") update({ theme: picked as "Light" | "Dark" });
    close();
    say(title === "App language" ? `App language set to ${picked}. Sign-in, registration and patient explanations use it.` : `${title} set to ${picked}.`);
  };
  return (
    <Dialog title={title} onClose={close} foot={<>
      <button type="button" className="lv-btn" onClick={close}>Cancel</button>
      <button type="button" className="lv-btn lv-btn-dark" onClick={save}>Save</button>
    </>}>
      <Chips options={options} value={picked} onChange={setPicked} />
    </Dialog>
  );
}

function Confirm({ title, hide, close }: { title: string; hide?: string; close: () => void }) {
  const remove = useLive((s) => s.hide);
  return (
    <Dialog title={title} onClose={close} foot={<>
      <button type="button" className="lv-btn" onClick={close}>Cancel</button>
      <button type="button" className="lv-btn lv-btn-dark" onClick={() => { if (hide) remove(hide); close(); say("Removed."); }}>Remove</button>
    </>}>
      <p className="lv-help">This takes it off your list. You can add it again later.</p>
    </Dialog>
  );
}

const REPORTS = ["Resting ECG · 15 May 2025", "Chest X-ray · 02 Feb 2025", "Echocardiogram · 02 Feb 2025", "Spirometry report · 10 Jan 2025", "Kidney tests · 15 May 2025"];

function Attach({ close }: { close: () => void }) {
  const attachments = useLive((s) => s.attachments);
  const update = useLive((s) => s.update);
  const [picked, setPicked] = useState(REPORTS[1]);
  return (
    <Dialog title="Attach report" sub="Linked to this clinical note" onClose={close} foot={<>
      <button type="button" className="lv-btn" onClick={close}>Cancel</button>
      <button type="button" className="lv-btn lv-btn-dark" onClick={() => { update({ attachments: [...attachments.filter((a) => a !== picked), picked] }); close(); say(`${picked} is attached to this note.`); }}>Attach</button>
    </>}>
      <div className="lv-options">
        {REPORTS.map((r) => <button type="button" key={r} aria-pressed={r === picked} className={r === picked ? "is-on" : ""} onClick={() => setPicked(r)}>{r}</button>)}
      </div>
      {attachments.length > 0 && <p className="lv-help">Already attached: {attachments.join(", ")}</p>}
    </Dialog>
  );
}

export function LiveModals() {
  const modal = useLive((s) => s.modal);
  const close = useLive((s) => s.closeModal);
  useEffect(() => {
    if (!modal) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        close();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [modal, close]);
  if (!modal) return null;
  const p = (modal.props ?? {}) as never;
  switch (modal.name) {
    case "block":
      return <BlockTime {...(p as { date: string })} close={close} />;
    case "leave":
      return <MarkLeave {...(p as { date: string })} close={close} />;
    case "month":
      return <MonthPicker close={close} />;
    case "format":
      return <FormatChooser {...(p as { ctx: ActionContext })} close={close} />;
    case "patient":
      return <PatientCard {...(p as { name?: string })} close={close} />;
    case "walkin":
      return <WalkIn close={close} />;
    case "collect":
      return <Collect {...(p as { token?: string })} close={close} />;
    case "receipt":
      return <Receipt {...(p as { bill: Parameters<typeof Receipt>[0]["bill"] })} close={close} />;
    case "password":
      return <Password close={close} />;
    case "devices":
      return <Devices close={close} />;
    case "selfie":
      return <Selfie close={close} />;
    case "findClinic":
      return <FindClinic close={close} />;
    case "pin":
      return <ValueEditor title="Move pin" label="Latitude, longitude" value="10.1076, 76.3516" rule="pin" close={close} />;
    case "value":
      return <ValueEditor {...(p as { title: string; label: string })} close={close} />;
    case "choice":
      return <Choice {...(p as { title: string; options: string[]; value: string })} close={close} />;
    case "confirm":
      return <Confirm {...(p as { title: string })} close={close} />;
    case "attach":
      return <Attach close={close} />;
    default:
      return null;
  }
}
