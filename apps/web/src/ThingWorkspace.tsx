import { lazy, Suspense, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  emptyScene,
  type ThingDocument,
  type DocumentThing,
  type MediaReference,
  type Thing,
  type Vec3,
  type AreaScene,
} from "@wikitop/shared";
import { api, uid } from "./api";
import { TagInput } from "./TagInput";
import FrontierActions from "./FrontierActions";
import { useThingDraft } from "./useThingDraft";
const Scene = lazy(() => import("./Scene"));
const mediaSource = (ref?: MediaReference) =>
  ref?.kind === "url"
    ? ref.url
    : ref?.kind === "asset"
      ? ref.assetId
      : undefined;
const defaults = () => ({
  width: 20,
  depth: 16,
  zones: [],
  doors: [],
  anchors: [{ id: "entrance", name: "Entrance", position: [0, 0, 0] as Vec3 }],
});
function sceneThing(doc: ThingDocument, id: string): Thing {
  const n = doc.nodes[id],
    p = doc.placements.find((p) => p.childId === id);
  return {
    id,
    name: n.name,
    description: n.description,
    role: n.role,
    tags: n.tags,
    visible: n.visible,
    peerable: n.peerable,
    value: n.value,
    position: p?.position ?? [0, 0, 0],
    rotation: p?.rotation ?? [0, 0, 0, 1],
    scale: p?.scale ?? [1, 1, 1],
    children: [],
    visual: n.visual
      ? {
          ...n.visual,
          assetId: mediaSource(
            n.visual.mode === "model" ? n.media.model : n.media.token,
          ),
          mapAssetId: mediaSource(n.media.token),
        }
      : undefined,
  };
}
export default function ThingWorkspace({
  rootId,
  accountId,
  onSaved,
}: {
  rootId: string;
  accountId: string;
  onSaved: () => Promise<unknown>;
}) {
  const {
    draft,
    document: doc,
    status,
    error,
    change,
    flush,
    reload,
    isClean,
  } = useThingDraft(rootId, accountId);
  const [destinations, setDestinations] = useState<
    { id: string; name: string }[]
  >([]);
  const [drawingZone, setDrawingZone] = useState(false);
  const [path, setPath] = useState<string[]>([]),
    [selected, setSelected] = useState(""),
    [map, setMap] = useState(true),
    [tab, setTab] = useState("Scene"),
    [notice, setNotice] = useState(""),
    [recipient, setRecipient] = useState(""),
    [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const cameras = useRef(
    new Map<
      string,
      { value?: { position: number[]; target: number[]; zoom: number } }
    >(),
  );
  if (!doc || !draft)
    return (
      <main className="library">
        <p>{error || "Loading Thing…"}</p>
      </main>
    );
  const validPath = path.filter((id) => !!doc.nodes[id]),
    currentId = validPath.at(-1) ?? rootId,
    current = doc.nodes[currentId];
  const children = doc.placements.filter((p) => p.parentId === currentId),
    node = doc.nodes[selected] ?? current,
    placement = doc.placements.find((p) => p.childId === node.id),
    space = current.space ?? defaults();
  const scene: AreaScene = {
    ...emptyScene(),
    ...space,
    things: children.map((p) => sceneThing(doc, p.childId)),
  };
  const endpoint =
      scene.doors.find((d) => d.id === selected) ??
      scene.anchors.find((a) => a.id === selected),
    zone = scene.zones.find((z) => z.id === selected);
  const canEdit = draft.canEdit;
  const patch = (p: Partial<DocumentThing>) =>
    change((d) => Object.assign(d.nodes[node.id], p));
  const act = async (fn: () => Promise<unknown>, message = "") => {
    setNotice("");
    try {
      await fn();
      setNotice(message);
    } catch (e) {
      setNotice((e as Error).message);
    }
  };
  const navigate = async (next: string[]) => {
    await flush();
    setPath(next);
    setSelected("");
  };
  const add = (preset: "item" | "container" | "attribute") => {
    const id = `thing_${uid()}`;
    change((d) => {
      const count = children.length;
      d.nodes[id] = {
        id,
        name:
          preset === "attribute"
            ? "New attribute"
            : preset === "container"
              ? "New container"
              : "New Thing",
        description: "",
        role: preset === "attribute" ? "attribute" : "spatial",
        visible: draft.sourceKind === "area",
        peerable: false,
        media: {},
        ...(preset === "attribute" ? { value: 0 } : {}),
        ...(preset === "container" ? { space: defaults() } : {}),
        ...(preset === "item"
          ? {
              visual: {
                mode: "token",
                width: 1.5,
                height: 1.5,
                anchor: [0.5, 0.5],
                footprint: [1, 1],
              },
            }
          : {}),
      };
      d.placements.push({
        parentId: currentId,
        childId: id,
        position: [(count % 5) * 2 - 4, Math.floor(count / 5) * 2 - 3, 0],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
      });
    });
    setSelected(id);
    return id;
  };
  const addVisual = (
    mode: "token" | "card" | "billboard" | "map" | "model",
  ) => {
    const id = add("item");
    change((d) => {
      const n = d.nodes[id];
      n.name =
        mode === "map"
          ? "Background"
          : mode === "model"
            ? "Crystal"
            : "New Thing";
      n.visual = {
        mode,
        width: mode === "map" ? space.width : 1.5,
        height: mode === "map" ? space.depth : 1.5,
        anchor: mode === "map" || mode === "token" ? [0.5, 0.5] : [0.5, 0],
        footprint: [1, 1],
      };
      n.media[mode === "model" ? "model" : "token"] = {
        kind: "asset",
        assetId:
          mode === "model"
            ? "sample_model"
            : mode === "map"
              ? "sample_map"
              : "sample_card",
      };
      if (mode === "map")
        d.placements.find((p) => p.childId === id)!.position = [0, 0, 0];
    });
  };
  const move = (p: Vec3) => {
    if (!canEdit || !placement || placement.parentId !== currentId) return;
    change((d) => {
      const target = d.placements.find((x) => x.childId === node.id)!;
      target.position = [
        Math.max(-space.width / 2, Math.min(space.width / 2, p[0])),
        Math.max(-space.depth / 2, Math.min(space.depth / 2, p[1])),
        placement.position[2],
      ];
    });
  };
  const sceneKey = `${currentId}:${map}`;
  if (!cameras.current.has(sceneKey)) cameras.current.set(sceneKey, {});
  const cameraMemory = cameras.current.get(sceneKey)!;
  const selectedIsThing = !!doc.nodes[selected] || !selected;
  const addEndpoint = (kind: "doors" | "anchors" | "zones") => {
    const id = uid();
    change((d) => {
      const n = d.nodes[currentId];
      n.space ??= defaults();
      if (kind === "zones")
        n.space.zones.push({
          id,
          name: "New zone",
          x: -2,
          y: -2,
          width: 4,
          depth: 4,
          priority: 0,
        });
      else
        n.space[kind].push({
          id,
          name: kind === "doors" ? "New door" : "Arrival point",
          position: [0, 0, 0],
        });
    });
    setSelected(id);
  };
  return (
    <main className="workspace thing-workspace" onBlur={() => void flush()}>
      <div className="workspace-bar">
        <div>
          <p className="eyebrow">
            {canEdit ? "OWNED DRAFT" : "PUBLISHED THING · READ ONLY"} ·{" "}
            <span role="status" aria-label="Save status">
              {status}
            </span>
          </p>
          <h2>{current.name}</h2>
          <nav aria-label="Thing breadcrumbs">
            <button onClick={() => void navigate([])}>
              {doc.nodes[rootId].name}
            </button>
            {validPath.map((id, i) => (
              <button
                key={id}
                onClick={() => void navigate(validPath.slice(0, i + 1))}
              >
                {" "}
                / {doc.nodes[id].name}
              </button>
            ))}
          </nav>
        </div>
        <div className="actions">
          {!!path.length && (
            <button onClick={() => void navigate(path.slice(0, -1))}>
              ← Back
            </button>
          )}
          {canEdit && <button onClick={() => void flush()}>Save now</button>}
          {draft.articleUrl && (
            <a
              className="button"
              href={draft.articleUrl}
              target="_blank"
              rel="noreferrer"
            >
              Edit wiki prose ↗
            </a>
          )}
          {draft.canPublish && (
            <button
              onClick={() =>
                void act(async () => {
                  await flush();
                  if (!isClean())
                    throw new Error("Resolve the draft save before publishing");
                  await api(`/api/areas/${rootId}/publish`, "POST");
                  await onSaved();
                }, "Published snapshot. Existing sessions keep their pinned versions.")
              }
            >
              Publish snapshot
            </button>
          )}
        </div>
      </div>
      {error && (
        <div className="alert" role="alert">
          {error}
          <button onClick={() => void flush()}>Retry save</button>
          {status === "Conflict" && (
            <>
              <button
                onClick={() =>
                  void navigator.clipboard.writeText(
                    JSON.stringify(doc, null, 2),
                  )
                }
              >
                Copy local document
              </button>
              <button onClick={() => void reload()}>Reload latest draft</button>
            </>
          )}
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      <div className="workspace-grid">
        <aside className="panel tools">
          <p className="eyebrow">CONTENTS OF {current.name}</p>
          <button onClick={() => setSelected(currentId)}>
            Inspect this Thing
          </button>
          {children.map((p) => (
            <div className="contents-row" key={p.childId}>
              <button
                className={node.id === p.childId ? "active" : ""}
                onClick={() => setSelected(p.childId)}
              >
                {doc.nodes[p.childId].name}
              </button>
              <button
                aria-label={`Open inside ${doc.nodes[p.childId].name}`}
                onClick={() => void navigate([...path, p.childId])}
              >
                ↳
              </button>
            </div>
          ))}
          {!children.length && <p>No contents yet.</p>}
          {canEdit && (
            <>
              <h3>Add a Thing</h3>
              <button onClick={() => add("item")}>＋ Thing</button>
              <button onClick={() => add("container")}>＋ Container</button>
              <button onClick={() => add("attribute")}>＋ Attribute</button>
              <button onClick={() => addVisual("card")}>
                ＋ Standing card
              </button>
              <button onClick={() => addVisual("billboard")}>
                ＋ Billboard
              </button>
              <button onClick={() => addVisual("map")}>＋ Background</button>
              <button onClick={() => addVisual("model")}>
                ＋ Sample model
              </button>
              <h3>Space layout</h3>
              <button onClick={() => addEndpoint("doors")}>＋ Door</button>
              <button onClick={() => addEndpoint("anchors")}>
                ＋ Arrival point
              </button>
              <button onClick={() => addEndpoint("zones")}>＋ Zone</button>
              <button
                onClick={() => {
                  setDrawingZone(!drawingZone);
                  setMap(true);
                }}
              >
                {drawingZone
                  ? "Drag ground to draw zone"
                  : "＋ Draw rectangular zone"}
              </button>
              <button
                onClick={() =>
                  change((d) => {
                    children.forEach((p, i) => {
                      const target = d.placements.find(
                        (x) => x.childId === p.childId,
                      )!;
                      const columns = Math.max(1, Math.floor(space.width / 2));
                      target.position = [
                        -space.width / 2 + 1 + (i % columns) * 2,
                        -space.depth / 2 + 1 + Math.floor(i / columns) * 2,
                        0,
                      ];
                    });
                  })
                }
              >
                Arrange on grid
              </button>
            </>
          )}
          {[...scene.doors, ...scene.anchors, ...scene.zones].map((e) => (
            <button
              className={selected === e.id ? "active" : ""}
              key={e.id}
              onClick={() => setSelected(e.id)}
            >
              {e.name}
            </button>
          ))}
          <p className="muted">
            Left-click selects. Right-click moves a selected direct child.
            Opening a Thing changes your view, never your live location.
          </p>
        </aside>
        <section className="viewport">
          <div className="view-toggle">
            {["Scene", "Article", "Document"].map((t) => (
              <button
                key={t}
                className={tab === t ? "active" : ""}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
            {tab === "Scene" && (
              <>
                <button
                  className={map ? "active" : ""}
                  onClick={() => setMap(true)}
                >
                  2D Map
                </button>
                <button
                  className={!map ? "active" : ""}
                  onClick={() => setMap(false)}
                >
                  3D Scene
                </button>
              </>
            )}
          </div>
          {tab === "Scene" ? (
            <Suspense fallback={<p>Loading scene…</p>}>
              <Scene
                key={sceneKey}
                scene={scene}
                map={map}
                selected={selected}
                onSelect={setSelected}
                onMove={move}
                onDrawZone={
                  canEdit && drawingZone
                    ? (start, end) => {
                        const id = uid();
                        change((d) => {
                          d.nodes[currentId].space ??= defaults();
                          d.nodes[currentId].space!.zones.push({
                            id,
                            name: "New zone",
                            x: Math.min(start[0], end[0]),
                            y: Math.min(start[1], end[1]),
                            width: Math.max(0.1, Math.abs(end[0] - start[0])),
                            depth: Math.max(0.1, Math.abs(end[1] - start[1])),
                            priority: 0,
                          });
                        });
                        setDrawingZone(false);
                        setSelected(id);
                      }
                    : undefined
                }
                interior
                fit={!cameraMemory.value}
                cameraMemory={cameraMemory}
                backgroundAssetId={mediaSource(
                  current.media.background ?? current.media.artwork,
                )}
              />
            </Suspense>
          ) : tab === "Article" ? (
            <article className="thing-article">
              <h1>{current.name}</h1>
              <ReactMarkdown skipHtml>{current.description}</ReactMarkdown>
              <h2>Contents</h2>
              <ul>
                {children.map((p) => (
                  <li key={p.childId}>
                    <button onClick={() => void navigate([...path, p.childId])}>
                      {doc.nodes[p.childId].name}
                    </button>{" "}
                    · XYZ {p.position.join(", ")}
                  </li>
                ))}
              </ul>
              <details>
                <summary>Structured Thing data</summary>
                <pre>
                  {JSON.stringify(
                    { thing: current, placements: children },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </article>
          ) : (
            <pre className="document-preview">
              {JSON.stringify(doc, null, 2)}
            </pre>
          )}
        </section>
        <aside className="panel inspector">
          <h3>{endpoint?.name ?? zone?.name ?? node.name}</h3>
          <fieldset disabled={!canEdit} className="thing-fields">
            {selectedIsThing ? (
              <>
                <label>
                  Name
                  <input
                    value={node.name}
                    maxLength={120}
                    onChange={(e) => patch({ name: e.target.value })}
                  />
                </label>
                <label>
                  Description
                  <textarea
                    value={node.description}
                    onChange={(e) => patch({ description: e.target.value })}
                  />
                </label>
                <TagInput
                  value={node.tags ?? []}
                  onChange={(tags) => patch({ tags })}
                />
                <p>
                  {node.character
                    ? "Character capability · can be joined as in a session"
                    : "Thing"}
                  {node.space ? " · contains a space" : ""}
                </p>
                <button
                  type="button"
                  onClick={() =>
                    void navigate(
                      node.id === currentId ? path : [...path, node.id],
                    )
                  }
                >
                  Open inside
                </button>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={
                      node.visible ??
                      (node.id === rootId || draft.sourceKind === "area")
                    }
                    onChange={(e) => patch({ visible: e.target.checked })}
                  />
                  Visible
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={
                      node.peerable ??
                      (node.id === rootId ||
                        (draft.sourceKind === "area" &&
                          node.contentsVisibility !== "controllers"))
                    }
                    onChange={(e) => patch({ peerable: e.target.checked })}
                  />
                  Peerable
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={node.portable ?? false}
                    onChange={(e) => patch({ portable: e.target.checked })}
                  />
                  Portable item
                </label>
                <label>
                  Role
                  <select
                    value={node.role}
                    onChange={(e) =>
                      patch({ role: e.target.value as DocumentThing["role"] })
                    }
                  >
                    {["spatial", "inventory", "attribute", "structure"].map(
                      (r) => (
                        <option key={r}>{r}</option>
                      ),
                    )}
                  </select>
                </label>
                {node.role === "attribute" && (
                  <>
                    <label>
                      Value type
                      <select
                        value={node.value === null ? "null" : typeof node.value}
                        onChange={(e) =>
                          patch({
                            value:
                              e.target.value === "number"
                                ? 0
                                : e.target.value === "boolean"
                                  ? false
                                  : e.target.value === "null"
                                    ? null
                                    : "",
                          })
                        }
                      >
                        <option>string</option>
                        <option>number</option>
                        <option>boolean</option>
                        <option>null</option>
                      </select>
                    </label>
                    <label>
                      Value
                      <input
                        value={String(node.value ?? "")}
                        onChange={(e) =>
                          patch({
                            value:
                              typeof node.value === "number"
                                ? Number(e.target.value)
                                : typeof node.value === "boolean"
                                  ? e.target.value === "true"
                                  : e.target.value,
                          })
                        }
                      />
                    </label>
                  </>
                )}
                {(["token", "artwork", "background", "model"] as const).map(
                  (slot) => (
                    <MediaField
                      key={`${node.id}:${slot}`}
                      label={
                        slot === "token"
                          ? "Map token"
                          : slot === "artwork"
                            ? "Full artwork"
                            : slot === "background"
                              ? "Background"
                              : "3D model"
                      }
                      type={slot === "model" ? "model" : "image"}
                      value={node.media[slot]}
                      disabled={!canEdit}
                      change={(ref) => {
                        change((d) => {
                          const n = d.nodes[node.id];
                          if (ref) n.media[slot] = ref;
                          else delete n.media[slot];
                          if (slot === "token" || slot === "model") {
                            n.visual ??= {
                              mode: "token",
                              width: 1.5,
                              height: 1.5,
                              anchor: [0.5, 0.5],
                              footprint: [1, 1],
                            };
                            if (slot === "model" && ref)
                              n.visual.mode = "model";
                            if (slot === "model" && !ref)
                              n.visual.mode = "token";
                          }
                          if (slot === "background" && ref)
                            n.space ??= defaults();
                        });
                      }}
                    />
                  ),
                )}
                {node.visual && (
                  <>
                    <label>
                      Presentation
                      <select
                        aria-label="Presentation"
                        value={node.visual.mode}
                        onChange={(e) =>
                          patch({
                            visual: {
                              ...node.visual!,
                              mode: e.target.value as any,
                            },
                          })
                        }
                      >
                        {[
                          "token",
                          "card",
                          "billboard",
                          "map",
                          ...(node.media.model ? ["model"] : []),
                        ].map((mode) => (
                          <option key={mode} value={mode}>
                            {mode === "map" ? "Background surface" : mode}
                          </option>
                        ))}
                      </select>
                    </label>
                    {(["width", "height"] as const).map((k) => (
                      <NumberInput
                        key={k}
                        label={`Visual ${k}`}
                        value={node.visual![k]}
                        change={(v) =>
                          patch({ visual: { ...node.visual!, [k]: v } })
                        }
                      />
                    ))}
                    {([0, 1] as const).map((i) => (
                      <NumberInput
                        key={`anchor${i}`}
                        label={`Anchor ${i === 0 ? "horizontal" : "vertical"}`}
                        value={node.visual!.anchor[i]}
                        change={(v) => {
                          const anchor = [...node.visual!.anchor] as [
                            number,
                            number,
                          ];
                          anchor[i] = v;
                          patch({ visual: { ...node.visual!, anchor } });
                        }}
                      />
                    ))}
                  </>
                )}
                {node.visual &&
                  ([0, 1] as const).map((i) => (
                    <NumberInput
                      key={`footprint${i}`}
                      label={`Footprint ${i === 0 ? "width" : "depth"}`}
                      value={node.visual!.footprint[i]}
                      change={(value) => {
                        const footprint = [...node.visual!.footprint] as [
                          number,
                          number,
                        ];
                        footprint[i] = value;
                        patch({ visual: { ...node.visual!, footprint } });
                      }}
                    />
                  ))}
                <details>
                  <summary>Physical travel link</summary>
                  <button
                    type="button"
                    onClick={() =>
                      void act(async () => {
                        const library = await api("/api/library");
                        setDestinations(library.areas);
                      })
                    }
                  >
                    Choose linked place
                  </button>
                  <label>
                    Travel destination
                    <select
                      aria-label="Travel destination"
                      value={node.interiorAreaId ?? ""}
                      onChange={(e) =>
                        patch({ interiorAreaId: e.target.value || undefined })
                      }
                    >
                      <option value="">No physical travel link</option>
                      {node.interiorAreaId &&
                        !destinations.some(
                          (d) => d.id === node.interiorAreaId,
                        ) && (
                          <option value={node.interiorAreaId}>
                            Current destination
                          </option>
                        )}
                      {destinations.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <small>
                    Links offer physical travel during play. Opening contents
                    here only changes the view.
                  </small>
                </details>
                {!node.space ? (
                  <button
                    type="button"
                    onClick={() => patch({ space: defaults() })}
                  >
                    Add interior space
                  </button>
                ) : (
                  <>
                    <h3>Interior space</h3>
                    <NumberInput
                      label="Space width"
                      value={node.space.width}
                      change={(width) =>
                        patch({ space: { ...node.space!, width } })
                      }
                    />
                    <NumberInput
                      label="Space depth"
                      value={node.space.depth}
                      change={(depth) =>
                        patch({ space: { ...node.space!, depth } })
                      }
                    />
                  </>
                )}
                {placement && (
                  <>
                    <h3>Relative transform</h3>
                    {(["X", "Y", "Z"] as const).map((label, i) => (
                      <NumberInput
                        key={label}
                        label={label}
                        value={placement.position[i]}
                        change={(v) =>
                          change((d) => {
                            d.placements.find(
                              (p) => p.childId === node.id,
                            )!.position[i] = v;
                          })
                        }
                      />
                    ))}
                    {placement.rotation.map((v, i) => (
                      <NumberInput
                        key={`q${i}`}
                        label={`Quaternion ${["X", "Y", "Z", "W"][i]}`}
                        value={v}
                        change={(value) =>
                          change((d) => {
                            const rotation = d.placements.find(
                              (p) => p.childId === node.id,
                            )!.rotation;
                            rotation[i] = value;
                            const length = Math.hypot(...rotation);
                            if (length)
                              for (let j = 0; j < 4; j++) rotation[j] /= length;
                          })
                        }
                      />
                    ))}
                    {placement.scale.map((v, i) => (
                      <NumberInput
                        key={`s${i}`}
                        label={`Scale ${["X", "Y", "Z"][i]}`}
                        value={v}
                        change={(value) =>
                          change((d) => {
                            d.placements.find(
                              (p) => p.childId === node.id,
                            )!.scale[i] = value;
                          })
                        }
                      />
                    ))}
                    <label>
                      Parent space
                      <select
                        aria-label="Parent space"
                        value={placement.parentId}
                        onChange={(e) => {
                          const parentId = e.target.value;
                          change((d) => {
                            d.placements.find(
                              (p) => p.childId === node.id,
                            )!.parentId = parentId;
                          });
                          setSelected("");
                        }}
                      >
                        {Object.values(doc.nodes)
                          .filter((n) => {
                            if (n.id === node.id) return false;
                            let id = n.id;
                            const seen = new Set<string>();
                            while (id !== rootId) {
                              if (id === node.id || seen.has(id)) return false;
                              seen.add(id);
                              id =
                                doc.placements.find((p) => p.childId === id)
                                  ?.parentId ?? rootId;
                            }
                            return true;
                          })
                          .map((n) => (
                            <option key={n.id} value={n.id}>
                              {n.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <small>Reparenting keeps local coordinates.</small>
                    <button
                      onClick={() => {
                        change((d) => {
                          const remove = (id: string) => {
                            for (const p of d.placements.filter(
                              (p) => p.parentId === id,
                            ))
                              remove(p.childId);
                            delete d.nodes[id];
                            d.placements = d.placements.filter(
                              (p) => p.childId !== id,
                            );
                          };
                          remove(node.id);
                        });
                        setSelected("");
                      }}
                    >
                      Delete Thing and contents
                    </button>
                  </>
                )}
              </>
            ) : (
              <>
                <label>
                  Name
                  <input
                    value={endpoint?.name ?? zone?.name ?? ""}
                    onChange={(e) =>
                      change((d) => {
                        const s = d.nodes[currentId].space!;
                        const entry = [
                          ...s.doors,
                          ...s.anchors,
                          ...s.zones,
                        ].find((x) => x.id === selected)!;
                        entry.name = e.target.value;
                      })
                    }
                  />
                </label>
                {endpoint &&
                  endpoint.position.map((v, i) => (
                    <NumberInput
                      key={i}
                      label={["X", "Y", "Z"][i]}
                      value={v}
                      change={(value) =>
                        change((d) => {
                          const s = d.nodes[currentId].space!;
                          [...s.doors, ...s.anchors].find(
                            (x) => x.id === selected,
                          )!.position[i] = value;
                        })
                      }
                    />
                  ))}
                {zone &&
                  (["x", "y", "width", "depth", "priority"] as const).map(
                    (k) => (
                      <NumberInput
                        key={k}
                        label={`Zone ${k}`}
                        value={zone[k]}
                        change={(value) =>
                          change((d) => {
                            d.nodes[currentId].space!.zones.find(
                              (z) => z.id === selected,
                            )![k] = value;
                          })
                        }
                      />
                    ),
                  )}
                {scene.doors.some((d) => d.id === selected) &&
                  currentId === rootId &&
                  draft.sourceKind === "area" && (
                    <>
                      {draft.unconnectedDoorIds?.includes(selected) && (
                        <FrontierActions
                          key={selected}
                          areaId={rootId}
                          doorId={selected}
                          owner={draft.ownerId === accountId}
                          ownerId={draft.ownerId}
                          disabled={status !== "Saved"}
                        />
                      )}
                      <button
                        onClick={() =>
                          void act(async () => {
                            const lib = await api("/api/library");
                            setAccounts(
                              lib.accounts.filter(
                                (a: any) => a.id !== accountId,
                              ),
                            );
                          })
                        }
                      >
                        Choose invited author
                      </button>
                      <select
                        aria-label="Invited author"
                        value={recipient}
                        onChange={(e) => setRecipient(e.target.value)}
                      >
                        <option value="">Choose author</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                      <button
                        disabled={!recipient || status !== "Saved"}
                        onClick={() =>
                          void act(
                            () =>
                              api("/api/invitations", "POST", {
                                sourceAreaId: rootId,
                                doorId: selected,
                                recipientId: recipient,
                              }),
                            "Invitation sent. Review it in Connections.",
                          )
                        }
                      >
                        Invite to connect
                      </button>
                    </>
                  )}
                <button
                  onClick={() =>
                    change((d) => {
                      const s = d.nodes[currentId].space!;
                      s.doors = s.doors.filter((x) => x.id !== selected);
                      s.zones = s.zones.filter((x) => x.id !== selected);
                      s.anchors = s.anchors.filter((x) => x.id !== selected);
                      setSelected("");
                    })
                  }
                >
                  Delete endpoint / zone
                </button>
              </>
            )}
          </fieldset>
          {!canEdit && (
            <button
              onClick={() =>
                void navigate(node.id === currentId ? path : [...path, node.id])
              }
            >
              Open inside
            </button>
          )}
        </aside>
      </div>
    </main>
  );
}
function NumberInput({
  label,
  value,
  change,
}: {
  label: string;
  value: number;
  change: (value: number) => void;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        step="any"
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) change(n);
        }}
      />
    </label>
  );
}
function MediaField({
  label,
  type,
  value,
  disabled,
  change,
}: {
  label: string;
  type: "image" | "model";
  value?: MediaReference;
  disabled: boolean;
  change: (value?: MediaReference) => void;
}) {
  const [url, setUrl] = useState(value?.kind === "url" ? value.url : ""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <fieldset disabled={disabled || busy} className="media-field">
      <legend>{label}</legend>
      <label>
        Upload {label}
        <input
          type="file"
          accept={
            type === "model"
              ? ".glb,model/gltf-binary"
              : "image/png,image/jpeg,image/webp"
          }
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setBusy(true);
            setError("");
            const form = new FormData();
            form.append("file", file);
            void api("/api/assets", "POST", form)
              .then((asset) => change({ kind: "asset", assetId: asset.id }))
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        />
      </label>
      <label>
        {label} URL
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
        />
      </label>
      <button
        type="button"
        onClick={() => {
          try {
            const u = new URL(url);
            if (u.protocol !== "https:" || u.username || u.password)
              throw new Error("Use an HTTPS URL without credentials");
            setError("");
            change({ kind: "url", type, url: u.href });
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        Use URL for {label}
      </button>
      {value && (
        <>
          <small>
            {value.kind === "url"
              ? "External media · not archived. CORS must allow access."
              : value.kind === "asset"
                ? `Stored asset ${value.assetId}`
                : `Embedded media ${value.mediaId}`}
          </small>
          <button type="button" onClick={() => change(undefined)}>
            Remove {label}
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
