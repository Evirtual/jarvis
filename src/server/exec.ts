/**
 * Run a system command and take what it printed. The readings are best
 * effort: a command that is missing, fails or runs past its time gives an
 * empty answer, and the reading that asked for it shows as unknown.
 */

import { execFile } from "node:child_process";

export function exec(cmd: string, args: string[], timeout = 5000): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout, maxBuffer: 1 << 22 }, (err, stdout) =>
      resolve(err ? "" : String(stdout)),
    );
  });
}
