"use client";

import { useEffect, useMemo, useState } from "react";
import { Guide, type GuideArea } from "./live/Guide";
import { LiveModals } from "./live/Modals";
import { playLeave, softenContent } from "./live/motion";
import { restoreLive, useLive } from "./live/state";
import { liveDoc, liveKey } from "./live/transform";
import { reflow } from "./mobile";
import { NodeView } from "./Node";
import { load, loaded, manifest, screensById, screensBySlug, showFromHistory, useDesign, type Overlay } from "./store";
import type { DesignNode, InstanceRef } from "./types";

const NO_ANCESTORS: InstanceRef[] = [];

// Below this width the page is rearranged for a phone instead of shrunk.
const PHONE = 760;
function usePhoneWidth() {
  const [w, setW] = useState<number | null>(null);
  useEffect(() => {
    const update = () => {
      // ?phone=390 forces a phone width, for checking the layout on a computer.
      const forced = Number(new URLSearchParams(window.location.search).get("phone")) || 0;
      const cw = forced || document.documentElement.clientWidth;
      setW(cw < PHONE ? cw : null);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return w;
}

// Tells phone visitors the full experience is on a computer; closing it lasts for the visit.
function PhoneNote() {
  // Only shown once the phone width is known in the browser, so storage can be read here.
  const [open, setOpen] = useState(() => {
    try {
      return sessionStorage.getItem("aronexa-phone-note") !== "closed";
    } catch {
      return true;
    }
  });
  if (!open) return null;
  const close = () => {
    setOpen(false);
    try {
      sessionStorage.setItem("aronexa-phone-note", "closed");
    } catch {}
  };
  return (
    <div className="fg-phone-note" role="status">
      <span>AroNexa is designed for computers. For the full experience, open this link on a laptop or desktop.</span>
      <button type="button" aria-label="Close" onClick={close}>✕</button>
    </div>
  );
}

function useZoom() {
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const update = () => setZoom(document.documentElement.clientWidth / 1440);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return zoom;
}

const GUIDED: GuideArea[] = ["doctor", "patient", "pharmacy", "clinic", "lab"];

// The partner area holds three portals, and each has its own guide.
function partnerGuide(screenName: string): GuideArea | null {
  const role = /^(Insurer|Dealer|Seller) web/.exec(screenName)?.[1];
  return role ? (role.toLowerCase() as GuideArea) : null;
}

function screenFromPath(path: string) {
  const [area, slug] = path.split("/").filter(Boolean);
  const start = area === "patient" ? manifest.patientStart : (manifest.areas[area]?.start ?? manifest.start);
  return (slug && screensBySlug.get(slug)?.id) || start;
}

// The design plus the doctor's changes, rebuilt only when those changes affect what's drawn.
function useLiveDoc(id: string) {
  const key = useLive(liveKey);
  const doc = loaded.get(id);
  const name = screensById.get(id)?.name ?? "";
  return useMemo(() => {
    void key;
    return doc ? liveDoc(doc, name, useLive.getState()) : undefined;
  }, [doc, name, key]);
}

// Only the calendar's own layers, for showing over a real page instead of the design's stand-in.
function calendarLayer(doc: DesignNode) {
  const layers = doc.ch ?? [];
  const panel = layers.findIndex((c) => c.live === "calendar");
  if (panel < 0) return null;
  const { y, h } = layers[panel];
  // The layer clips this to the window, however tall the window is.
  const dim = { ...layers[panel - 1], h: 4000 };
  return { node: { ...doc, x: 0, y: 0, h: 4000, p: undefined, c: undefined, ch: [dim, layers[panel]] }, height: y * 2 + h };
}

// Everything in the demo's data that changes what's drawn on the page.
const shownData = (s: ReturnType<typeof useLive.getState>) =>
  JSON.stringify([liveKey(s), s.texts, s.theme, s.calDate, s.calMonth, s.filters.reveal]);

const isToast = (id: string) => /^(P|Ph|Rc|Ca|Lb|Pa|Pl|Sp|In|Dl|Sl|Rider)?Toast/.test(screensById.get(id)?.name ?? "");

function OverlayView({ overlay, zoom, phone }: { overlay: Overlay; zoom: number; phone: number | null }) {
  const closeOverlay = useDesign((s) => s.closeOverlay);
  const raw = useLiveDoc(overlay.id);
  const toast = isToast(overlay.id);
  const node = useMemo(() => (raw && phone ? reflow(raw, phone - 24) : raw), [raw, phone]);
  if (!node) return null;
  const view = { ...node, x: 0, y: 0 };
  if (toast) {
    return (
      <div className="fg-toast" data-ov={overlay.key} style={{ zoom, animationDuration: `${overlay.ms}ms` }}>
        <div style={{ position: "relative", width: node.w, height: node.h }}>
          <NodeView node={view} ancestors={NO_ANCESTORS} overlay={overlay.key} />
        </div>
      </div>
    );
  }
  return (
    <div className={overlay.replaces ? "fg-backdrop is-swap" : "fg-backdrop"} data-ov={overlay.key} style={{ animationDuration: `${overlay.ms}ms` }} onClick={() => closeOverlay(overlay.key)}>
      <div className="fg-modal" style={{ width: node.w * zoom, height: node.h * zoom }} onClick={(e) => e.stopPropagation()}>
        <div style={{ zoom, position: "relative", width: node.w, height: node.h }}>
          <NodeView node={view} ancestors={NO_ANCESTORS} overlay={overlay.key} />
        </div>
      </div>
    </div>
  );
}

export function DesignApp({ path }: { path: string }) {
  const screen = useDesign((s) => s.screen);
  const behind = useDesign((s) => s.behind);
  const overlays = useDesign((s) => s.overlays);
  const notice = useDesign((s) => s.notice);
  const setNotice = useDesign((s) => s.setNotice);
  const fullZoom = useZoom();
  const phone = usePhoneWidth();
  const [ready, setReady] = useState<string | null>(null);
  const theme = useLive((s) => s.theme);

  useEffect(() => {
    restoreLive();
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("fg-dark", theme === "Dark");
  }, [theme]);


  useEffect(() => {
    const first = screenFromPath(path);
    // A reload stays on the calendar with the same page behind it.
    const under = (window.history.state as { behind?: string | null } | null)?.behind ?? null;
    void Promise.all([load(first), under && load(under)]).then(() => {
      useDesign.getState().setScreen(first, under);
      setReady(first);
    });
    const onPop = () => showFromHistory(screenFromPath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [path]);

  // These run before React removes anything, so the closing pop-up can still be copied.
  useEffect(() => {
    const stopDesign = useDesign.subscribe((s, prev) => {
      if (prev.notice && !s.notice) playLeave(".fg-notice:not(.is-leaving)");
      if (s.screen === prev.screen && (s.vars !== prev.vars || s.values !== prev.values)) softenContent();
      // A new screen cross-fades as a whole, closing pop-ups included.
      if (s.screen !== prev.screen) return;
      for (const o of prev.overlays) {
        if (!s.overlays.some((n) => n.key === o.key)) {
          // A toast has no dimmed page of its own, so the old pop-up's has to fade out.
          const next = s.overlays.find((n) => n.replaces === o.key);
          playLeave(`[data-ov="${o.key}"]`, Boolean(next && !isToast(next.id)));
        }
      }
    });
    const stopLive = useLive.subscribe((s, prev) => {
      if (prev.modal && s.modal?.name !== prev.modal.name) playLeave(".lv-backdrop:not(.is-leaving)");
      // Compared by value, as other tabs keep sending back identical data in new objects.
      if (shownData(s) !== shownData(prev)) softenContent();
    });
    return () => {
      stopDesign();
      stopLive();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") useDesign.getState().closeOverlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(t);
  }, [notice, setNotice]);

  useEffect(() => {
    const name = screensById.get(screen)?.name;
    if (name) document.title = `${name} | AroNexa`;
  }, [screen]);

  const doc = useLiveDoc(ready ? screen : "");
  const behindDoc = useLiveDoc(ready && behind ? behind : "");
  const calendar = behindDoc && doc ? calendarLayer(doc) : null;
  const pageId = calendar ? behind! : screen;
  const pageDoc = calendar ? behindDoc : doc;
  const size = screensById.get(pageId);
  // The rider app is a phone design, so it keeps its own size instead of filling a wide window.
  const desktopZoom = size && size.w < 600 ? Math.min(1, (fullZoom * 1440) / size.w) : fullZoom;
  const zoom = phone ? 1 : desktopZoom;
  const shownDoc = useMemo(() => (pageDoc && phone ? reflow(pageDoc, phone) : pageDoc), [pageDoc, phone]);
  const calNode = useMemo(() => (calendar && phone ? reflow(calendar.node, phone) : calendar?.node), [calendar, phone]);
  if (!pageDoc || !size || !shownDoc) return <div className="fg-loading">Loading…</div>;
  const area = screensById.get(screen)?.module ?? "doctor";
  // Rider and team have no guide video yet.
  const guideArea = area === "partner" ? partnerGuide(screensById.get(screen)?.name ?? "") : GUIDED.includes(area as GuideArea) ? (area as GuideArea) : null;

  return (
    <>
      {/* Keyed by page, so opening the calendar over a page doesn't rebuild that page. */}
      <div className="fg-page" inert={Boolean(calendar)} style={{ zoom, position: "relative", width: phone ? shownDoc.w : size.w, height: shownDoc.h, margin: "0 auto" }} data-screen={screensById.get(screen)?.slug}>
        <NodeView key={pageId} node={shownDoc} ancestors={NO_ANCESTORS} />
      </div>
      {calendar && (
        <div className="fg-calendar-layer">
          <div style={{ zoom, position: "relative", overflow: "hidden", width: phone ? calNode!.w : size.w, height: phone ? calNode!.h : calendar.height, minHeight: `calc(100dvh / ${zoom})`, margin: "0 auto" }}>
            <NodeView node={calNode!} ancestors={NO_ANCESTORS} />
          </div>
        </div>
      )}
      {overlays.map((o) => (
        <OverlayView key={o.key} overlay={o} zoom={zoom} phone={phone} />
      ))}
      <LiveModals />
      {guideArea && (
        <Guide
          area={guideArea}
          entered={!/^(Login|Register|Patient sign up|Pharmacy register|Lab register|Clinic invite)/.test(screensById.get(screen)?.name ?? "")}
        />
      )}
      {notice && <div className="fg-notice" role="status">{notice}</div>}
      {phone && <PhoneNote />}
    </>
  );
}
