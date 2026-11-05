"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { runActions, useDesign } from "../store";
import type { DesignNode } from "../types";
import { CalendarPanel } from "./Calendar";
import { billingTable, TODAY_BILLS } from "./schedule";
import { useLive } from "./state";

const money = (n: number) => `₹${n.toLocaleString("en-IN")}`;

function BillingCard({ range, clinic }: { range: "today" | "week" | "month"; clinic: "thanal" | "sahya" }) {
  const collected = useLive((s) => s.collected);
  const openModal = useLive((s) => s.openModal);
  if (range === "today") {
    const total = TODAY_BILLS.reduce((sum, b) => sum + b.amount, 0);
    return (
      <div className="lv-bill">
        <h3>Today’s bills</h3>
        <table>
          <thead><tr><th>Token</th><th>Patient</th><th>Services</th><th>Amount</th><th>Paid by</th><th>Status</th><th /></tr></thead>
          <tbody>
            {TODAY_BILLS.map((b, i) => {
              const mode = collected[b.token];
              const paid = b.paid || (mode ? "Paid now" : "");
              const pendingNow = !paid && i === 3;
              const canCollect = !paid && i >= 3;
              return (
                <tr key={b.token}>
                  <td><span className="lv-token">{b.token}</span></td>
                  <td><b>{b.name}</b></td>
                  <td>{b.services}</td>
                  <td><b>{money(b.amount)}</b></td>
                  <td>{b.mode || mode || "–"}</td>
                  <td><i className={`lv-pill ${paid ? "lv-pill-now" : pendingNow ? "lv-pill-amber" : "lv-pill-seen"}`}>{paid || (pendingNow ? "Pending" : "Not billed yet")}</i></td>
                  <td>
                    {paid ? (
                      <button type="button" className="lv-btn lv-btn-sm" onClick={() => openModal("receipt", { bill: { ...b, mode: b.mode || mode, paid } })}>Receipt</button>
                    ) : canCollect ? (
                      <button type="button" className="lv-btn lv-btn-sm lv-btn-dark" onClick={() => openModal("collect", { token: b.token, name: b.name, amount: b.amount })}>Collect</button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr><td colSpan={3}><b>Total for today (9 patients)</b></td><td colSpan={4} className="lv-right"><b>{money(total)}</b></td></tr></tfoot>
        </table>
      </div>
    );
  }
  const [head, ...rest] = billingTable(range, collected, clinic);
  const total = rest[rest.length - 1];
  return (
    <div className="lv-bill">
      <h3>{range === "week" ? "This week’s bills" : "This month’s bills"}</h3>
      <table>
        <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>
          {rest.slice(0, -1).map((r) => (
            <tr key={r[0]}>
              <td><b>{r[0]}</b></td>
              <td>{r[1]}</td>
              <td>{r[2]}</td>
              <td><b>{r[3]}</b></td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr>{total.map((c, i) => <td key={i}><b>{c}</b></td>)}</tr></tfoot>
      </table>
    </div>
  );
}

function Segment({ value }: { value: string }) {
  const update = useLive((s) => s.update);
  const items: ["today" | "week" | "month", string][] = [["today", "Today"], ["week", "This week"], ["month", "This month"]];
  return (
    <div className="lv-seg" role="tablist">
      {items.map(([k, label]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} className={value === k ? "is-on" : ""} onClick={() => update({ billingRange: k })}>{label}</button>
      ))}
    </div>
  );
}

function Row({ props }: { props: Record<string, unknown> }) {
  const p = props as { title: string; detail?: string; meta?: string; badge?: string; tone?: string };
  return (
    <div className={`lv-row lv-row-${p.tone ?? "plain"}`}>
      <div className="lv-row-text">
        <b>{p.title}</b>
        {p.detail && <span>{p.detail}</span>}
        {p.meta && <small>{p.meta}</small>}
      </div>
      {p.badge && <i className={`lv-pill ${p.tone === "warn" ? "lv-pill-amber" : "lv-pill-now"}`}>{p.badge}</i>}
    </div>
  );
}

// Two clicks on the ECG give the time between them. At 25 mm/s and the design's scale, 1 px is 8 ms.
function Measure({ w, h }: { w: number; h: number }) {
  const on = useLive((s) => s.filters.measure);
  // Unmounted while off, so turning it back on starts with no points.
  return on ? <MeasureArea w={w} h={h} /> : null;
}

function MeasureArea({ w, h }: { w: number; h: number }) {
  const [points, setPoints] = useState<number[]>([]);
  const pick = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * w;
    setPoints((p) => (p.length >= 2 ? [x] : [...p, x]));
  };
  const ms = points.length === 2 ? Math.round(Math.abs(points[1] - points[0]) * 8) : null;
  return (
    <div className="lv-measure" data-testid="measure" style={{ width: w, height: h }} onClick={pick}>
      {points.map((x, i) => <span key={i} className="lv-measure-line" style={{ left: x }} />)}
      {points.length === 2 && <span className="lv-measure-span" style={{ left: Math.min(...points), width: Math.abs(points[1] - points[0]) }} />}
      <b className="lv-measure-tag">
        {ms !== null ? `${ms} ms · ${Math.round(60000 / Math.max(ms, 1))} bpm if R to R` : points.length ? "Click the second point" : "Click the first point"}
      </b>
    </div>
  );
}

// Plays the explainer script aloud, with the bar moving through the 30 seconds.
function Player({ props, w }: { props: Record<string, unknown>; w: number }) {
  const lines = (props.lines as string[]) ?? [];
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (!playing) return;
    timer.current = window.setInterval(() => {
      setAt((a) => {
        if (a >= 30) {
          setPlaying(false);
          return 0;
        }
        return a + 0.25;
      });
    }, 250);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [playing]);
  useEffect(() => () => window.speechSynthesis?.cancel(), []);
  const toggle = () => {
    const synth = window.speechSynthesis;
    if (playing) {
      synth?.cancel();
      setPlaying(false);
      return;
    }
    if (synth && lines.length) {
      synth.cancel();
      const talk = new SpeechSynthesisUtterance(lines.join(" "));
      talk.lang = lines.join("").match(/[ഀ-ൿ]/) ? "ml-IN" : "en-IN";
      synth.speak(talk);
    }
    setPlaying(true);
  };
  const mm = `0:${String(Math.floor(at)).padStart(2, "0")}`;
  return (
    <div className="lv-player" style={{ width: w }}>
      <button type="button" aria-label={playing ? "Pause" : "Play"} onClick={toggle}>{playing ? "❚❚" : "▶"}</button>
      <input aria-label="Video position" type="range" min={0} max={30} step={0.25} value={at} onChange={(e) => setAt(Number(e.target.value))} />
      <span>{mm} / 0:30</span>
    </div>
  );
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// The finished explainer video, with the design's play button, bar and time under it.
function VideoPlayer({ props, w, h }: { props: Record<string, unknown>; w: number; h: number }) {
  const video = useRef<HTMLVideoElement>(null);
  const [at, setAt] = useState(0);
  const [length, setLength] = useState(30);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    // Opened by the card's play button, so it starts at once. If the browser blocks that, it waits for a click.
    video.current?.play().catch(() => undefined);
  }, []);
  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  };
  // Each language is its own design screen, so the subtitle and storyboard change along with the voice.
  const lang = props.lang as "en" | "ml";
  const switchLanguage = (code: "en" | "ml") => {
    if (code === lang) return;
    const to = props.other as string;
    runActions([{ k: useDesign.getState().overlays.length ? "swap" : "nav", to }], []);
  };
  return (
    <div className="lv-video" style={{ width: w, height: h }}>
      <video
        ref={video}
        src={props.src as string}
        poster={props.poster as string}
        preload="auto"
        playsInline
        aria-label="Explainer video: your heart tracing (ECG)"
        onClick={toggle}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setLength(e.currentTarget.duration)}
      />
      <div className="lv-player">
        <button type="button" aria-label={playing ? "Pause" : "Play"} onClick={toggle}>{playing ? "❚❚" : "▶"}</button>
        <input
          aria-label="Video position"
          type="range"
          min={0}
          max={length}
          step={0.1}
          value={at}
          onChange={(e) => {
            const t = Number(e.target.value);
            setAt(t);
            if (video.current) video.current.currentTime = t;
          }}
        />
        <span>{clock(at)} / {clock(length)}</span>
        <div className="lv-lang" role="group" aria-label="Video language">
          {(["en", "ml"] as const).map((code) => (
            <button
              key={code}
              type="button"
              lang={code}
              aria-pressed={lang === code}
              className={lang === code ? "on" : undefined}
              onClick={() => switchLanguage(code)}
            >
              {code === "en" ? "English" : "മലയാളം"}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function LiveWidget({ node, style }: { node: DesignNode; style: CSSProperties }) {
  const props = node.props ?? {};
  const body = (() => {
    switch (node.live) {
      case "calendar":
        return <CalendarPanel clinic={(props.clinic as "thanal" | "sahya") ?? "thanal"} month={props.month as string | undefined} />;
      case "billing":
        return <BillingCard range={props.range as "today" | "week" | "month"} clinic={props.clinic as "thanal" | "sahya"} />;
      case "segment":
        return <Segment value={props.value as string} />;
      case "row":
        return <Row props={props} />;
      case "measure":
        return <Measure w={node.w} h={node.h} />;
      case "player":
        return <Player props={props} w={node.w} />;
      case "video":
        return <VideoPlayer props={props} w={node.w} h={node.h} />;
      default:
        return null;
    }
  })();
  return <div style={style} data-nid={node.id}>{body}</div>;
}

