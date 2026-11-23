// © 2026 Farid Asnawi. All rights reserved. Proprietary. See LICENSE.
import type { RosterFileResult } from "./roster-parser";
import type { SpareFile } from "./bulk-spare-key";

/** Ephemeral worker: file contents never enter storage or the server. */
export function readRosterFile(file: File, includeNationalId = false): Promise<RosterFileResult> {
  return readFile<RosterFileResult>(file, includeNationalId);
}

export function readSpareStatusFile(file: File): Promise<SpareFile> {
  return readFile<SpareFile>(file, false, "spare-status");
}

function readFile<T>(file: File, includeNationalId: boolean, mode = "roster"): Promise<T> {
  if (mode === "spare-status" && file.size > 20 * 1024 * 1024) return Promise.reject(new Error("File exceeds the 20 MB limit."));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./roster-reader.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ result?: T; error?: string }>) => {
      worker.terminate();
      if (event.data.result) resolve(event.data.result);
      else reject(new Error(event.data.error ?? "Could not read roster file."));
    };
    worker.onerror = () => { worker.terminate(); reject(new Error("Could not read roster file.")); };
    worker.postMessage({ file, includeNationalId, mode });
  });
}