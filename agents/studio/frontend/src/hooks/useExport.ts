// Day 24: useExport — a small hook that wraps the export
// client and exposes a typed API to UI components. The hook
// reads the JWT token from localStorage so the resulting
// media URL works in an HTML5 <video> element (which cannot
// set Authorization headers).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createExportClient } from "../exportClient";

const TOKEN_KEYS = ["vireo_token", "vireo.auth.token"];

function readToken(): string | null {
  if (typeof window === "undefined") return null;
  for (const k of TOKEN_KEYS) {
    const v = window.localStorage.getItem(k);
    if (v) return v;
  }
  return null;
}

export type ExportState = {
  jobId: string | null;
  status: "idle" | "queued" | "running" | "done" | "failed";
  progress: number;
  outputPath: string | null;
  mediaUrl: string | null;
  realEncode: boolean;
  error: string | null;
};

export function useExport() {
  const client = useMemo(() => createExportClient(), []);
  const [token, setToken] = useState<string | null>(() => readToken());
  const [state, setState] = useState<ExportState>({
    jobId: null,
    status: "idle",
    progress: 0,
    outputPath: null,
    mediaUrl: null,
    realEncode: true,
    error: null,
  });
  const pollTimer = useRef<number | null>(null);

  // Keep the token fresh if it changes in another tab.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key && TOKEN_KEYS.includes(e.key)) setToken(readToken());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const clearPoll = useCallback(() => {
    if (pollTimer.current !== null) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    clearPoll();
    setState({
      jobId: null,
      status: "idle",
      progress: 0,
      outputPath: null,
      mediaUrl: null,
      realEncode: true,
      error: null,
    });
  }, [clearPoll]);

  const pollUntilDone = useCallback(
    async (jobId: string) => {
      clearPoll();
      const tick = async () => {
        try {
          const res = await client.pollExport(jobId);
          if (!res.ok || !res.job) return;
          const j: any = res.job;
          const status = j.state || j.status;
          if (status === "done") {
            clearPoll();
            // For D24 real_encode, the path is on j.output_path
            // (or in result.metadata.path). For D18 simulated,
            // it's on result.path.
            const outputPath =
              j.output_path ||
              j.result?.metadata?.path ||
              j.result?.path ||
              null;
            setState((s) => ({
              ...s,
              status: "done",
              progress: 100,
              outputPath,
              mediaUrl: client.getMediaUrl(jobId, token),
            }));
            return;
          }
          if (status === "failed") {
            clearPoll();
            setState((s) => ({
              ...s,
              status: "failed",
              error: j.error || "export failed",
            }));
            return;
          }
          setState((s) => ({
            ...s,
            status: status === "queued" ? "queued" : "running",
            progress: Number(j.progress || s.progress || 0),
          }));
        } catch (e) {
          clearPoll();
          setState((s) => ({
            ...s,
            status: "failed",
            error: e instanceof Error ? e.message : String(e),
          }));
        }
      };
      await tick();
      if (state.status === "done" || state.status === "failed") return;
      pollTimer.current = window.setInterval(tick, 1500);
    },
    [client, clearPoll, token]
  );

  const start = useCallback(
    async (projectId: string, presetId: string, baseVersion: number, realEncode: boolean = true) => {
      clearPoll();
      setState((s) => ({
        ...s,
        status: "queued",
        progress: 0,
        error: null,
        realEncode,
        mediaUrl: null,
        jobId: null,
        outputPath: null,
      }));
      try {
        const res = await client.enqueueExport({
          projectId,
          presetId,
          baseVersion,
          actor: "human",
          real_encode: realEncode,
        });
        if (!res.ok || !res.job) {
          setState((s) => ({ ...s, status: "failed", error: "enqueue failed" }));
          return;
        }
        const job: any = res.job;
        setState((s) => ({ ...s, jobId: job.id }));
        await pollUntilDone(job.id);
      } catch (e) {
        setState((s) => ({
          ...s,
          status: "failed",
          error: e instanceof Error ? e.message : String(e),
        }));
      }
    },
    [client, pollUntilDone, clearPoll]
  );

  return { state, start, reset, token };
}
