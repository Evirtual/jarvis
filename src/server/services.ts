/**
 * The console's back end, as the server runs it: the shared core
 * (shared/services/console.ts) with its keys in config.json.
 */

import { ConsoleCore } from "../shared/services/console.js";
import { getActive, getModel, resolveKey } from "./config.js";

export { PROVIDERS, SPEECH_RATE } from "../shared/services/index.js";
export { CoreError } from "../shared/services/console.js";

export const core = new ConsoleCore({ key: resolveKey, model: getModel, active: getActive });
