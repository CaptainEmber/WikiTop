import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { Socket } from "socket.io-client";
import type { DrawingStroke, PlaySnapshot, ThingDraft } from "@wikitop/shared";
import type { DrawingInteraction, InkPreview } from "./DrawingLayer";
import { api, uid } from "./api";
export function useDrawing(
  socket: MutableRefObject<Socket | undefined>,
  snapshot: PlaySnapshot | undefined,
) {
  const [active, setActive] = useState(false),
    [tool, setTool] = useState<"pen" | "eraser">("pen"),
    [color, setColor] = useState("#f3c969"),
    [width, setWidth] = useState(0.08),
    [previews, setPreviews] = useState<InkPreview[]>([]),
    [notice, setNotice] = useState(""),
    [saving, setSaving] = useState(false);
  const current = useRef(snapshot);
  current.current = snapshot;
  const previewOffset = useRef({ id: "", count: 0 });
  const board = snapshot?.view.drawing;
  useEffect(() => {
    setActive(false);
    setPreviews([]);
    previewOffset.current = { id: "", count: 0 };
    setNotice("");
  }, [board?.id]);
  useEffect(() => {
    if (!board?.enabled && !board?.owner) {
      setActive(false);
      setPreviews([]);
    }
  }, [board?.enabled, board?.owner]);
  useEffect(() => {
    const timer = setInterval(
      () =>
        setPreviews((p) => p.filter((x) => Date.now() - x.updatedAt < 1200)),
      400,
    );
    const receive = (input: InkPreview) => {
      const b = current.current?.view.drawing;
      if (!b || input.boardId !== b.id || (!b.enabled && !b.owner)) return;
      setPreviews((p) => [
        ...p.filter((x) => x.connectionId !== input.connectionId),
        { ...input, updatedAt: Date.now() },
      ]);
    };
    const clear = (id: string) =>
      setPreviews((p) => p.filter((x) => x.connectionId !== id));
    const s = socket.current;
    s?.on("drawing-preview", receive);
    s?.on("drawing-clear-preview", clear);
    return () => {
      clearInterval(timer);
      s?.off("drawing-preview", receive);
      s?.off("drawing-clear-preview", clear);
    };
  }, [socket.current]);
  const send = async (action: string, extra: Record<string, unknown> = {}) => {
    const state = current.current,
      b = state?.view.drawing;
    if (!state || !b) return;
    const payload = {
      type: "drawing",
      operationId: uid(),
      sessionId: state.session.id,
      characterId: state.character.id,
      viewTarget: state.view.target,
      boardId: b.id,
      revision: b.revision,
      action,
      ...extra,
    };
    setNotice("");
    for (let attempt = 0; attempt < 2; attempt++) {
      const result: any = await new Promise((resolve) => {
        if (!socket.current?.connected)
          return resolve({
            error: { message: "Connection unavailable; drawing was not sent" },
          });
        socket.current
          .timeout(4000)
          .emit("command", payload, (err: any, result: any) =>
            resolve(err ? { timeout: true } : result),
          );
      });
      if (result.timeout && attempt === 0) continue;
      if (result.timeout || result.error)
        setNotice(
          result.error?.message ??
            "No acknowledgment; reconnect to check the drawing",
        );
      return;
    }
  };
  const save = async () => {
    const state = current.current,
      b = state?.view.drawing;
    if (!state || !b?.source) return;
    setSaving(true);
    setNotice("");
    try {
      const draft = await api<ThingDraft>(
        `/api/things/${b.source.rootId}/document`,
      );
      // Capture the source revision before the save request; the server checks it atomically.
      await api("/api/drawings/save", "POST", {
        sessionId: state.session.id,
        characterId: state.character.id,
        viewTarget: state.view.target,
        boardId: b.id,
        boardRevision: b.revision,
        draftRevision: draft.revision,
        operationId: uid(),
      });
      setNotice(
        `Saved drawing revision ${b.revision} to draft. Publish separately.`,
      );
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const interaction: DrawingInteraction = {
    active: active && !!(board?.enabled || board?.owner),
    tool,
    color,
    width,
    actorId: snapshot?.character.ownerId ?? "",
    previews: previews.filter((p) => p.boardId === board?.id),
    onStroke: (stroke: DrawingStroke) => void send("stroke", { stroke }),
    onErase: (id) => void send("erase", { strokeId: id }),
    onPreview: (points, cursor, strokeId) => {
      if (!socket.current?.connected || !board) return;
      // A self-contained, simplified preview avoids gaps when volatile packets drop.
      const chunk =
        points.length <= 64
          ? points
          : Array.from(
              { length: 64 },
              (_, i) => points[Math.round((i * (points.length - 1)) / 63)],
            );
      socket.current.volatile.emit("drawing-preview", {
        boardId: board.id,
        strokeId,
        color,
        width,
        offset: 0,
        points: chunk,
        cursor,
      });
    },
  };
  const toolbar = board && (
    <div className="drawing-toolbar" aria-label="Shared drawing tools">
      <button
        className={!active ? "active" : ""}
        onClick={() => setActive(false)}
      >
        Select
      </button>
      <button
        className={active ? "active" : ""}
        disabled={!board.enabled && !board.owner}
        onClick={() => setActive(true)}
      >
        Draw
      </button>
      {active && (
        <>
          <select
            aria-label="Drawing tool"
            value={tool}
            onChange={(e) => setTool(e.target.value as "pen" | "eraser")}
          >
            <option value="pen">Pen</option>
            <option value="eraser">Stroke eraser</option>
          </select>
          <input
            aria-label="Ink color"
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
          <select
            aria-label="Ink thickness"
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
          >
            <option value={0.04}>Fine</option>
            <option value={0.08}>Medium</option>
            <option value={0.16}>Thick</option>
          </select>
          <button disabled={!board.canUndo} onClick={() => void send("undo")}>
            Undo drawing
          </button>
          <button disabled={!board.canRedo} onClick={() => void send("redo")}>
            Redo drawing
          </button>
        </>
      )}
      {board.owner && (
        <>
          <label>
            <input
              type="checkbox"
              checked={board.enabled}
              onChange={(e) =>
                void send("enable", { enabled: e.target.checked })
              }
            />{" "}
            Enable shared drawing
          </label>
          <button
            disabled={!board.source || !board.dirty || saving}
            onClick={() => void save()}
          >
            Save drawing to draft
          </button>
          <button
            disabled={!board.drawing.strokes.length}
            onClick={() => {
              if (
                confirm(
                  "Clear all strokes in this session space? You can undo this.",
                )
              )
                void send("clear");
            }}
          >
            Clear drawing
          </button>
        </>
      )}
      <small>
        {board.dirty
          ? "Unsaved session drawing"
          : "Drawing matches saved layer"}
      </small>
      {notice && <span role="status">{notice}</span>}
    </div>
  );
  return { interaction, toolbar };
}
