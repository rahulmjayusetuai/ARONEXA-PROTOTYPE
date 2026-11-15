"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog } from "./Modals";
import { playLeave } from "./motion";

export type GuideArea = "doctor" | "patient" | "pharmacy" | "clinic" | "lab";
type Area = GuideArea;

const VIDEO: Record<Area, { title: string; sub: string }> = {
  doctor: { title: "Welcome to AroNexa", sub: "A one-minute look at the doctor’s side" },
  patient: { title: "Welcome to AroNexa", sub: "A one-minute look at the patient’s side" },
  pharmacy: { title: "Welcome to AroNexa for pharmacies", sub: "A one-minute look around" },
  clinic: { title: "Welcome to AroNexa for clinics", sub: "A one-minute look at reception and the clinic admin" },
  lab: { title: "Welcome to AroNexa for labs", sub: "A one-minute look at the lab and the pathologist’s side" },
};

const SHOW_AFTER_MS = 600;

// A new key, so people who saw the old step-by-step tour still get the video once.
const keyFor = (area: Area) => `aronexa-video-guide-seen-${area}`;

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
    // Blocked storage only means the video shows again next visit.
  }
}

// Shown the first time a browser gets past sign-in on each side: doctor, patient, pharmacy, clinic and lab.
export function Guide({ area, entered }: { area: Area; entered: boolean }) {
  const [open, setOpen] = useState(false);
  // Every side but the doctor’s also has a Malayalam version, in the same voice as the patient one.
  const [lang, setLang] = useState<"en" | "ml">("en");
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!entered) return;
    // Lets the first page settle, so the video arrives over a finished screen.
    const timer = window.setTimeout(() => {
      if (!seenBefore(area)) setOpen(true);
    }, SHOW_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [area, entered]);

  useEffect(() => {
    if (!open) return;
    // Sign-in was a click, so most browsers let it play with sound. If not, the play button is there.
    video.current?.play().catch(() => {});
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      finish();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function finish() {
    video.current?.pause();
    remember(area);
    playLeave(".lv-guide");
    setOpen(false);
  }

  // After the first visit the video stays one click away.
  if (!open)
    return entered ? (
      <button type="button" className="lv-guide-open" onClick={() => setOpen(true)}>
        <span aria-hidden="true">▶</span> Guide video
      </button>
    ) : null;
  const { title, sub } = VIDEO[area];
  const bilingual = area !== "doctor";
  const file = bilingual && lang === "ml" ? `${area}-ml` : area;
  const pick = (next: "en" | "ml") => {
    if (next === lang) return;
    setLang(next);
    // The new source loads paused, so keep it playing like the one it replaced.
    window.setTimeout(() => video.current?.play().catch(() => {}), 0);
  };
  return (
    <Dialog
      className="lv-guide"
      title={title}
      sub={sub}
      onClose={finish}
      foot={
        <>
          <button type="button" className="lv-btn lv-guide-skip" onClick={finish}>Skip</button>
          {bilingual && (
            <div className="lv-chips lv-guide-lang" role="group" aria-label="Video language">
              {(["en", "ml"] as const).map((l) => (
                <button type="button" key={l} aria-pressed={lang === l} className={`lv-chip${lang === l ? " is-on" : ""}`} onClick={() => pick(l)}>
                  {l === "en" ? "English" : "മലയാളം"}
                </button>
              ))}
            </div>
          )}
          <button type="button" className="lv-btn lv-btn-dark" autoFocus onClick={finish}>Start exploring</button>
        </>
      }
    >
      <video
        ref={video}
        className="lv-guide-video"
        src={`/video/guide-${file}.mp4`}
        poster={`/video/guide-${file}.jpg`}
        controls
        playsInline
        preload="auto"
        onEnded={() => remember(area)}
      >
        <track key={file} kind="captions" src={`/video/guide-${file}.vtt`} srcLang={lang} label={lang === "ml" ? "മലയാളം" : "English"} default />
      </video>
    </Dialog>
  );
}
