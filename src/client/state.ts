/**
 * The console's singletons — the stage, the workspace, the instruments, the
 * voice, the connections — made once here and shared by every module. This
 * module imports nothing from the rest of the console, so it is always ready
 * before anything that needs it.
 */

import { Hud } from "./canvas.js";
import { Connections } from "./connections.js";
import { $ } from "./dom.js";
import { Panels } from "./panels.js";
import { Stage } from "./stage.js";
import { Voice } from "./voice.js";

export const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const voice = new Voice();
export const conn = new Connections();
export const graph = new Stage($("stage"), $<HTMLCanvasElement>("graph"), $("windows"));
export const ws = graph.ws;
export const hud = new Hud($<HTMLCanvasElement>("radar"));
export const panels = new Panels($("overlays"));

/** The command line. */
export const input = $<HTMLInputElement>("input");
