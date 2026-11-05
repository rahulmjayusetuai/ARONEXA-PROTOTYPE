"use client";

import { useEffect, useMemo, useRef } from "react";
import { calendarReturn, manifest, screensById, useDesign } from "../store";
import { gotoScreen } from "./actions";
import { dayView, daysIn, longDate, minutes, monthLabel, parse, shiftMonth, time12, TODAY, weekdayShort, type Appt, type Clinic } from "./schedule";
import { useLive } from "./state";

const fmt = (t: string) => t;

function dayLine(view: ReturnType<typeof dayView>) {
  if (view.leave && view.leave.part === "Whole day") return { label: "On leave", sub: "Whole day", kind: "leave" as const };
  if (!view.hours) return { label: "Clinic closed", sub: "No bookings", kind: "closed" as const };
  const today = view.date === TODAY;
  const hours = `${today ? "Today, " : ""}${fmt(view.hours[0])} to ${fmt(view.hours[1])}`;
  const n = view.active;
  return { label: `${n} patient${n === 1 ? "" : "s"}`, sub: view.leave ? `Leave: ${view.leave.part.toLowerCase()}` : hours, kind: "open" as const };
}

function DayRow({ date, clinic, selected, onPick }: { date: string; clinic: Clinic; selected: boolean; onPick: () => void }) {
  const leaves = useLive((s) => s.leaves);
  const blocks = useLive((s) => s.blocks);
  const walkIns = useLive((s) => s.walkIns);
  const bookings = useLive((s) => s.filters.bookings);
  const view = useMemo(() => dayView(date, clinic, leaves, blocks, walkIns, bookings), [date, clinic, leaves, blocks, walkIns, bookings]);
  const line = dayLine(view);
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const row = ref.current;
    const list = row?.parentElement;
    if (!selected || !row || !list) return;
    // Moves only the day list. scrollIntoView would also shift the page behind the calendar.
    const box = list.getBoundingClientRect();
    const at = row.getBoundingClientRect();
    // The panel can run past the bottom of a short window, so only what's on screen counts.
    const bottom = Math.min(box.bottom, window.innerHeight);
    if (at.top >= box.top && at.bottom <= bottom) return;
    const zoom = box.height / list.clientHeight;
    list.scrollTop += (at.top - box.top - (bottom - box.top - at.height) / 2) / zoom;
  }, [selected]);
  return (
    <button ref={ref} type="button" data-date={date} aria-pressed={selected} className={`lv-day lv-day-${line.kind}${selected ? " is-on" : ""}`} onClick={onPick}>
      <span className="lv-day-num">
        <small>{weekdayShort(date)}</small>
        <b>{parse(date).getDate()}</b>
      </span>
      <span className="lv-day-text">
        <b>{line.label}</b>
        <small>{line.sub}</small>
      </span>
      {line.kind === "leave" && <i className="lv-pill lv-pill-leave">Leave</i>}
    </button>
  );
}

const STATUS: Record<Appt["status"], string> = {
  Seen: "lv-pill-seen",
  "With you now": "lv-pill-now",
  Booked: "lv-pill-booked",
  Rescheduled: "lv-pill-leave",
  "Rebooking sent": "lv-pill-leave",
};

function ApptRow({ a }: { a: Appt }) {
  const openModal = useLive((s) => s.openModal);
  const open = () => {
    if (a.james) {
      const overview = manifest.screens.find((s) => s.name === "Patient / Overview")?.id;
      if (overview) gotoScreen(overview);
    } else {
      openModal("patient", { name: a.name, appt: a });
    }
  };
  return (
    <button type="button" className={`lv-appt${a.status === "With you now" ? " is-now" : ""}${a.status === "Rescheduled" || a.status === "Rebooking sent" ? " is-moved" : ""}`} onClick={open}>
      <span className={`lv-dot${a.status === "Seen" ? " is-seen" : a.status === "With you now" ? " is-now" : ""}`} />
      <span className="lv-appt-card">
        <b className="lv-appt-time">{a.time}</b>
        <span className="lv-avatar">{a.initials}</span>
        <span className="lv-appt-text">
          <b>{a.name}</b>
          <small>{a.reason}</small>
        </span>
        <i className={`lv-pill ${STATUS[a.status]}`}>{a.status}</i>
      </span>
    </button>
  );
}

export function CalendarPanel({ clinic, month }: { clinic: Clinic; month?: string }) {
  const calMonth = useLive((s) => s.calMonth);
  const calDate = useLive((s) => s.calDate);
  const showMonth = useLive((s) => s.showMonth);
  const showDate = useLive((s) => s.showDate);
  const openModal = useLive((s) => s.openModal);
  const leaves = useLive((s) => s.leaves);
  const blocks = useLive((s) => s.blocks);
  const walkIns = useLive((s) => s.walkIns);
  const drop = useLive((s) => s.drop);

  const first = useRef(true);
  useEffect(() => {
    if (first.current && month) {
      showDate(`${month}-02`);
    }
    first.current = false;
  }, [month, showDate]);

  const days = useMemo(() => daysIn(calMonth), [calMonth]);
  const bookings = useLive((s) => s.filters.bookings);
  const view = useMemo(() => dayView(calDate, clinic, leaves, blocks, walkIns, bookings), [calDate, clinic, leaves, blocks, walkIns, bookings]);

  const step = (by: number) => {
    const next = shiftMonth(calMonth, by);
    showMonth(next);
    // Keeps the selected day inside the month being looked at.
    const wanted = `${next}${calDate.slice(7)}`;
    const valid = daysIn(next).includes(wanted) ? wanted : daysIn(next)[daysIn(next).length - 1];
    showDate(TODAY.startsWith(next) ? TODAY : valid);
  };

  const close = () => {
    if (window.history.length > 1 && useDesign.getState().overlays.length === 0) {
      const current = screensById.get(useDesign.getState().screen)?.name ?? "";
      const home = manifest.screens.find((s) => s.name === (/Sahya/.test(current) ? "Doctor home (landing) · Sahya Heart Care (after Sahya confirms)" : "Doctor home (landing)"));
      if (home) gotoScreen(calendarReturn(home.id));
    }
  };

  const moved = view.appts.length - view.active;
  const summary = view.leave?.part === "Whole day"
    ? `On leave. ${moved} patient${moved === 1 ? "" : "s"} asked to pick a new time.`
    : !view.hours
      ? clinic === "sahya"
        ? "You see patients at Sahya on Tuesday and Thursday evenings."
        : "The clinic is closed on Sundays."
      : `${view.active} patient${view.active === 1 ? "" : "s"} booked${view.appts.some((a) => a.status === "With you now") ? ", 1 with you now" : ""}${moved ? `, ${moved} being moved` : ""}`;

  const timeline = [
    ...view.appts.map((a) => ({ at: minutes(a.time), a })),
    ...view.blocks.map((b) => ({ at: minutes(b.from), b })),
  ].sort((x, y) => x.at - y.at);

  return (
    <div className="lv-cal">
      <header className="lv-cal-head">
        <div className="lv-cal-title">
          <div>
            <small>Dr. Arjun Mehta, Cardiology{clinic === "sahya" ? " · Sahya Heart Care" : ""}</small>
            <b>My calendar</b>
          </div>
          <button type="button" className="lv-round" aria-label="Close calendar" onClick={close}>✕</button>
        </div>
        <div className="lv-cal-nav">
          <button type="button" className="lv-round" aria-label="Previous month" onClick={() => step(-1)}>‹</button>
          <button type="button" className="lv-month" data-testid="cal-month" onClick={() => openModal("month")}>
            {monthLabel(calMonth)} <span>▾</span>
          </button>
          <button type="button" className="lv-round" aria-label="Next month" onClick={() => step(1)}>›</button>
          <button type="button" className="lv-today" onClick={() => showDate(TODAY)}>Today</button>
        </div>
      </header>
      <div className="lv-cal-body">
        <nav className="lv-cal-days" aria-label={monthLabel(calMonth)}>
          {days.map((d) => (
            <DayRow key={d} date={d} clinic={clinic} selected={d === calDate} onPick={() => showDate(d)} />
          ))}
        </nav>
        <section className="lv-cal-day">
          <div className="lv-cal-dayhead">
            <div>
              <h2 data-testid="cal-date">{longDate(calDate)}</h2>
              <p>{summary}</p>
            </div>
            <div className="lv-actions">
              <button type="button" className="lv-btn" onClick={() => openModal("block", { date: calDate })}>Block time</button>
              {view.leave ? (
                <button type="button" className="lv-btn lv-btn-dark" onClick={() => drop("leaves", view.leave!.id)}>Cancel leave</button>
              ) : (
                <button type="button" className="lv-btn lv-btn-dark" onClick={() => openModal("leave", { date: calDate })}>Mark as leave</button>
              )}
            </div>
          </div>
          {view.leave && (
            <div className="lv-banner">
              <b>On leave: {view.leave.part.toLowerCase()}</b>
              <span>{view.leave.reason}{view.leave.notify ? " · Patients got an SMS to choose a new time." : ""}</span>
            </div>
          )}
          <div className="lv-appts">
            {timeline.length === 0 && <p className="lv-empty">No bookings on this day.</p>}
            {timeline.map((t, i) =>
              "a" in t && t.a ? (
                <ApptRow key={`${t.a.time}-${i}`} a={t.a} />
              ) : "b" in t && t.b ? (
                <div className="lv-block" key={t.b.id}>
                  <span className="lv-dot is-block" />
                  <div>
                    <b>{time12(minutes(t.b.from))} to {time12(minutes(t.b.to))} · {t.b.reason}</b>
                    <small>{t.b.note || "Closed for bookings"}{t.b.notify ? " · Moved patients were messaged" : ""}</small>
                  </div>
                  <button type="button" className="lv-link" onClick={() => drop("blocks", t.b!.id)}>Remove</button>
                </div>
              ) : null,
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
