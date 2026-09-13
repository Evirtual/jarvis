/**
 * The one thing that runs on import, on purpose: a setting kept under an
 * older name is moved to its current one before any module reads it.
 * main.ts imports this first.
 */

import { migrateStorage } from "./storage.js";

migrateStorage();
