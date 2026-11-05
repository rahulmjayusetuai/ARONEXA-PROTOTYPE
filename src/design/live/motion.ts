import { flushSync } from "react-dom";
import type { Transition } from "../types";

// The design's 150 to 200ms fades read as a jump on a full page, so screens never change faster than these.
const FADE_MS = 320;
const MOVE_MS = 380;
const LEAVE_MS = 260;
const SOFTEN_MS = 240;

export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// A screen change: a cross-fade, or the new screen sliding in over the old one.
export function playScreenChange(change: () => void, tr?: Transition) {
  if (reducedMotion() || !document.startViewTransition) return change();
  const moved = tr?.t === "m" ? tr.dir : undefined;
  const root = document.documentElement;
  root.style.setProperty("--fg-nav-ms", `${Math.max(tr?.ms ?? 0, moved ? MOVE_MS : FADE_MS)}ms`);
  root.style.setProperty("--fg-from-x", moved === "LEFT" ? "100%" : moved === "RIGHT" ? "-100%" : "0");
  root.style.setProperty("--fg-from-y", moved === "TOP" ? "100%" : moved === "BOTTOM" ? "-100%" : "0");
  root.dataset.fgNav = moved ? "move" : "fade";
  document.startViewTransition(() => flushSync(change));
}

// Copies open scrolled to the top, which would make a long panel jump as it fades.
function matchScroll(from: HTMLElement, copy: HTMLElement) {
  const originals = [from, ...from.querySelectorAll<HTMLElement>("*")];
  const copies = [copy, ...copy.querySelectorAll<HTMLElement>("*")];
  originals.forEach((el, i) => {
    if (el.scrollTop) copies[i].scrollTop = el.scrollTop;
  });
}

const CONTENT = ".fg-page, .fg-calendar-layer > div, .fg-modal > div";
let softening = false;

// Call when data is about to change what's on the page, before React redraws it. A copy of the
// current content fades away over the new content, so every kind of change cross-fades the same.
export function softenContent() {
  const active = document.activeElement;
  const typing = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
  // Several changes from one click share a fade, and text must not flicker on every keystroke.
  if (softening || typing || reducedMotion()) return;
  softening = true;
  window.setTimeout(() => {
    softening = false;
  });
  document.querySelectorAll<HTMLElement>(CONTENT).forEach((box) => {
    box.querySelector(":scope > .fg-soft-copy")?.remove();
    const from = box.firstElementChild as HTMLElement | null;
    if (!from) return;
    const copy = from.cloneNode(true) as HTMLElement;
    copy.classList.add("fg-soft-copy");
    copy.setAttribute("aria-hidden", "true");
    copy.inert = true;
    box.append(copy);
    matchScroll(from, copy);
    window.setTimeout(() => copy.remove(), SOFTEN_MS);
  });
}

// React has already been told to remove this element, so a copy of it plays the exit.
// Copying means a pop-up that is closing can't re-render against data it has just changed.
export function playLeave(target: string | HTMLElement, swapped = false) {
  const from = typeof target === "string" ? document.querySelector<HTMLElement>(target) : target;
  if (!from || reducedMotion()) return;
  const copy = from.cloneNode(true) as HTMLElement;
  copy.removeAttribute("data-ov");
  copy.classList.add("is-leaving");
  if (swapped) copy.classList.add("is-swapped");
  copy.style.animationDuration = "";
  copy.setAttribute("aria-hidden", "true");
  copy.inert = true;
  document.body.append(copy);
  matchScroll(from, copy);
  window.setTimeout(() => copy.remove(), LEAVE_MS);
}
