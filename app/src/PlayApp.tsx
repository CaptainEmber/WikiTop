import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  emptyScene,
  exportThingGlb,
  importThingGlb,
  ThingDocumentSchema,
  type AreaScene,
  type EmbeddedMedia,
  type Thing,
  type ThingCatalog,
  type ThingCatalogEntry,
  type ThingDocument,
  type ThingPlacement,
  type DrawingStroke,
} from "@wikitop/thing-format";
import type {
  CharacterSummary,
  LiveThingInstance,
  PlayParticipant,
} from "@wikitop/play-protocol";
import { listDrafts, loadDraft, saveDraft, type LocalDraft } from "./store";
import { createRoom, usePlayRoom, type RoomCredentials } from "./playClient";
import type { DrawingInteraction } from "./DrawingLayer";
import StatBlockView from "./StatBlockView";
const Scene = lazy(() => import("./Scene"));
const serviceConfigured = Boolean(import.meta.env.VITE_PLAY_URL);
const participantKey = "wikitop-play-participant";
const localParticipantId = () => {
  let value = localStorage.getItem(participantKey);
  if (!value) {
    value = `guest_${crypto.randomUUID()}`;
    localStorage.setItem(participantKey, value);
  }
  return value;
};
const download = (bytes: ArrayBuffer, name: string) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob([bytes], { type: "model/gltf-binary" }),
  );
  a.download = `${name.replace(/[^a-z0-9_-]+/gi, "-") || "character"}.glb`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
const summary = (
  doc: ThingDocument,
  revision: string,
  graphIds: string[],
): CharacterSummary => ({
  id: doc.thing.id,
  name: doc.thing.name,
  description: doc.thing.description.slice(0, 1000),
  revision,
  visual: doc.thing.face.visual,
  graphIds,
});
async function catalogData() {
  const response = await fetch(`${import.meta.env.BASE_URL}catalog.json`);
  if (!response.ok) throw new Error("World catalog is unavailable");
  return response.json() as Promise<ThingCatalog>;
}
async function publishedThing(catalog: ThingCatalog, id: string) {
  const entry = catalog.things.find((t) => t.id === id);
  if (!entry) throw new Error(`Published Thing ${id} was not found`);
  let response = await fetch(`${catalog.source.rawBase}${entry.path}`);
  if (!response.ok)
    response = await fetch(`${import.meta.env.BASE_URL}${entry.path}`);
  if (!response.ok) throw new Error(`Could not load ${entry.name}`);
  return importThingGlb(await response.arrayBuffer(), entry.path);
}
async function graphIds(root: string, catalog: ThingCatalog) {
  const drafts = await listDrafts(),
    draftMap = new Map(drafts.map((d) => [d.id, d.document])),
    entries = new Map(catalog.things.map((e) => [e.id, e])),
    seen = new Set<string>(),
    queue = [root];
  while (queue.length && seen.size < 100) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const local = draftMap.get(id);
    for (const target of local?.thing.page.placements.map((p) => p.targetId) ??
      entries.get(id)?.links ??
      [])
      if (!seen.has(target)) queue.push(target);
  }
  return [...seen];
}
async function ensureCharacter(id: string, catalog: ThingCatalog) {
  const local = await loadDraft(id);
  if (local) return local;
  const imported = await publishedThing(catalog, id);
  await saveDraft(imported.document, imported.media);
  return {
    draft: {
      id,
      name: imported.document.thing.name,
      updatedAt: Date.now(),
      document: imported.document,
    },
    media: imported.media,
  };
}
function toThing(
  p: ThingPlacement,
  catalog: Map<string, ThingCatalogEntry>,
  instance?: LiveThingInstance,
): Thing {
  const target = catalog.get(p.targetId),
    visible = instance?.visible;
  return {
    id: p.id,
    name: instance?.name ?? p.name ?? target?.name ?? p.targetId,
    description: target?.description ?? "",
    role: "spatial",
    position: instance?.position ?? p.position,
    rotation: p.rotation,
    scale: p.scale,
    visual: p.face,
    hidden: visible === undefined ? p.hidden : !visible,
    children: [],
  };
}
function liveInstance(
  pageId: string,
  p: ThingPlacement,
  doc?: ThingDocument,
  current?: LiveThingInstance,
): LiveThingInstance {
  return (
    current ?? {
      pageId,
      placementId: p.id,
      targetId: p.targetId,
      name: p.name ?? doc?.thing.name ?? p.targetId,
      position: p.position,
      resources: Object.fromEntries(
        (doc?.thing.statBlock?.resources ?? []).map((r) => [
          r.id,
          { value: r.value, max: r.max },
        ]),
      ),
      conditions: [],
    }
  );
}

interface ActiveRoom {
  roomId: string;
  credential: string;
  participantId: string;
  name: string;
  characterId: string;
  character: CharacterSummary;
  inviteSecret?: string;
}
export default function PlayApp() {
  const [catalog, setCatalog] = useState<ThingCatalog>(),
    [drafts, setDrafts] = useState<LocalDraft[]>([]),
    [name, setName] = useState(
      localStorage.getItem("wikitop-play-name") ?? "Guest",
    ),
    [characterId, setCharacterId] = useState(""),
    [start, setStart] = useState("published:"),
    [active, setActive] = useState<ActiveRoom>(),
    [error, setError] = useState(""),
    [recent, setRecent] = useState<
      {
        roomId: string;
        participantId: string;
        reconnectSecret: string;
        characterId: string;
        name: string;
      }[]
    >([]);
  const invite = location.hash.match(
    /^#\/play\/([a-f0-9]+)\/([A-Za-z0-9_-]+)$/,
  );
  useEffect(() => {
    void Promise.all([catalogData(), listDrafts()])
      .then(([c, d]) => {
        setCatalog(c);
        setDrafts(d);
        setCharacterId(
          d.find((x) => x.document.thing.kind === "character")?.id ??
            c.things.find((x) => x.kind === "character")?.id ??
            "",
        );
        setStart(
          `published:${c.things.find((x) => x.kind === "place")?.id ?? c.things[0]?.id ?? ""}`,
        );
        const rooms = [] as typeof recent;
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key?.startsWith("wikitop-room:")) continue;
          try {
            rooms.push({
              roomId: key.slice(13),
              ...JSON.parse(localStorage.getItem(key)!),
            });
          } catch {}
        }
        setRecent(rooms);
      })
      .catch((e) => setError(e.message));
  }, []);
  if (active && catalog)
    return (
      <Room
        active={active}
        catalog={catalog}
        onLeave={() => {
          setActive(undefined);
          location.hash = "#/play";
          void listDrafts().then(setDrafts);
        }}
      />
    );
  const characters = [
    ...drafts
      .filter((d) => d.document.thing.kind === "character")
      .map((d) => ({ id: d.id, name: d.name, local: true })),
    ...(catalog?.things
      .filter(
        (t) => t.kind === "character" && !drafts.some((d) => d.id === t.id),
      )
      .map((t) => ({ id: t.id, name: t.name, local: false })) ?? []),
  ];
  const enter = async (host: boolean) => {
    if (!catalog || !characterId) return;
    setError("");
    try {
      localStorage.setItem("wikitop-play-name", name);
      const character = await ensureCharacter(characterId, catalog),
        ids = await graphIds(characterId, catalog),
        characterInfo = summary(
          character.draft.document,
          String(character.draft.updatedAt),
          ids,
        );
      if (host) {
        const [source, thingId] = start.split(":", 2) as [
          "published" | "host-local",
          string,
        ];
        const created = await createRoom({
          location: { thingId, source },
          world: catalog.source,
          host: { id: localParticipantId(), name, character: characterInfo },
        });
        const inviteUrl = `${location.origin}${location.pathname}#/play/${created.roomId}/${created.inviteSecret}`;
        localStorage.setItem(
          `wikitop-room:${created.roomId}`,
          JSON.stringify({
            participantId: created.participantId,
            reconnectSecret: created.reconnectSecret,
            characterId,
            name,
          }),
        );
        setActive({
          roomId: created.roomId,
          credential: created.reconnectSecret,
          participantId: created.participantId,
          name,
          characterId,
          character: characterInfo,
          inviteSecret: inviteUrl,
        });
      } else if (invite) {
        const stored = JSON.parse(
          localStorage.getItem(`wikitop-room:${invite[1]}`) ?? "null",
        );
        setActive({
          roomId: invite[1],
          credential: stored?.reconnectSecret ?? invite[2],
          participantId: stored?.participantId ?? localParticipantId(),
          name,
          characterId,
          character: characterInfo,
        });
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <main className="play-home portable-home">
      <header className="portable-title">
        <span className="crest">▶</span>
        <div>
          <p className="eyebrow">EPHEMERAL LIVE PLAY</p>
          <h1>{invite ? "Join the party" : "Gather around a Thing."}</h1>
          <p>
            Move tokens, follow the party, draw together, and keep your
            character edits locally.
          </p>
        </div>
      </header>
      {!serviceConfigured && (
        <div className="alert">
          Live play is not configured for this deployment. The world and local
          editor remain available.
        </div>
      )}
      {error && <div className="alert">{error}</div>}
      <section className="play-setup">
        {!invite && recent.length > 0 && (
          <>
            <h2>Recent rooms</h2>
            <div className="actions">
              {recent.map((r) => (
                <button
                  key={r.roomId}
                  onClick={() =>
                    void (async () => {
                      if (!catalog) return;
                      try {
                        const c = await ensureCharacter(r.characterId, catalog),
                          ids = await graphIds(r.characterId, catalog);
                        setActive({
                          roomId: r.roomId,
                          credential: r.reconnectSecret,
                          participantId: r.participantId,
                          name: r.name,
                          characterId: r.characterId,
                          character: summary(
                            c.draft.document,
                            String(c.draft.updatedAt),
                            ids,
                          ),
                        });
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    })()
                  }
                >
                  Reconnect to {r.roomId.slice(0, 8)}…
                </button>
              ))}
            </div>
          </>
        )}
        <label>
          Display name
          <input
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <h2>Choose your character</h2>
        <div className="thing-card-grid compact">
          {characters.map((c) => (
            <button
              key={c.id}
              className={`thing-card ${characterId === c.id ? "selected" : ""}`}
              onClick={() => setCharacterId(c.id)}
            >
              <p className="eyebrow">
                {c.local ? "LOCAL DRAFT" : "PUBLISHED COPY"}
              </p>
              <h3>{c.name}</h3>
            </button>
          ))}
        </div>
        {!invite && (
          <>
            <label>
              Starting Thing
              <select value={start} onChange={(e) => setStart(e.target.value)}>
                <optgroup label="Published">
                  {catalog?.things
                    .filter((t) => t.kind === "place")
                    .map((t) => (
                      <option value={`published:${t.id}`} key={t.id}>
                        {t.name}
                      </option>
                    ))}
                </optgroup>
                <optgroup label="Local drafts">
                  {drafts
                    .filter((d) => d.document.thing.kind !== "character")
                    .map((d) => (
                      <option value={`host-local:${d.id}`} key={d.id}>
                        {d.name}
                      </option>
                    ))}
                </optgroup>
              </select>
            </label>
            <button
              className="primary"
              disabled={
                !serviceConfigured || !characterId || !start.split(":")[1]
              }
              onClick={() => void enter(true)}
            >
              Create live room
            </button>
          </>
        )}
        {invite && (
          <button
            className="primary"
            disabled={!serviceConfigured || !characterId}
            onClick={() => void enter(false)}
          >
            Join room
          </button>
        )}
      </section>
    </main>
  );
}

function Room({
  active,
  catalog,
  onLeave,
}: {
  active: ActiveRoom;
  catalog: ThingCatalog;
  onLeave: () => void;
}) {
  const [character, setCharacter] = useState<{
      doc: ThingDocument;
      media: Map<string, EmbeddedMedia>;
      revision: string;
    }>(),
    [party, setParty] = useState<{
      doc: ThingDocument;
      media: Map<string, EmbeddedMedia>;
    }>(),
    [view, setView] = useState<{
      doc: ThingDocument;
      media: Map<string, EmbeddedMedia>;
      ownerId?: string;
    }>(),
    [selected, setSelected] = useState(active.participantId),
    [selectedTarget, setSelectedTarget] = useState<ThingDocument>(),
    [map, setMap] = useState(true),
    [draw, setDraw] = useState(false),
    [editingCharacter, setEditingCharacter] = useState(false),
    [saveState, setSaveState] = useState("Saved locally"),
    [tool, setTool] = useState<"pen" | "eraser">("pen"),
    [error, setError] = useState("");
  const catalogMap = useMemo(
    () => new Map(catalog.things.map((e) => [e.id, e])),
    [catalog],
  );
  const onThingRequest = async (id: string) => {
    const local = await loadDraft(id);
    if (local) return exportThingGlb(local.draft.document, local.media);
    try {
      const published = await publishedThing(catalog, id);
      return exportThingGlb(published.document, published.media);
    } catch {
      return undefined;
    }
  };
  const room = usePlayRoom({
    roomId: active.roomId,
    credential: active.credential,
    participantId: active.participantId,
    name: active.name,
    character: active.character,
    onThingRequest,
  });
  const self = room.snapshot?.participants.find(
      (p) => p.id === room.participantId,
    ),
    host = room.snapshot?.hostId === room.participantId,
    current = room.snapshot?.location.thingId;
  useEffect(() => {
    void loadDraft(active.characterId).then((x) => {
      if (!x) return;
      setCharacter({
        doc: x.draft.document,
        media: x.media,
        revision: String(x.draft.updatedAt),
      });
    });
  }, [active.characterId]);
  useEffect(() => {
    if (!current) return;
    void (async () => {
      try {
        let value: { doc: ThingDocument; media: Map<string, EmbeddedMedia> };
        if (room.snapshot?.location.source === "host-local") {
          const loaded = await loadDraft(current);
          if (loaded)
            value = { doc: loaded.draft.document, media: loaded.media };
          else {
            const bytes = await room.requestThing(
                room.snapshot!.worldOwnerId,
                current,
              ),
              shared = await importThingGlb(bytes, `${current}.glb`);
            value = { doc: shared.document, media: shared.media };
          }
        } else
          value = await publishedThing(catalog, current).then((x) => ({
            doc: x.document,
            media: x.media,
          }));
        setParty(value);
        setView((v) => (v?.ownerId ? v : value));
        setError("");
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [current, room.snapshot?.location.source, room.snapshot?.worldOwnerId]);
  useEffect(() => {
    if (!character) return;
    setSaveState("Saving locally");
    const value = character,
      t = setTimeout(
        () =>
          void saveDraft(value.doc, value.media)
            .then(async () => {
              setSaveState("Saved locally");
              if (room.state === "live") {
                const ids = await graphIds(value.doc.thing.id, catalog);
                room.command({
                  type: "character-update",
                  character: summary(value.doc, String(Date.now()), ids),
                });
              }
            })
            .catch((e) => setSaveState(e.message)),
        500,
      );
    return () => clearTimeout(t);
  }, [character?.doc, room.state]);
  const urls = useMemo(
    () =>
      new Map(
        [...(view?.media ?? [])].map(([id, m]) => [
          id,
          URL.createObjectURL(new Blob([m.bytes], { type: m.mimeType })),
        ]),
      ),
    [view?.media],
  );
  useEffect(() => () => urls.forEach(URL.revokeObjectURL), [urls]);
  const openParticipant = async (p: PlayParticipant) => {
    try {
      if (p.id === room.participantId && character) {
        setView({ doc: character.doc, media: character.media, ownerId: p.id });
        return;
      }
      const bytes = await room.requestThing(p.id, p.character.id),
        imported = await importThingGlb(bytes, `${p.character.name}.glb`);
      setView({ doc: imported.document, media: imported.media, ownerId: p.id });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const sourceOwner = () =>
    view?.ownerId ??
    (room.snapshot?.location.source === "host-local"
      ? room.snapshot?.worldOwnerId
      : undefined);
  const loadTarget = async (targetId: string) => {
    const local =
      room.participantId === room.snapshot?.worldOwnerId
        ? await loadDraft(targetId)
        : undefined;
    if (local)
      return {
        document: local.draft.document,
        media: local.media,
        ownerId: room.participantId,
      };
    if (catalogMap.has(targetId)) {
      const loaded = await publishedThing(catalog, targetId);
      return {
        document: loaded.document,
        media: loaded.media,
        ownerId: undefined,
      };
    }
    const owner = sourceOwner();
    if (owner) {
      const bytes = await room.requestThing(owner, targetId),
        loaded = await importThingGlb(bytes, `${targetId}.glb`);
      return { document: loaded.document, media: loaded.media, ownerId: owner };
    }
    throw new Error("Thing source is unavailable");
  };
  const openTarget = async (targetId: string) => {
    try {
      const loaded = await loadTarget(targetId);
      setView({
        doc: loaded.document,
        media: loaded.media,
        ownerId: loaded.ownerId,
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const selectPlaced = (id: string) => {
    setSelected(id);
    const p = view?.doc.thing.page.placements.find((x) => x.id === id);
    if (p)
      void loadTarget(p.targetId)
        .then((x) => setSelectedTarget(x.document))
        .catch(() => setSelectedTarget(undefined));
    else setSelectedTarget(undefined);
  };
  if (!room.snapshot || !party || !view)
    return (
      <main className="portable-home">
        <h1>Joining room…</h1>
        <p>{room.state}</p>
        {room.error && <div className="alert">{room.error}</div>}
        <button onClick={onLeave}>Leave</button>
      </main>
    );
  const viewingParty =
      view.doc.thing.id === party.doc.thing.id && !view.ownerId,
    page = view.doc.thing.page,
    pageId = view.doc.thing.id,
    board = room.snapshot.boards[party.doc.thing.id],
    instances = room.snapshot.instances[pageId] ?? {};
  const resolvePlacement = (p: ThingPlacement): ThingPlacement =>
    p.face
      ? {
          ...p,
          face: {
            ...p.face,
            assetId: p.face.assetId
              ? (urls.get(p.face.assetId) ?? p.face.assetId)
              : undefined,
            mapAssetId: p.face.mapAssetId
              ? (urls.get(p.face.mapAssetId) ?? p.face.mapAssetId)
              : undefined,
          },
        }
      : p;
  const scene: AreaScene = {
    ...emptyScene(),
    width: page.width,
    depth: page.depth,
    zones: page.zones,
    doors: page.doors,
    anchors: page.anchors,
    drawing: viewingParty ? board?.drawing : page.drawing,
    things: page.placements.map((p) =>
      toThing(resolvePlacement(p), catalogMap, instances[p.id]),
    ),
  };
  const background =
    page.background?.kind === "embedded"
      ? urls.get(page.background.mediaId)
      : page.background?.url;
  const visiblePlacements = page.placements.filter(
    (p) =>
      host ||
      !(instances[p.id]?.visible === undefined
        ? p.hidden
        : !instances[p.id].visible),
  );
  const selectedPlacement = page.placements.find((p) => p.id === selected),
    selectedInstance = selectedPlacement
      ? instances[selectedPlacement.id]
      : undefined;
  const occupantSnapshot = {
    occupants: room.snapshot.participants.map((p) => ({
      character: { id: p.id, name: p.character.name },
      placement: {
        areaId: room.snapshot!.location.thingId,
        position: p.position,
      },
    })),
    character: { id: room.participantId },
    view: { drawing: board ? { drawing: board.drawing } : undefined },
  };
  const drawing: DrawingInteraction | undefined =
    draw && viewingParty && board?.enabled
      ? {
          active: true,
          tool,
          color: "#f0b55a",
          width: 0.12,
          actorId: room.participantId,
          previews: Object.entries(room.cursors)
            .filter(([, c]) => c.thingId === party.doc.thing.id)
            .map(([id, c]) => ({
              connectionId: id,
              boardId: party.doc.thing.id,
              actorId: id,
              name:
                room.snapshot!.participants.find((p) => p.id === id)?.name ??
                "Guest",
              color: c.color,
              width: 0.12,
              points: [],
              cursor: c.position,
              updatedAt: Date.now(),
            })),
          onPreview: (_, cursor) => {
            if (cursor)
              room.rawSend({
                type: "cursor",
                thingId: party.doc.thing.id,
                position: cursor,
                color: "#f0b55a",
              });
          },
          onStroke: (stroke: DrawingStroke) =>
            room.command({
              type: "drawing-stroke",
              thingId: party.doc.thing.id,
              stroke,
              boardRevision: board.revision,
            }),
          onErase: (strokeId) =>
            room.command({
              type: "drawing-erase",
              thingId: party.doc.thing.id,
              strokeId,
              boardRevision: board.revision,
            }),
        }
      : undefined;
  const travel = async (targetId: string) => {
    try {
      const local =
          room.participantId === room.snapshot?.worldOwnerId
            ? await loadDraft(targetId)
            : undefined,
        destination = local
          ? { document: local.draft.document }
          : await publishedThing(catalog, targetId),
        anchor = destination.document.thing.page.anchors[0];
      room.command({
        type: "travel",
        thingId: targetId,
        source: local ? "host-local" : "published",
        anchorId: anchor.id,
        arrival: anchor.position,
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const patchCharacter = (fn: (d: ThingDocument) => void) => {
    if (!character) return;
    const next = structuredClone(character.doc);
    fn(next);
    const parsed = ThingDocumentSchema.safeParse(next);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid character edit");
      return;
    }
    setCharacter({
      ...character,
      doc: parsed.data,
      revision: String(Date.now()),
    });
    if (view.ownerId === room.participantId)
      setView({ ...view, doc: parsed.data });
  };
  const updateInstance = (change: (x: LiveThingInstance) => void) => {
    if (!selectedPlacement) return;
    const next = structuredClone(
      liveInstance(pageId, selectedPlacement, selectedTarget, selectedInstance),
    );
    change(next);
    room.command({ type: "instance-update", instance: next });
  };
  const moveSelected = (position: [number, number, number]) => {
    const participant = room.snapshot!.participants.find(
      (p) => p.id === selected,
    );
    if (participant && (selected === room.participantId || host)) {
      room.command({ type: "move", participantId: selected, position });
      return;
    }
    if (host && viewingParty && selectedPlacement) {
      const next = structuredClone(
        liveInstance(
          pageId,
          selectedPlacement,
          selectedTarget,
          selectedInstance,
        ),
      );
      next.position = position;
      room.command({ type: "instance-move", instance: next });
    }
  };
  const inspector =
    editingCharacter && character ? (
      <>
        <p className="eyebrow">LOCAL CHARACTER DRAFT</p>
        <label>
          Name
          <input
            value={character.doc.thing.name}
            onChange={(e) =>
              patchCharacter((d) => {
                d.thing.name = e.target.value;
              })
            }
          />
        </label>
        <label>
          Description
          <textarea
            value={character.doc.thing.description}
            onChange={(e) =>
              patchCharacter((d) => {
                d.thing.description = e.target.value;
              })
            }
          />
        </label>
        <label>
          Tags
          <input
            value={(character.doc.thing.tags ?? []).join(", ")}
            onChange={(e) =>
              patchCharacter((d) => {
                d.thing.tags = e.target.value
                  .split(",")
                  .map((x) => x.trim())
                  .filter(Boolean);
              })
            }
          />
        </label>
        <label>
          Page width
          <input
            type="number"
            value={character.doc.thing.page.width}
            onChange={(e) =>
              patchCharacter((d) => {
                d.thing.page.width = Math.max(0.1, Number(e.target.value));
              })
            }
          />
        </label>
        <label>
          Page depth
          <input
            type="number"
            value={character.doc.thing.page.depth}
            onChange={(e) =>
              patchCharacter((d) => {
                d.thing.page.depth = Math.max(0.1, Number(e.target.value));
              })
            }
          />
        </label>
        <button
          onClick={() => {
            const target = prompt("Thing ID to place");
            if (target)
              patchCharacter((d) =>
                d.thing.page.placements.push({
                  id: `placement_${crypto.randomUUID()}`,
                  targetId: target,
                  position: [0, 0, 0],
                  rotation: [0, 0, 0, 1],
                  scale: [1, 1, 1],
                }),
              );
          }}
        >
          ＋ Place linked Thing
        </button>
        <p>Character changes autosave in this browser and update the room.</p>
      </>
    ) : selectedPlacement ? (
      <>
        <h3>
          {selectedInstance?.name ??
            selectedPlacement.name ??
            selectedTarget?.thing.name ??
            selectedPlacement.targetId}
        </h3>
        <p>{selectedTarget?.thing.description}</p>
        <StatBlockView block={selectedTarget?.thing.statBlock} />
        {host && viewingParty && (
          <>
            <h4>Live state</h4>
            {Object.entries(
              liveInstance(
                pageId,
                selectedPlacement,
                selectedTarget,
                selectedInstance,
              ).resources,
            ).map(([id, r]) => (
              <label key={id}>
                {selectedTarget?.thing.statBlock?.resources.find(
                  (x) => x.id === id,
                )?.label ?? id}
                <input
                  type="number"
                  defaultValue={r.value}
                  onBlur={(e) =>
                    updateInstance((x) => {
                      x.resources[id] = {
                        ...x.resources[id],
                        value: Number(e.target.value),
                      };
                    })
                  }
                />
                {r.max !== undefined && <small> / {r.max}</small>}
              </label>
            ))}
            <p>{selectedInstance?.conditions.join(", ") || "No conditions"}</p>
            <div className="actions">
              <button
                onClick={() => {
                  const value = prompt("Condition");
                  if (value)
                    updateInstance((x) => {
                      if (!x.conditions.includes(value))
                        x.conditions.push(value);
                    });
                }}
              >
                Add condition
              </button>
              {selectedInstance?.conditions.map((c) => (
                <button
                  key={c}
                  onClick={() =>
                    updateInstance((x) => {
                      x.conditions = x.conditions.filter((v) => v !== c);
                    })
                  }
                >
                  Remove {c}
                </button>
              ))}
              <button
                onClick={() =>
                  updateInstance((x) => {
                    const hidden =
                      selectedInstance?.visible === undefined
                        ? Boolean(selectedPlacement.hidden)
                        : !selectedInstance.visible;
                    x.visible = hidden;
                  })
                }
              >
                {(
                  selectedInstance?.visible === undefined
                    ? selectedPlacement.hidden
                    : !selectedInstance.visible
                )
                  ? "Reveal"
                  : "Hide"}
              </button>
              {selectedInstance && (
                <button
                  onClick={() =>
                    room.command({
                      type: "instance-reset",
                      pageId,
                      placementId: selectedPlacement.id,
                    })
                  }
                >
                  Reset live state
                </button>
              )}
            </div>
          </>
        )}
      </>
    ) : (
      <>
        <h3>{view.doc.thing.name}</h3>
        <p>{view.doc.thing.description}</p>
        <StatBlockView block={view.doc.thing.statBlock} />
        <p>{view.doc.thing.tags?.map((t) => `#${t}`).join(" ")}</p>
        <p>
          <strong>Source:</strong>{" "}
          {view.ownerId ? "participant draft" : "published world"}
        </p>
      </>
    );
  return (
    <main className="workspace play-room">
      <header className="portable-header">
        <button className="brand" onClick={onLeave}>
          W{" "}
          <span>
            Live Play<small>{room.state.toUpperCase()} · TEMPORARY ROOM</small>
          </span>
        </button>
        <button
          onClick={() => {
            setView({ doc: party.doc, media: party.media });
            setSelected(room.participantId);
            setSelectedTarget(undefined);
          }}
        >
          Return to party
        </button>
        <span className="save-state">{saveState}</span>
        <div className="actions">
          {active.inviteSecret && (
            <>
              <label className="invite-field">
                Invitation link
                <input readOnly value={active.inviteSecret} />
              </label>
              <button
                onClick={() =>
                  void navigator.clipboard.writeText(active.inviteSecret!)
                }
              >
                Copy invitation
              </button>
            </>
          )}
          <button onClick={() => setEditingCharacter((v) => !v)}>
            Edit my character
          </button>
          {character && (
            <button
              onClick={() =>
                void exportThingGlb(character.doc, character.media).then((b) =>
                  download(b, character.doc.thing.name),
                )
              }
            >
              Export character GLB
            </button>
          )}
          <button onClick={onLeave}>Leave</button>
        </div>
      </header>
      {(error || room.error) && (
        <div className="alert">
          {error || room.error}
          <button
            onClick={() => {
              setError("");
              room.setError("");
            }}
          >
            Dismiss
          </button>
        </div>
      )}
      <div className="workspace-bar">
        <div>
          <p className="eyebrow">PARTY AT {party.doc.thing.name}</p>
          <h2>{view.doc.thing.name}</h2>
          {!viewingParty && <p>You are looking away from the party.</p>}
        </div>
        <div className="actions">
          <button className={map ? "active" : ""} onClick={() => setMap(true)}>
            2D
          </button>
          <button
            className={!map ? "active" : ""}
            onClick={() => setMap(false)}
          >
            3D
          </button>
          {host && viewingParty && (
            <button
              onClick={() =>
                room.command({
                  type: "drawing-enable",
                  thingId: party.doc.thing.id,
                  enabled: !board?.enabled,
                  boardRevision: board?.revision ?? 0,
                })
              }
            >
              {board?.enabled ? "Disable drawing" : "Enable drawing"}
            </button>
          )}
          {board?.enabled && viewingParty && (
            <>
              <button
                className={draw ? "active" : ""}
                onClick={() => setDraw((v) => !v)}
              >
                Draw
              </button>
              {draw && (
                <button
                  onClick={() =>
                    setTool((v) => (v === "pen" ? "eraser" : "pen"))
                  }
                >
                  {tool}
                </button>
              )}
            </>
          )}
        </div>
      </div>
      <div className="workspace-grid">
        <aside className="panel tools">
          <p className="eyebrow">PARTY</p>
          {room.snapshot.participants.map((p) => (
            <article
              className={
                selected === p.id
                  ? "selected participant-row"
                  : "participant-row"
              }
              key={p.id}
            >
              <button
                onClick={() => {
                  setSelected(p.id);
                  setSelectedTarget(undefined);
                  void openParticipant(p);
                }}
              >
                {p.role === "host" ? "★ " : ""}
                {p.name} · {p.character.name}
              </button>
              <small>{p.connected ? "online" : "offline"}</small>
              {host && p.id !== room.participantId && p.connected && (
                <button
                  onClick={() =>
                    room.command({ type: "transfer-host", participantId: p.id })
                  }
                >
                  Make host
                </button>
              )}
            </article>
          ))}
          <h3>Things here</h3>
          {visiblePlacements.map((p) => (
            <div className="play-link" key={p.id}>
              <button onClick={() => selectPlaced(p.id)}>
                {p.hidden && host ? "◌ " : ""}
                {instances[p.id]?.name ??
                  p.name ??
                  catalogMap.get(p.targetId)?.name ??
                  p.targetId}
              </button>
              <button onClick={() => void openTarget(p.targetId)}>Open</button>
              {host && viewingParty && (
                <button onClick={() => void travel(p.targetId)}>Travel</button>
              )}
            </div>
          ))}
        </aside>
        <section className="viewport">
          <Suspense fallback={<p>Loading scene…</p>}>
            <Scene
              scene={scene}
              map={map}
              selected={selected}
              onSelect={selectPlaced}
              onMove={moveSelected}
              onDrag={(id, position) => {
                if (editingCharacter && view.ownerId === room.participantId)
                  patchCharacter((d) => {
                    const p = d.thing.page.placements.find((x) => x.id === id);
                    if (p) p.position = position;
                  });
              }}
              editing={editingCharacter && view.ownerId === room.participantId}
              showHidden={Boolean(host)}
              snapshot={viewingParty ? occupantSnapshot : undefined}
              drawingInteraction={drawing}
              backgroundAssetId={background}
              interior
              fit
            />
          </Suspense>
        </section>
        <aside className="panel inspector">{inspector}</aside>
      </div>
    </main>
  );
}
