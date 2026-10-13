/** A rectangle in iOS points (the simulator's accessibility frames). */
export interface Box { x: number; y: number; w: number; h: number }

/** One step of the capture: when it happened in sim.mp4 (s) and the element it acted on or waited for. */
export interface Mark { id: string; t: number; box?: Box }

export interface Timeline {
  /** sim.mp4 size in pixels and the screen size in points (pixels = points × scale) */
  video: { width: number; height: number; duration: number };
  screen: { width: number; height: number };
  marks: Mark[];
  /** the gnoweb shot, relative to out/, when one was taken */
  gnoweb?: string;
}

/** A piece of gnokey-pair's terminal output, t in sim.mp4 seconds. */
export interface TermChunk { t: number; text: string }

/** Narration per scene: the wav (relative to out/) and its length in seconds. */
export type Durations = Record<string, { file: string; seconds: number }>;

export type Match = string | RegExp;

export type Action =
  | { tap: Match; enabled?: boolean; timeout?: number }
  | { type: string; into: Match }
  | { clear: Match; count: number }
  | { waitFor: Match; timeout?: number; enabled?: boolean }
  | { swipe: [number, number, number, number] }
  | { launch: 'app' | 'wallet' }
  | { bob: string }
  | { computer: 'sign' }
  | { pause: number }
  | { gnoweb: string };

/** A step; `mark: true` records it in the timeline as `<scene>.<id>`. */
export interface Step { id: string; do: Action; mark?: boolean }

export type Show = 'card' | 'phone' | 'phone+terminal' | 'browser';

export interface Scene {
  id: string;
  show: Show;
  /** the narration, or none */
  voice?: string;
  /** shown one after the other over the scene */
  captions: string[];
  /** for 'card' */
  card?: { title: string; sub?: string; lines?: string[] };
  /** for phone scenes: the steps filmed; the clip runs from the first mark to the last */
  steps?: Step[];
  /** step ids whose box the camera zooms to when they happen */
  zoomOn?: string[];
}

export interface Script { voice: string; setup: Step[]; scenes: Scene[] }

/** Camera state from frame `f` (scene-relative) on: scale ≥ 1, centre in 0..1 of the phone screen. */
export interface ZoomKey { f: number; scale: number; cx: number; cy: number }

export interface CaptionCue { text: string; from: number; duration: number }

export interface EdlScene {
  id: string;
  show: Show;
  /** composition frames */
  from: number;
  duration: number;
  card?: Scene['card'];
  /** for phone scenes: the source clip in sim.mp4 */
  clip?: { start: number; end: number; rate: number; holdFrames: number };
  zoom: ZoomKey[];
  captions: CaptionCue[];
  voice?: { src: string; from: number };
  /** terminal output for this scene, t already mapped to scene frames */
  terminal?: { f: number; text: string }[];
  gnoweb?: string;
}

// a type, not an interface: Remotion's props must be assignable to Record<string, unknown>
export type Edl = {
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  video: Timeline['video'];
  screen: Timeline['screen'];
  scenes: EdlScene[];
};
