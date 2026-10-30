import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import StatBlockView from "./StatBlockView";
import {
  emptyScene,
  exportThingGlb,
  importThingGlb,
  ThingDocumentSchema,
  validateGlb,
  type AreaScene,
  type EmbeddedMedia,
  type MediaReference,
  type Thing,
  type ThingCatalog,
  type ThingCatalogEntry,
  type ThingDocument,
  type ThingPlacement,
  type Vec3,
  type DrawingStroke,
} from "@wikitop/thing-format";
import {
  deleteDraft,
  listDrafts,
  loadDraft,
  saveDraft,
  type LocalDraft,
} from "./store";
import type { DrawingInteraction } from "./DrawingLayer";
const Scene = lazy(() => import("./Scene"));
const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
const blank = (name = "Untitled Thing", thingId = id("thing")): ThingDocument =>
  ThingDocumentSchema.parse({
    schemaVersion: 2,
    thing: {
      id: thingId,
      name,
      description: "",
      kind: "other",
      face: { media: {} },
      page: {
        width: 20,
        depth: 16,
        zones: [],
        doors: [],
        anchors: [{ id: "entrance", name: "Entrance", position: [0, 0, 0] }],
        placements: [],
      },
    },
  });
const slug = (v: string) =>
  v.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "") || "thing";
const download = (bytes: ArrayBuffer, name: string) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob([bytes], { type: "model/gltf-binary" }),
  );
  a.download = `${slug(name)}.glb`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
const fileMime = (file: File): EmbeddedMedia["mimeType"] => {
  if (
    ["image/png", "image/jpeg", "image/webp", "model/gltf-binary"].includes(
      file.type,
    )
  )
    return file.type as EmbeddedMedia["mimeType"];
  if (/\.glb$/i.test(file.name)) return "model/gltf-binary";
  throw new Error("Choose PNG, JPEG, WebP, or GLB media");
};
function faceSource(
  ref: MediaReference | undefined,
  urls: Map<string, string>,
) {
  return ref?.kind === "embedded"
    ? urls.get(ref.mediaId)
    : ref?.kind === "url"
      ? ref.url
      : undefined;
}
function placementThing(
  p: ThingPlacement,
  catalog: Map<string, ThingCatalogEntry>,
): Thing {
  const target = catalog.get(p.targetId);
  return {
    id: p.id,
    name: `${p.partyExit ? "⇥ " : ""}${p.name ?? target?.name ?? `Missing: ${p.targetId}`}`,
    description: target?.description ?? "This link has no published target.",
    role: "spatial",
    position: p.position,
    rotation: p.rotation,
    scale: p.scale,
    visual: p.face,
    hidden: p.hidden,
    children: [],
  };
}
type PlacementChoice = {
  id: string;
  name: string;
  description: string;
  kind: ThingDocument["thing"]["kind"];
  tags: string[];
  source: "published" | "local";
};
function AddThingDialog({
  catalog,
  onPlace,
  onCreate,
  onClose,
}: {
  catalog: Map<string, ThingCatalogEntry>;
  onPlace: (id: string) => void;
  onCreate: (name: string, kind: ThingDocument["thing"]["kind"]) => void;
  onClose: () => void;
}) {
  const [drafts, setDrafts] = useState<LocalDraft[]>([]),
    [query, setQuery] = useState(""),
    [source, setSource] = useState<"all" | "published" | "local">("all"),
    [kind, setKind] = useState("all"),
    [tag, setTag] = useState("all"),
    [creating, setCreating] = useState(false),
    [newName, setNewName] = useState(""),
    [newKind, setNewKind] = useState<ThingDocument["thing"]["kind"]>("place");
  useEffect(() => {
    void listDrafts().then(setDrafts);
  }, []);
  const choices = useMemo(() => {
      const values: PlacementChoice[] = [];
      for (const entry of catalog.values())
        values.push({
          id: entry.id,
          name: entry.name,
          description: entry.description,
          kind: entry.kind,
          tags: entry.tags,
          source: "published",
        });
      for (const draft of drafts)
        values.push({
          id: draft.id,
          name: draft.name,
          description: draft.document.thing.description,
          kind: draft.document.thing.kind,
          tags: draft.document.thing.tags ?? [],
          source: "local",
        });
      return values.sort(
        (a, b) =>
          a.name.localeCompare(b.name) || a.source.localeCompare(b.source),
      );
    }, [catalog, drafts]),
    tags = [...new Set(choices.flatMap((choice) => choice.tags))].sort(),
    shown = choices.filter((choice) => {
      const haystack =
        `${choice.name} ${choice.id} ${choice.description} ${choice.kind} ${choice.tags.join(" ")}`.toLowerCase();
      return (
        haystack.includes(query.toLowerCase()) &&
        (source === "all" || choice.source === source) &&
        (kind === "all" || choice.kind === kind) &&
        (tag === "all" || choice.tags.includes(tag))
      );
    });
  return (
    <div className="thing-picker-backdrop" onMouseDown={onClose}>
      <dialog
        className="thing-picker"
        open
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        <header>
          <div>
            <p className="eyebrow">LINK ANOTHER PAGE</p>
            <h2>Add Thing</h2>
          </div>
          <button aria-label="Close Add Thing" onClick={onClose}>
            ×
          </button>
        </header>
        {creating ? (
          <section className="thing-create-form">
            <label>
              Name
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </label>
            <label>
              Kind
              <select
                value={newKind}
                onChange={(e) => setNewKind(e.target.value as typeof newKind)}
              >
                {[
                  "place",
                  "character",
                  "item",
                  "vehicle",
                  "creature",
                  "object",
                  "other",
                ].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <div className="actions">
              <button onClick={() => setCreating(false)}>Back</button>
              <button
                className="primary"
                disabled={!newName.trim()}
                onClick={() => onCreate(newName.trim(), newKind)}
              >
                Create, place, and open
              </button>
            </div>
          </section>
        ) : (
          <>
            <div className="thing-picker-filters">
              <label className="search">
                Search
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="guard, sword, tavern…"
                />
              </label>
              <label>
                Source
                <select
                  value={source}
                  onChange={(e) => setSource(e.target.value as typeof source)}
                >
                  <option value="all">All</option>
                  <option value="published">Published World</option>
                  <option value="local">My Things</option>
                </select>
              </label>
              <label>
                Kind
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="all">All kinds</option>
                  {[
                    "place",
                    "character",
                    "item",
                    "vehicle",
                    "creature",
                    "object",
                    "other",
                  ].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label>
                Tag
                <select value={tag} onChange={(e) => setTag(e.target.value)}>
                  <option value="all">All tags</option>
                  {tags.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
            </div>
            <button className="primary" onClick={() => setCreating(true)}>
              ＋ Create new linked Thing
            </button>
            <section className="thing-card-grid compact thing-picker-results">
              {shown.map((choice) => (
                <button
                  className="thing-card"
                  key={`${choice.source}:${choice.id}`}
                  onClick={() => onPlace(choice.id)}
                >
                  <p className="eyebrow">
                    {choice.source === "local" ? "MY THING" : "PUBLISHED"} ·{" "}
                    {choice.kind}
                  </p>
                  <h3>{choice.name}</h3>
                  <p>{choice.description || "No description yet."}</p>
                  <small>{choice.id}</small>
                  <span>
                    {choice.tags.map((value) => `#${value}`).join(" ")}
                  </span>
                </button>
              ))}
              {!shown.length && <p>No Things match these filters.</p>}
            </section>
          </>
        )}
      </dialog>
    </div>
  );
}
function Home({
  openDraft,
  openPublished,
  newThing,
  mode,
}: {
  openDraft: (id: string) => void;
  openPublished: (e: ThingCatalogEntry) => void;
  newThing: () => void;
  mode: "world" | "things";
}) {
  const [drafts, setDrafts] = useState<LocalDraft[]>([]),
    [catalog, setCatalog] = useState<ThingCatalog>({
      version: 1,
      generatedAt: "",
      source: { repository: "", commit: "", rawBase: "" },
      things: [],
    }),
    [query, setQuery] = useState("");
  useEffect(() => {
    void listDrafts().then(setDrafts);
    void fetch(`${import.meta.env.BASE_URL}catalog.json`)
      .then((r) => (r.ok ? r.json() : { version: 1, things: [] }))
      .then(setCatalog)
      .catch(() => {});
  }, []);
  const shown = catalog.things.filter((t) =>
    `${t.name} ${t.description} ${t.tags.join(" ")}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <main className="portable-home">
      <header className="portable-title">
        <span className="crest">W</span>
        <div>
          <p className="eyebrow">
            {mode === "world"
              ? "PUBLISHED GITHUB WORLD"
              : "LOCAL BROWSER LIBRARY"}
          </p>
          <h1>
            {mode === "world"
              ? "Things are pages. Pages link to Things."
              : "Your Things stay with you."}
          </h1>
          <p>
            {mode === "world"
              ? "Browse the published world and follow its links."
              : "Create, edit, import, and export portable GLB Things."}
          </p>
        </div>
      </header>
      <div className="actions">
        {mode === "things" && (
          <button className="primary" onClick={newThing}>
            ＋ New Thing
          </button>
        )}
        <label className="search">
          Search Things
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="tavern, character, item…"
          />
        </label>
      </div>
      {mode === "things" && (
        <section>
          <h2>Local drafts</h2>
          <div className="thing-card-grid">
            {drafts.map((d) => (
              <article className="thing-card" key={d.id}>
                <p className="eyebrow">LOCAL DRAFT</p>
                <h3>{d.name}</h3>
                <small>{new Date(d.updatedAt).toLocaleString()}</small>
                <div className="actions">
                  <button onClick={() => openDraft(d.id)}>Edit</button>
                  <button
                    onClick={() => {
                      if (confirm(`Delete ${d.name} from this browser?`))
                        void deleteDraft(d.id).then(() =>
                          setDrafts((v) => v.filter((x) => x.id !== d.id)),
                        );
                    }}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
          {!drafts.length && <p>No local drafts yet.</p>}
        </section>
      )}
      {mode === "world" && (
        <section>
          <h2>Published world</h2>
          <div className="thing-card-grid">
            {shown.map((t) => (
              <button
                className="thing-card"
                key={t.id}
                onClick={() => openPublished(t)}
              >
                <p className="eyebrow">{t.kind.toUpperCase()}</p>
                <h3>{t.name}</h3>
                <p>{t.description || "No description yet."}</p>
                <span>{t.tags.map((x) => `#${x}`).join(" ")}</span>
              </button>
            ))}
            {!shown.length && <p>No published Things match.</p>}
          </div>
        </section>
      )}
    </main>
  );
}
export default function EditorApp({
  homeMode = "world",
}: {
  homeMode?: "world" | "things";
}) {
  const [doc, setDoc] = useState<ThingDocument>(),
    [media, setMedia] = useState(new Map<string, EmbeddedMedia>()),
    [catalog, setCatalog] = useState(new Map<string, ThingCatalogEntry>()),
    [draftIndex, setDraftIndex] = useState(new Map<string, LocalDraft>()),
    [selected, setSelected] = useState(""),
    [history, setHistory] = useState<
      { doc: ThingDocument; media: Map<string, EmbeddedMedia> }[]
    >([]),
    [editing, setEditing] = useState(true),
    [tab, setTab] = useState<"Scene" | "Article" | "Document">("Scene"),
    [map, setMap] = useState(true),
    [dirty, setDirty] = useState(false),
    [status, setStatus] = useState("Saved locally"),
    [error, setError] = useState(""),
    [draw, setDraw] = useState(false),
    [tool, setTool] = useState<"pen" | "eraser">("pen"),
    [color, setColor] = useState("#f0b55a"),
    [width, setWidth] = useState(0.12);
  const [pickerOpen, setPickerOpen] = useState(false);
  const file = useRef<HTMLInputElement>(null),
    mediaFile = useRef<HTMLInputElement>(null),
    latest = useRef(doc);
  latest.current = doc;
  useEffect(() => {
    void fetch(`${import.meta.env.BASE_URL}catalog.json`)
      .then((r) => r.json())
      .then((c: ThingCatalog) =>
        setCatalog(new Map(c.things.map((t) => [t.id, t]))),
      )
      .catch(() => {});
    void listDrafts().then((drafts) =>
      setDraftIndex(new Map(drafts.map((draft) => [draft.id, draft]))),
    );
  }, []);
  useEffect(() => {
    if (!doc || !dirty) return;
    setStatus("Saving locally");
    const current = doc,
      t = setTimeout(
        () =>
          void saveDraft(current, media)
            .then(() => {
              if (latest.current === current) {
                setDirty(false);
                setStatus("Saved locally");
              }
            })
            .catch((e) => {
              setStatus("Storage failed");
              setError(e.message);
            }),
        400,
      );
    return () => clearTimeout(t);
  }, [doc, media, dirty]);
  const urls = useMemo(
    () =>
      new Map(
        [...media].map(([k, v]) => [
          k,
          URL.createObjectURL(new Blob([v.bytes], { type: v.mimeType })),
        ]),
      ),
    [media],
  );
  useEffect(
    () => () => {
      urls.forEach(URL.revokeObjectURL);
    },
    [urls],
  );
  const change = (fn: (d: ThingDocument) => void) => {
    if (!doc) return;
    const next = structuredClone(doc);
    fn(next);
    const parsed = ThingDocumentSchema.safeParse(next);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid Thing");
      return;
    }
    setDoc(parsed.data);
    setDirty(true);
    setError("");
  };
  const openImported = async (f: File) => {
    try {
      const imported = await importThingGlb(await f.arrayBuffer(), f.name);
      if (
        dirty &&
        !confirm("Open another Thing and discard unsaved in-memory changes?")
      )
        return;
      for (const related of imported.related)
        await saveDraft(related, imported.media);
      setDoc(imported.document);
      setMedia(imported.media);
      setSelected("");
      setHistory([]);
      setEditing(true);
      setDirty(true);
      setStatus(
        imported.related.length
          ? `Migrated ${imported.related.length + 1} Things from a v1 package`
          : "Imported GLB",
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const openImportedCollection = async (files: FileList) => {
    if (files.length === 1) return openImported(files[0]);
    try {
      if (
        dirty &&
        !confirm(
          "Import this collection and discard unsaved in-memory changes?",
        )
      )
        return;
      const imported = [];
      for (const file of [...files]) {
        if (!/\.glb$/i.test(file.name)) continue;
        const item = await importThingGlb(await file.arrayBuffer(), file.name);
        imported.push(item);
        await saveDraft(item.document, item.media);
        for (const related of item.related)
          await saveDraft(related, item.media);
      }
      if (!imported.length) throw new Error("Choose one or more GLB Things");
      const root =
        imported.find((x) => x.document.thing.tags?.includes("adventure")) ??
        imported[0];
      setDoc(root.document);
      setMedia(root.media);
      setSelected("");
      setHistory([]);
      setEditing(true);
      setDirty(false);
      setStatus(`Imported ${imported.length} Things locally`);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const openPublished = async (entry: ThingCatalogEntry, push = true) => {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}${entry.path}`);
      if (!response.ok) throw new Error(`Could not load ${entry.name}`);
      const imported = await importThingGlb(
        await response.arrayBuffer(),
        entry.path,
      );
      if (doc && push) setHistory((h) => [...h, { doc, media }]);
      setDoc(imported.document);
      setMedia(imported.media);
      setSelected("");
      setEditing(false);
      setDirty(false);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const navigate = async (targetId: string) => {
    const local = await loadDraft(targetId);
    if (local) {
      if (doc) setHistory((h) => [...h, { doc, media }]);
      setDoc(local.draft.document);
      setMedia(local.media);
      setEditing(true);
      setDirty(false);
      setSelected("");
      return;
    }
    const target = catalog.get(targetId);
    if (target) await openPublished(target);
    else {
      if (doc) setHistory((h) => [...h, { doc, media }]);
      setDoc(blank(`New Thing for ${targetId}`, targetId));
      setMedia(new Map());
      setEditing(true);
      setDirty(true);
      setSelected("");
    }
  };
  if (!doc)
    return (
      <>
        <Home
          mode={homeMode}
          newThing={() => {
            setDoc(blank());
            setMedia(new Map());
            setEditing(true);
            setDirty(true);
          }}
          openDraft={async (id) => {
            const x = await loadDraft(id);
            if (x) {
              setDoc(x.draft.document);
              setMedia(x.media);
              setEditing(true);
            }
          }}
          openPublished={(e) => void openPublished(e, false)}
        />
        <input
          ref={file}
          hidden
          type="file"
          accept=".glb"
          multiple
          onChange={(e) =>
            e.target.files && void openImportedCollection(e.target.files)
          }
        />
        {homeMode === "things" && (
          <button
            className="floating-open"
            onClick={() => file.current?.click()}
          >
            Open GLB collection
          </button>
        )}
      </>
    );
  const t = doc.thing,
    p = t.page,
    selectedPlacement = p.placements.find((x) => x.id === selected),
    scene: AreaScene = {
      ...emptyScene(),
      width: p.width,
      depth: p.depth,
      drawing: p.drawing,
      zones: p.zones,
      doors: p.doors,
      anchors: p.anchors,
      things: p.placements.map((x) => placementThing(x, catalog)),
    },
    background = faceSource(p.background, urls),
    faceVisual = t.face.visual
      ? {
          ...t.face.visual,
          assetId: faceSource(
            t.face.visual.mode === "model"
              ? t.face.media.model
              : t.face.media.token,
            urls,
          ),
        }
      : undefined;
  const drawingInteraction: DrawingInteraction | undefined =
    draw && editing
      ? {
          active: true,
          tool,
          color,
          width,
          actorId: "local_author",
          previews: [],
          onPreview: () => {},
          onStroke: (stroke: DrawingStroke) =>
            change((d) => {
              d.thing.page.drawing ??= { version: 1, strokes: [] };
              d.thing.page.drawing.strokes.push(stroke);
            }),
          onErase: (strokeId: string) =>
            change((d) => {
              if (d.thing.page.drawing)
                d.thing.page.drawing.strokes =
                  d.thing.page.drawing.strokes.filter((s) => s.id !== strokeId);
            }),
        }
      : undefined;
  const addPlacement = (target: string) => {
    const pid = id("placement");
    change((d) =>
      d.thing.page.placements.push({
        id: pid,
        targetId: target,
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
      }),
    );
    setSelected(pid);
    setPickerOpen(false);
  };
  const createLinkedThing = async (
    name: string,
    kind: ThingDocument["thing"]["kind"],
  ) => {
    if (!doc) return;
    const thingId = `${slug(name).toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`,
      child = blank(name, thingId);
    child.thing.kind = kind;
    const parent = structuredClone(doc),
      pid = id("placement");
    parent.thing.page.placements.push({
      id: pid,
      targetId: thingId,
      name,
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
    });
    try {
      const parsedParent = ThingDocumentSchema.parse(parent),
        parsedChild = ThingDocumentSchema.parse(child);
      await saveDraft(parsedParent, media);
      await saveDraft(parsedChild, new Map());
      setDraftIndex((current) =>
        new Map(current)
          .set(parsedParent.thing.id, {
            id: parsedParent.thing.id,
            name: parsedParent.thing.name,
            updatedAt: Date.now(),
            document: parsedParent,
          })
          .set(parsedChild.thing.id, {
            id: parsedChild.thing.id,
            name: parsedChild.thing.name,
            updatedAt: Date.now(),
            document: parsedChild,
          }),
      );
      setHistory((items) => [...items, { doc: parsedParent, media }]);
      setDoc(parsedChild);
      setMedia(new Map());
      setSelected("");
      setEditing(true);
      setDirty(false);
      setStatus("Created and saved locally");
      setPickerOpen(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const addMedia = async (
    slot: "token" | "artwork" | "model" | "background",
    f: File,
  ) => {
    try {
      const mime = fileMime(f),
        bytes = new Uint8Array(await f.arrayBuffer());
      if (bytes.length > 10 * 1024 * 1024)
        throw new Error("Media must be at most 10 MiB");
      if (mime === "model/gltf-binary")
        validateGlb(
          bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ),
        );
      const mid = id("media"),
        ref = {
          kind: "embedded" as const,
          mediaId: mid,
          type:
            mime === "model/gltf-binary"
              ? ("model" as const)
              : ("image" as const),
          mimeType: mime,
        };
      setMedia((m) => new Map(m).set(mid, { id: mid, mimeType: mime, bytes }));
      change((d) => {
        if (slot === "background") d.thing.page.background = ref;
        else d.thing.face.media[slot] = ref;
        if (slot === "token" || slot === "model")
          d.thing.face.visual = {
            mode: slot === "model" ? "model" : "token",
            width: 1.5,
            height: 1.5,
            anchor: [0.5, 0.5],
            footprint: [1, 1],
          };
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const visiblePlacements = p.placements.filter((x) => editing || !x.hidden);
  const destinationAnchors = selectedPlacement
    ? (draftIndex.get(selectedPlacement.targetId)?.document.thing.page
        .anchors ??
      catalog.get(selectedPlacement.targetId)?.anchors ??
      [])
    : [];
  return (
    <main className="workspace portable-workspace">
      <header className="portable-header">
        <button className="brand" onClick={() => setDoc(undefined)}>
          W{" "}
          <span>
            WikiTop<small>GITHUB WORLD · GLB THINGS</small>
          </span>
        </button>
        <button
          disabled={!history.length}
          onClick={() => {
            const prev = history.at(-1);
            if (prev) {
              setDoc(prev.doc);
              setMedia(prev.media);
              setHistory((h) => h.slice(0, -1));
              setSelected("");
            }
          }}
        >
          ← Back
        </button>
        <span className="save-state">
          {editing ? (dirty ? "Unsaved locally" : status) : "Published"}
        </span>
        <div className="actions">
          <button onClick={() => setEditing(true)}>
            {editing ? "Editing" : "Edit local copy"}
          </button>
          <button onClick={() => file.current?.click()}>Open GLB</button>
          <button
            className="primary"
            onClick={() =>
              void exportThingGlb(doc, media)
                .then((b) => download(b, t.name))
                .catch((e) => setError(e.message))
            }
          >
            Export GLB
          </button>
        </div>
        <input
          ref={file}
          hidden
          type="file"
          accept=".glb"
          multiple
          onChange={(e) =>
            e.target.files && void openImportedCollection(e.target.files)
          }
        />
      </header>
      {error && (
        <div className="alert">
          {error}
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}
      <div className="workspace-bar">
        <div>
          <p className="eyebrow">VIEWING THING</p>
          <h2>{t.name}</h2>
          <nav>
            {history.map((x, i) => (
              <span key={i}>{x.doc.thing.name} / </span>
            ))}
            <strong>{t.name}</strong>
          </nav>
        </div>
        <div className="actions">
          {editing && (
            <>
              <button onClick={() => setPickerOpen(true)}>＋ Add Thing</button>
              <button
                className={draw ? "active" : ""}
                onClick={() => setDraw((v) => !v)}
              >
                ✎ Draw
              </button>
              {draw && (
                <>
                  <button
                    onClick={() => setTool(tool === "pen" ? "eraser" : "pen")}
                  >
                    {tool}
                  </button>
                  <input
                    aria-label="Ink color"
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                  />
                  <input
                    aria-label="Ink width"
                    type="range"
                    min="0.03"
                    max="1"
                    step="0.01"
                    value={width}
                    onChange={(e) => setWidth(Number(e.target.value))}
                  />
                </>
              )}
            </>
          )}
        </div>
      </div>
      {pickerOpen && (
        <AddThingDialog
          catalog={catalog}
          onPlace={addPlacement}
          onCreate={(name, kind) => void createLinkedThing(name, kind)}
          onClose={() => setPickerOpen(false)}
        />
      )}
      <div className="workspace-grid">
        <aside className="panel tools">
          <p className="eyebrow">LINKED THINGS</p>
          <nav className="portable-tree">
            {visiblePlacements.map((x) => (
              <div
                className={`portable-tree-row ${selected === x.id ? "selected" : ""}`}
                key={x.id}
              >
                <button onClick={() => setSelected(x.id)}>
                  {x.hidden ? "◌ " : ""}
                  {x.partyExit ? "⇥ " : ""}
                  {catalog.get(x.targetId)?.name ?? x.name ?? x.targetId}
                </button>
                <button
                  aria-label={`Open ${x.targetId}`}
                  onClick={() => void navigate(x.targetId)}
                >
                  ↳
                </button>
              </div>
            ))}
          </nav>
          {!visiblePlacements.length && <p>This page has no placements yet.</p>}
          <h3>Face</h3>
          {faceVisual ? (
            <p>
              {faceVisual.mode} · {faceVisual.width} × {faceVisual.height}
            </p>
          ) : (
            <p>Uses its name as a map label.</p>
          )}
          <p>
            <small>
              The face is how this Thing appears when another page places it.
            </small>
          </p>
        </aside>
        <section className="viewport">
          <div className="view-toggle">
            {(["Scene", "Article", "Document"] as const).map((v) => (
              <button
                className={tab === v ? "active" : ""}
                key={v}
                onClick={() => setTab(v)}
              >
                {v}
              </button>
            ))}
            {tab === "Scene" && (
              <>
                <button
                  className={map ? "active" : ""}
                  onClick={() => setMap(true)}
                >
                  2D
                </button>
                <button
                  className={!map ? "active" : ""}
                  onClick={() => setMap(false)}
                >
                  3D
                </button>
              </>
            )}
          </div>
          {tab === "Scene" ? (
            <Suspense fallback={<p>Loading scene…</p>}>
              <Scene
                scene={scene}
                map={map}
                selected={selected}
                onSelect={setSelected}
                editing={editing && !draw}
                showHidden={editing}
                interior
                fit
                backgroundAssetId={background}
                drawingInteraction={drawingInteraction}
                onDrag={(pid, pos) =>
                  change((d) => {
                    const x = d.thing.page.placements.find((y) => y.id === pid);
                    if (x) x.position = pos;
                  })
                }
              />
            </Suspense>
          ) : tab === "Article" ? (
            <article className="thing-article">
              <h1>{t.name}</h1>
              <ReactMarkdown skipHtml>{t.description}</ReactMarkdown>
              <StatBlockView block={t.statBlock} />
              <h2>Links</h2>
              <ul>
                {visiblePlacements.map((x) => (
                  <li key={x.id}>
                    <button onClick={() => void navigate(x.targetId)}>
                      {x.partyExit ? "⇥ " : ""}
                      {catalog.get(x.targetId)?.name ?? x.targetId}
                    </button>{" "}
                    · XYZ {x.position.join(", ")}
                  </li>
                ))}
              </ul>
            </article>
          ) : (
            <pre className="document-preview">
              {JSON.stringify(doc, null, 2)}
            </pre>
          )}
        </section>
        <aside className="panel inspector">
          <h3>
            {selectedPlacement
              ? selectedPlacement.partyExit
                ? "⇥ Party exit"
                : "Placement"
              : "Thing"}
          </h3>
          {selectedPlacement ? (
            <>
              <label>
                Label
                <input
                  value={selectedPlacement.name ?? ""}
                  placeholder={
                    catalog.get(selectedPlacement.targetId)?.name ??
                    selectedPlacement.targetId
                  }
                  onChange={(e) =>
                    change((d) => {
                      d.thing.page.placements.find(
                        (x) => x.id === selected,
                      )!.name = e.target.value || undefined;
                    })
                  }
                />
              </label>
              <label>
                Target ID
                <input
                  value={selectedPlacement.targetId}
                  onChange={(e) =>
                    change((d) => {
                      d.thing.page.placements.find(
                        (x) => x.id === selected,
                      )!.targetId = e.target.value;
                    })
                  }
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(selectedPlacement.hidden)}
                  onChange={(e) =>
                    change((d) => {
                      d.thing.page.placements.find(
                        (x) => x.id === selected,
                      )!.hidden = e.target.checked || undefined;
                    })
                  }
                />{" "}
                Hidden from players
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={Boolean(selectedPlacement.partyExit)}
                  onChange={(e) =>
                    change((d) => {
                      const placement = d.thing.page.placements.find(
                        (x) => x.id === selected,
                      )!;
                      placement.partyExit = e.target.checked ? {} : undefined;
                    })
                  }
                />
                Party exit
              </label>
              {selectedPlacement.partyExit && (
                <>
                  <label>
                    Arrival anchor
                    <select
                      value={selectedPlacement.partyExit.anchorId ?? ""}
                      disabled={!destinationAnchors.length}
                      onChange={(e) =>
                        change((d) => {
                          d.thing.page.placements.find(
                            (x) => x.id === selected,
                          )!.partyExit = {
                            anchorId: e.target.value || undefined,
                          };
                        })
                      }
                    >
                      <option value="">First destination anchor</option>
                      {destinationAnchors.map((anchor) => (
                        <option key={anchor.id} value={anchor.id}>
                          {anchor.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!destinationAnchors.length && (
                    <p className="warning">
                      Destination unavailable or has no usable arrival anchor.
                    </p>
                  )}
                </>
              )}
              <button onClick={() => void navigate(selectedPlacement.targetId)}>
                {catalog.has(selectedPlacement.targetId)
                  ? "Open Thing"
                  : "Create missing Thing"}
              </button>
              {editing && (
                <button
                  className="danger"
                  onClick={() => {
                    change((d) => {
                      d.thing.page.placements = d.thing.page.placements.filter(
                        (x) => x.id !== selected,
                      );
                    });
                    setSelected("");
                  }}
                >
                  Remove placement
                </button>
              )}
            </>
          ) : (
            <>
              <label>
                Name
                <input
                  disabled={!editing}
                  value={t.name}
                  onChange={(e) =>
                    change((d) => {
                      d.thing.name = e.target.value;
                    })
                  }
                />
              </label>
              <label>
                Description
                <textarea
                  disabled={!editing}
                  value={t.description}
                  onChange={(e) =>
                    change((d) => {
                      d.thing.description = e.target.value;
                    })
                  }
                />
              </label>
              <StatBlockView block={t.statBlock} />
              <label>
                Kind
                <select
                  disabled={!editing}
                  value={t.kind}
                  onChange={(e) =>
                    change((d) => {
                      d.thing.kind = e.target.value as typeof t.kind;
                    })
                  }
                >
                  {[
                    "character",
                    "place",
                    "item",
                    "vehicle",
                    "creature",
                    "object",
                    "other",
                  ].map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
              </label>
              <label>
                Tags
                <input
                  disabled={!editing}
                  value={(t.tags ?? []).join(", ")}
                  onChange={(e) =>
                    change((d) => {
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
                  disabled={!editing}
                  type="number"
                  value={p.width}
                  onChange={(e) =>
                    change((d) => {
                      d.thing.page.width = Math.max(
                        0.1,
                        Number(e.target.value),
                      );
                    })
                  }
                />
              </label>
              <label>
                Page depth
                <input
                  disabled={!editing}
                  type="number"
                  value={p.depth}
                  onChange={(e) =>
                    change((d) => {
                      d.thing.page.depth = Math.max(
                        0.1,
                        Number(e.target.value),
                      );
                    })
                  }
                />
              </label>
              {editing &&
                (["token", "artwork", "model", "background"] as const).map(
                  (slot) => (
                    <fieldset className="media-field" key={slot}>
                      <legend>{slot}</legend>
                      <button
                        onClick={() => {
                          mediaFile.current?.setAttribute("data-slot", slot);
                          mediaFile.current?.click();
                        }}
                      >
                        Choose local file
                      </button>
                    </fieldset>
                  ),
                )}
              <input
                ref={mediaFile}
                hidden
                type="file"
                onChange={(e) => {
                  const f = e.target.files?.[0],
                    slot = e.target.getAttribute("data-slot") as
                      | "token"
                      | "artwork"
                      | "model"
                      | "background";
                  if (f) void addMedia(slot, f);
                  e.target.value = "";
                }}
              />
            </>
          )}
        </aside>
      </div>
    </main>
  );
}
