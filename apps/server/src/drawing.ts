import {
  DrawingSchema,
  StrokeSchema,
  flattenThings,
  type DrawingBoard,
  type DrawingView,
  type DrawingStroke,
  type Command,
  type WorldState,
  type PlaySession,
  type Placement,
  type ViewTarget,
} from "@wikitop/shared";
import { resolveView } from "./views.js";
import { nodeId } from "./documents.js";
import { requireThat } from "./errors.js";
import { inventory, sceneThings } from "./live-things.js";
const empty = () => ({ version: 1 as const, strokes: [] as DrawingStroke[] });
export function drawingContext(
  s: WorldState,
  session: PlaySession,
  actor: string,
  p: Placement,
  target: ViewTarget,
) {
  const c = resolveView(s, session, actor, p, target);
  const path = target.kind === "interior" ? target.path : [];
  const id = JSON.stringify([c.root, c.rootId, ...path]);
  let hasSource = true;
  let legacyId: string | undefined,
    items =
      c.root === "character"
        ? inventory(s, session, c.rootId)
        : sceneThings(s, session, c.rootId);
  for (const part of path) {
    const t = items.find((t) => t.id === part)!;
    legacyId = t.templateId ?? t.id;
    if (t.templateRootId) {
      if (t.templateRootId !== c.rootId) hasSource = false;
    } else if (t.templateId) {
      // Old checkpoints lack source roots. Only infer an unambiguous origin.
      const native =
        c.root === "character"
          ? (s.characters[c.rootId].children ?? [])
          : s.publications[session.pins[c.rootId]].scene.things;
      const elsewhere = [
        ...Object.values(s.characters)
          .filter((x) => x.id !== c.rootId)
          .flatMap((x) => x.children ?? []),
        ...Object.values(s.publications)
          .filter((x) => x.areaId !== c.rootId)
          .flatMap((x) => x.scene.things),
      ];
      if (
        !flattenThings(native).some((x) => x.id === legacyId) ||
        flattenThings(elsewhere).some((x) => x.id === legacyId)
      )
        hasSource = false;
    } else if (c.root === "character") hasSource = false;
    items = t.children;
  }
  const root = s.areas[c.rootId] ?? s.characters[c.rootId];
  const source =
    hasSource && root?.ownerId === c.ownerId
      ? {
          rootId: c.rootId,
          nodeId: legacyId ? nodeId(c.rootId, legacyId, s) : c.rootId,
        }
      : undefined;
  const initial = c.space.drawing ?? empty();
  const board = session.drawings?.[id];
  return { id, c, source, board, initial };
}
export function drawingView(
  s: WorldState,
  session: PlaySession,
  actor: string,
  p: Placement,
  target: ViewTarget,
): DrawingView {
  const { id, c, source, board, initial } = drawingContext(
    s,
    session,
    actor,
    p,
    target,
  );
  const drawing = board?.drawing ?? initial;
  return {
    id,
    revision: board?.revision ?? 0,
    enabled: board?.enabled ?? false,
    drawing,
    dirty: JSON.stringify(drawing) !== JSON.stringify(board?.saved ?? initial),
    owner: c.ownerId === actor,
    canUndo: !!board?.history.some((h) => h.actorId === actor && !h.undone),
    canRedo: !!board?.history.some((h) => h.actorId === actor && h.undone),
    source: c.ownerId === actor ? source : undefined,
  };
}
export function drawCommand(
  s: WorldState,
  session: PlaySession,
  actor: string,
  p: Placement,
  cmd: Extract<Command, { type: "drawing" }>,
) {
  const ctx = drawingContext(s, session, actor, p, cmd.viewTarget);
  requireThat(
    ctx.id === cmd.boardId,
    "board_changed",
    "The viewed space changed",
    409,
  );
  const owner = ctx.c.ownerId === actor;
  session.drawings ??= {};
  const b: DrawingBoard = (session.drawings[ctx.id] ??= {
    revision: 0,
    enabled: false,
    drawing: structuredClone(ctx.initial),
    saved: structuredClone(ctx.initial),
    history: [],
  });
  requireThat(
    owner || b.enabled,
    "drawing_disabled",
    "The owner has not enabled drawing",
    403,
  );
  if (cmd.action === "enable") {
    requireThat(
      owner,
      "forbidden",
      "Only the space owner can enable drawing",
      403,
    );
    b.enabled = !!cmd.enabled;
    b.revision++;
    return;
  }
  // Strokes merge independently; destructive operations must use the latest board revision.
  if (cmd.action !== "stroke")
    requireThat(
      cmd.revision === b.revision,
      "board_conflict",
      "Drawing changed; try again",
      409,
    );
  const strokes = b.drawing.strokes;
  let before: DrawingStroke[] = [],
    after: DrawingStroke[] = [];
  if (cmd.action === "stroke") {
    requireThat(cmd.stroke, "invalid_stroke", "A stroke is required");
    requireThat(
      !strokes.some((s) => s.id === cmd.stroke!.id),
      "stroke_conflict",
      "Stroke already exists",
      409,
    );
    const stroke = StrokeSchema.parse({ ...cmd.stroke!, authorId: actor });
    after = [stroke];
  } else if (cmd.action === "erase") {
    const stroke = strokes.find((s) => s.id === cmd.strokeId);
    requireThat(stroke, "stroke_missing", "Stroke is unavailable", 409);
    requireThat(
      owner || stroke!.authorId === actor,
      "forbidden",
      "You can erase only your own strokes",
      403,
    );
    before = [stroke!];
  } else if (cmd.action === "clear") {
    requireThat(owner, "forbidden", "Only the owner can clear drawings", 403);
    before = [...strokes];
  } else {
    const redo = cmd.action === "redo";
    const entry = [...b.history]
      .reverse()
      .find((h) => h.actorId === actor && !!h.undone === redo);
    requireThat(entry, "history_empty", "Nothing to undo or redo", 409);
    before = redo ? entry!.before : entry!.after;
    after = redo ? entry!.after : entry!.before;
    // Never overwrite a stroke changed by somebody else after this operation.
    requireThat(
      before.every((t) => strokes.some((s) => s.id === t.id)) &&
        after.every(
          (t) =>
            !strokes.some((s) => s.id === t.id) ||
            before.some((b) => b.id === t.id),
        ),
      "history_conflict",
      "Later edits prevent this undo or redo",
      409,
    );
    entry!.undone = !redo;
  }
  const removed = new Set(before.map((s) => s.id));
  b.drawing = DrawingSchema.parse({
    version: 1,
    strokes: [...strokes.filter((s) => !removed.has(s.id)), ...after],
  });
  if (["stroke", "erase", "clear"].includes(cmd.action)) {
    b.history = b.history.filter((h) => h.actorId !== actor || !h.undone);
    b.history.push({ actorId: actor, before, after });
    b.history = b.history.slice(-50);
  }
  b.revision++;
}
