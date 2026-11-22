export type Paint =
  | { k: "s"; c: string }
  | { k: "g"; v: string }
  | { k: "i"; r: string; m?: string; o?: number; x?: number[] }
  | { k: "u"; url: string };

export type Transition = { t: "d" | "m" | "s"; ms: number; dir?: "LEFT" | "RIGHT" | "TOP" | "BOTTOM" };

export type Action =
  | { k: "nav" | "ov" | "swap" | "var"; to: string; tr?: Transition }
  | { k: "close" | "back" }
  | { k: "set"; v: string }
  | { k: "url"; to: string }
  | { k: "fx"; fx: string; arg?: string };

export type Interaction = {
  on: "click" | "enter" | "leave" | "hover" | "timeout";
  ms?: number;
  acts: Action[];
};

export type TextRun = {
  f?: string;
  s?: number;
  w?: number;
  lh?: number;
  ls?: number;
  d?: string;
  c?: string;
  i?: boolean;
  p?: Paint[];
};

export type TextStyle = TextRun & {
  v: string;
  a?: string;
  va?: string;
  r?: string;
  o?: number[];
  t?: Record<string, TextRun>;
  vb?: string;
  ov?: number;
};

export type DesignNode = {
  id: string;
  t: "F" | "I" | "C" | "E" | "T";
  x: number;
  y: number;
  w: number;
  h: number;
  n?: string;
  ro?: number;
  o?: number;
  b?: string;
  cid?: string;
  g?: string;
  sw?: number;
  sv?: number[];
  rb?: number[];
  p?: Paint[];
  k?: { p: Paint; w: number; a: string; s?: number[]; d?: number[] };
  r?: number | number[];
  sh?: string;
  bl?: number;
  c?: number;
  sc?: string;
  a?: Interaction[];
  tx?: TextStyle;
  ch?: DesignNode[];
  live?: string;
  props?: Record<string, unknown>;
  drop?: number;
  role?: string;
  pressed?: boolean;
  anim?: string;
  ms?: number;
};

export type Area = "patient" | "pharmacy" | "clinic" | "lab" | "rider" | "team" | "partner";

export type Screen = {
  id: string;
  name: string;
  slug: string;
  w: number;
  h: number;
  file: string;
  module?: Area;
};

export type Manifest = {
  start: string;
  patientStart: string;
  // Each area beyond the doctor and patient apps: its sign-in page and its home page.
  areas: Record<string, { start: string; home: string }>;
  screens: Screen[];
  compSets: Record<string, string>;
  images: Record<string, string>;
  nodes: string[];
};

export type InstanceRef = { id: string; cid?: string };
