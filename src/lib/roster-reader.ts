import type { RosterFileResult } from "./roster-parser";

/** Ephemeral worker: file contents never enter storage or the server. */
export function readRosterFile(file: File, includeNationalId = false): Promise<RosterFileResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./roster-reader.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ result?: RosterFileResult; error?: string }>) => {
      worker.terminate();
      if (event.data.result) resolve(event.data.result);
      else reject(new Error(event.data.error ?? "Could not read roster file."));
    };
    worker.onerror = () => { worker.terminate(); reject(new Error("Could not read roster file.")); };
    worker.postMessage({ file, includeNationalId });
  });
}