import { useCallback, useEffect, useRef, useState } from "react";
import type { ThingDocument, ThingDraft } from "@wikitop/shared";
import { api, ApiError, uid } from "./api";
export function useThingDraft(rootId: string, accountId: string) {
  const [draft, setDraft] = useState<ThingDraft>(),
    [document, setDocument] = useState<ThingDocument>(),
    [status, setStatus] = useState("Loading"),
    [error, setError] = useState("");
  const current = useRef<ThingDocument>(),
    server = useRef<ThingDraft>(),
    baseline = useRef(""),
    paused = useRef(false),
    active = useRef(true);
  const saving = useRef<Promise<void>>(),
    attempt = useRef<{
      document: ThingDocument;
      revision: string;
      operationId: string;
    }>();
  const retryTimer = useRef<ReturnType<typeof setTimeout>>(),
    retryCount = useRef(0),
    flushRef = useRef<() => Promise<void>>(async () => {});
  const key = `wikitop-draft:${accountId}:${rootId}`;
  const cache = () => {
    try {
      if (current.current && server.current?.canEdit) {
        if (JSON.stringify(current.current) === baseline.current)
          localStorage.removeItem(key);
        else
          localStorage.setItem(
            key,
            JSON.stringify({
              revision: server.current.revision,
              document: current.current,
            }),
          );
      }
    } catch {
      /* Remote saving remains available when local storage is full. */
    }
  };
  const load = useCallback(async () => {
    const result = await api<ThingDraft>(`/api/things/${rootId}/document`);
    if (!active.current) return;
    server.current = result;
    baseline.current = JSON.stringify(result.document);
    let value = result.document;
    paused.current = false;
    attempt.current = undefined;
    try {
      const raw = localStorage.getItem(key);
      if (raw && result.canEdit) {
        const cached = JSON.parse(raw);
        if (
          cached.document?.rootId === rootId &&
          cached.document.nodes?.[rootId]
        ) {
          value = cached.document;
          if (cached.revision !== result.revision) {
            paused.current = true;
            setStatus("Conflict");
            setError(
              "A local draft and a newer server draft both exist. Copy your local document before reloading.",
            );
          } else setStatus("Recovered local draft");
        }
      }
    } catch {
      /* Ignore invalid browser recovery data. */
    }
    current.current = value;
    setDocument(value);
    setDraft(result);
    if (!paused.current && value === result.document) setStatus("Saved");
  }, [rootId, key]);
  const flush = useCallback(async () => {
    if (saving.current) return saving.current;
    if (!server.current?.canEdit || !current.current || paused.current) return;
    const task = async () => {
      while (
        current.current &&
        JSON.stringify(current.current) !== baseline.current &&
        !paused.current
      ) {
        const request = attempt.current ?? {
          document: structuredClone(current.current),
          revision: server.current!.revision,
          operationId: uid(),
        };
        attempt.current = request;
        cache();
        setStatus("Saving");
        setError("");
        try {
          const result = await api<ThingDraft>(
            `/api/things/${rootId}/document`,
            "PUT",
            request,
          );
          const unchanged =
            JSON.stringify(current.current) ===
            JSON.stringify(request.document);
          server.current = result;
          baseline.current = JSON.stringify(result.document);
          attempt.current = undefined;
          retryCount.current = 0;
          if (retryTimer.current) {
            clearTimeout(retryTimer.current);
            retryTimer.current = undefined;
          }
          if (unchanged) {
            current.current = result.document;
            if (active.current) setDocument(result.document);
          }
          if (active.current) setDraft(result);
          cache();
          if (active.current)
            setStatus(
              JSON.stringify(current.current) === baseline.current
                ? "Saved"
                : "Unsaved",
            );
        } catch (e) {
          const err = e as ApiError;
          if (err.status === 409) {
            paused.current = true;
            setStatus("Conflict");
          } else if (err.status && err.status < 500) {
            attempt.current = undefined;
            setStatus("Could not save");
          } else {
            setStatus("Offline");
            if (active.current && !retryTimer.current)
              retryTimer.current = setTimeout(
                () => {
                  retryTimer.current = undefined;
                  void flushRef.current();
                },
                Math.min(30000, 1000 * 2 ** Math.min(5, retryCount.current++)),
              );
          }
          setError(err.message);
          cache();
          return;
        }
      }
    };
    saving.current = task().finally(() => {
      saving.current = undefined;
    });
    return saving.current;
  }, [rootId, key]);
  flushRef.current = flush;
  useEffect(() => {
    active.current = true;
    void load().catch((e) => {
      setError(e.message);
      setStatus("Unavailable");
    });
    return () => {
      active.current = false;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      cache();
      void flush();
    };
  }, [load, flush]);
  useEffect(() => {
    if (
      !document ||
      !draft?.canEdit ||
      paused.current ||
      JSON.stringify(document) === baseline.current
    )
      return;
    cache();
    setStatus("Unsaved");
    const timer = setTimeout(() => void flush(), 800);
    return () => clearTimeout(timer);
  }, [document, draft?.canEdit, flush]);
  useEffect(() => {
    const retry = () => void flush();
    const unload = (event: BeforeUnloadEvent) => {
      if (
        current.current &&
        JSON.stringify(current.current) !== baseline.current
      ) {
        cache();
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("online", retry);
    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener("online", retry);
      window.removeEventListener("beforeunload", unload);
    };
  }, [flush]);
  const change = (edit: (doc: ThingDocument) => void) => {
    if (!server.current?.canEdit || !current.current) return;
    const next = structuredClone(current.current);
    edit(next);
    current.current = next;
    setDocument(next);
    cache();
  };
  const reload = async () => {
    if (current.current)
      try {
        localStorage.setItem(
          `${key}:conflict-backup`,
          JSON.stringify(current.current),
        );
        localStorage.removeItem(key);
      } catch {}
    setError("");
    await load();
  };
  return {
    draft,
    document,
    status,
    error,
    change,
    flush,
    reload,
    isClean: () =>
      !!current.current &&
      !paused.current &&
      JSON.stringify(current.current) === baseline.current,
  };
}
