import { useDrawing } from "./useDrawing";
import ThingWorkspace from "./ThingWorkspace";
import CharacterCards from "./CharacterCards";
import FrontierActions from "./FrontierActions";
import { TagInput } from "./TagInput";
import React, { Suspense, lazy, useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import { io, type Socket } from "socket.io-client";
import {
  emptyScene,
  flattenThings,
  type Area,
  type Character,
  type ViewTarget,
  type Space,
  type AreaScene,
  type Thing,
  type Vec3,
  type PlaySnapshot,
  type Command,
  type PlaySession,
} from "@wikitop/shared";
import { api, uid } from "./api";
import "./style.css";
const Scene = lazy(() => import("./Scene"));
type Library = {
  account: { id: string; name: string };
  accounts: { id: string; name: string; email: string }[];
  areas: Area[];
  invitations: any[];
  connections: any[];
  sessions: PlaySession[];
  characters: Character[];
};
type LibraryTab =
  | "My Content"
  | "Shared with Me"
  | "Characters"
  | "Sessions"
  | "Connections";
const libraryTabs: LibraryTab[] = [
  "My Content",
  "Shared with Me",
  "Characters",
  "Sessions",
  "Connections",
];
function App() {
  const [returnRequest, setReturnRequest] = useState(0),
    [swapping, setSwapping] = useState(false),
    [playCharacterName, setPlayCharacterName] = useState("");
  const [libraryTab, setLibraryTab] = useState<LibraryTab>("My Content");
  const [user, setUser] = useState<any>(),
    [library, setLibrary] = useState<Library>(),
    [devAccounts, setDevAccounts] = useState<any[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [view, setView] = useState<"library" | "editor" | "play">("library"),
    [areaId, setAreaId] = useState(""),
    [play, setPlay] = useState<{ sessionId: string; characterId: string }>();
  const load = async () => {
    const lib = await api<Library>("/api/library");
    setLibrary(lib);
    return lib;
  };
  const run = async (fn: () => Promise<any>, message?: string) => {
    setError("");
    setBusy(true);
    try {
      await fn();
      if (message) setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const target =
      new URLSearchParams(location.search).get("thing") ??
      new URLSearchParams(location.search).get("editArea");
    if (target && /^[a-zA-Z0-9_-]+$/.test(target)) {
      setAreaId(target);
      setView("editor");
    }
    api("/api/me")
      .then(async (me) => {
        setUser(me);
        await load();
      })
      .catch(() =>
        api("/api/dev/accounts")
          .then(setDevAccounts)
          .catch(() => {}),
      );
  }, []);
  if (!user)
    return (
      <main className="login">
        <div className="crest">W</div>
        <p className="eyebrow">A place for shared stories</p>
        <h1>
          Worlds worth
          <br />
          getting lost in.
        </h1>
        <p>
          Build a place. Open a door.
          <br />
          See what your friends put on the other side.
        </p>
        <a
          className="button primary"
          href={`/auth/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`}
        >
          Sign in to WikiTop ↗
        </a>
        {devAccounts.length > 0 && (
          <div className="dev">
            <small>
              LOCAL DEMO · separate browser profiles for multiplayer
            </small>
            {devAccounts.map((a) => (
              <button
                key={a.id}
                onClick={() =>
                  void run(async () => {
                    await api("/auth/dev", "POST", { accountId: a.id });
                    location.reload();
                  })
                }
              >
                Continue as {a.name}
              </button>
            ))}
          </div>
        )}
        {error && <p role="alert">{error}</p>}
      </main>
    );
  const articleMatch = location.pathname.match(
    /^\/articles\/([a-zA-Z0-9_-]+)$/,
  );
  if (articleMatch) return <ArticleReader areaId={articleMatch[1]} />;
  const contributionMatch = location.pathname.match(
    /^\/contribute\/([a-zA-Z0-9_-]+)$/,
  );
  if (contributionMatch)
    return <ContributionReader invitationId={contributionMatch[1]} />;
  return (
    <>
      <header className="header">
        <a className="brand" href="/">
          W
          <span>
            WikiTop<small>SHARED WORLDS</small>
          </span>
        </a>
        <nav>
          {libraryTabs.map((tab) => (
            <button
              key={tab}
              className={
                view === "library" && libraryTab === tab ? "active" : ""
              }
              onClick={() => {
                setLibraryTab(tab);
                setView("library");
                void run(load);
              }}
            >
              {tab}
            </button>
          ))}
          {view === "editor" && (
            <button className="active">Thing workspace</button>
          )}
          {play && (
            <button
              className={view === "play" ? "active" : ""}
              onClick={() => setView("play")}
            >
              Live session <span className="dot" />
            </button>
          )}
          <a href={user.wikiUrl} target="_blank" rel="noreferrer">
            Wiki ↗
          </a>
        </nav>
        {play ? (
          <div className="character-header-actions">
            <button
              aria-label="Return to character"
              title="Return to your character's location"
              onClick={() => {
                setSwapping(false);
                setReturnRequest((n) => n + 1);
                setView("play");
              }}
            >
              {playCharacterName ||
                library?.characters.find((c) => c.id === play.characterId)
                  ?.name ||
                "Your character"}
            </button>
            <button
              aria-label="Swap character"
              title="Choose a different character"
              onClick={() => {
                setSwapping(true);
                setLibraryTab("Characters");
                setView("library");
                void run(load);
              }}
            >
              ⇄
            </button>
          </div>
        ) : (
          <span className="account">{user.account.name}</span>
        )}
        <button
          onClick={() =>
            void run(async () => {
              await api("/auth/logout", "POST");
              location.reload();
            })
          }
        >
          Sign out
        </button>
      </header>
      {error && (
        <div className="alert" role="alert">
          {error}
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
          <button onClick={() => setNotice("")}>×</button>
        </div>
      )}
      {busy && <div className="progress" />}
      {view === "library" && library && (
        <LibraryView
          tab={libraryTab}
          swap={
            swapping && play
              ? {
                  characterId: play.characterId,
                  choose: async (id: string) => {
                    await api(`/api/sessions/${play.sessionId}/join`, "POST", {
                      characterId: id,
                    });
                    setPlay({ ...play, characterId: id });
                    setPlayCharacterName(
                      library.characters.find((c) => c.id === id)?.name ?? "",
                    );
                    setSwapping(false);
                    setView("play");
                  },
                  cancel: () => {
                    setSwapping(false);
                    setView("play");
                  },
                }
              : undefined
          }
          data={library}
          run={run}
          refresh={load}
          edit={(id) => {
            setAreaId(id);
            setView("editor");
          }}
          join={async (sessionId, characterId, characterIds) => {
            await api(`/api/sessions/${sessionId}/join-characters`, "POST", {
              characterIds,
            });
            setPlayCharacterName(
              library.characters.find((c) => c.id === characterId)?.name ?? "",
            );
            setSwapping(false);
            setPlay({ sessionId, characterId });
            setView("play");
          }}
        />
      )}
      {view === "editor" && (
        <ThingWorkspace
          key={areaId}
          rootId={areaId}
          accountId={user.account.id}
          onSaved={load}
        />
      )}
      {view === "play" && play && (
        <Play
          key={`${play.sessionId}-${play.characterId}`}
          {...play}
          returnRequest={returnRequest}
          onCharacterName={setPlayCharacterName}
          run={run}
          onLeave={() => {
            setPlay(undefined);
            setView("library");
            void load();
          }}
        />
      )}
    </>
  );
}
type Run = (fn: () => Promise<any>, message?: string) => Promise<void>;
function LibraryView({
  data: d,
  tab,
  run,
  refresh,
  edit,
  join,
  swap,
}: {
  swap?: {
    characterId: string;
    choose: (id: string) => Promise<void>;
    cancel: () => void;
  };
  data: Library;
  tab: LibraryTab;
  run: Run;
  refresh: () => Promise<any>;
  edit: (id: string) => void;
  join: (s: string, c: string, characters: string[]) => Promise<void>;
}) {
  const [preset, setPreset] = useState("place");
  const [name, setName] = useState(""),
    [sessionName, setSessionName] = useState(""),
    [chosen, setChosen] = useState<string[]>([]),
    [characterId, setCharacterId] = useState(d.characters[0]?.id ?? ""),
    [recipient, setRecipient] = useState(
      d.accounts.find((a) => a.id !== d.account.id)?.id ?? "",
    ),
    [targets, setTargets] = useState<
      Record<string, { areaId: string; anchorId: string }>
    >({});
  const selectionKey = `wikitop:current-characters:${d.account.id}`;
  const [currentCharacters, setCurrentCharacters] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(selectionKey) ?? "null");
      if (Array.isArray(saved))
        return saved.filter((id): id is string => typeof id === "string");
    } catch {}
    return d.characters[0] ? [d.characters[0].id] : [];
  });
  const currentIds = currentCharacters.filter((id) =>
    d.characters.some((c) => c.id === id),
  );
  const saveCurrent = (ids: string[]) => {
    setCurrentCharacters(ids);
    try {
      localStorage.setItem(selectionKey, JSON.stringify(ids));
    } catch {}
  };
  const toggleCurrent = (id: string) =>
    saveCurrent(
      currentIds.includes(id)
        ? currentIds.filter((c) => c !== id)
        : [...currentIds, id],
    );
  const anchorId = currentIds.includes(characterId)
    ? characterId
    : currentIds[0];
  const [tagFilter, setTagFilter] = useState("");
  useEffect(() => setTagFilter(""), [tab]);
  const areas = d.areas.filter((a) =>
    tab === "My Content"
      ? a.ownerId === d.account.id
      : a.ownerId !== d.account.id,
  );
  const availableTags = [...new Set(areas.flatMap((a) => a.tags ?? []))].sort();
  const create = async () => {
    const area = await api("/api/things", "POST", { name, preset });
    await refresh();
    edit(area.id);
  };
  return (
    <main className="library">
      <header className="library-heading">
        <h1>{tab}</h1>
        <p className="muted">
          {
            {
              "My Content":
                "Articles and places you own. Edit drafts, organize tags, and publish when ready.",
              "Shared with Me":
                "Places others have shared with you. Editing depends on your permissions.",
              Characters: "Your character templates, artwork, and inventories.",
              Sessions: "Host a game or join your party with a character.",
              Connections: "Invitations and approved links between places.",
            }[tab]
          }
        </p>
      </header>
      {(tab === "My Content" || tab === "Shared with Me") && (
        <>
          <div className="section-heading">
            <h2>
              Articles & places <span>{areas.length}</span>
            </h2>
            {tab === "My Content" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(create);
                }}
              >
                <input
                  aria-label="New Thing name"
                  placeholder="Name a new Thing…"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={120}
                />
                <select
                  aria-label="New Thing type"
                  value={preset}
                  onChange={(e) => setPreset(e.target.value)}
                >
                  {["place", "item", "container"].map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
                <button className="primary">+ Create Thing</button>
              </form>
            )}
          </div>
          <label className="tag-filter">
            Filter by tag
            <select
              aria-label="Filter by tag"
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
            >
              <option value="">All tags</option>
              {availableTags.map((tag) => (
                <option key={tag}>{tag}</option>
              ))}
            </select>
          </label>
          {!areas.length && <p>No articles here yet.</p>}
          <div className="area-grid">
            {areas
              .filter((a) => !tagFilter || (a.tags ?? []).includes(tagFilter))
              .map((a, i) => (
                <article className="area-card" key={a.id}>
                  <div className={`card-scene scene-${i % 3}`}>
                    <span>{i % 2 ? "⚑" : "⌂"}</span>
                    <small>
                      {a.latestPublicationId ? "PUBLISHED" : "DRAFT"}
                    </small>
                  </div>
                  <div className="card-body">
                    <p className="eyebrow">
                      {a.ownerId === d.account.id
                        ? "YOUR AREA"
                        : "SHARED WITH YOU"}
                    </p>
                    <h3>{a.name}</h3>
                    {a.latestPublicationId && (
                      <a
                        href={`/articles/${a.id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Read article ↗
                      </a>
                    )}
                    <div className="tag-list">
                      {(a.tags ?? []).map((tag) => (
                        <span className="badge" key={tag}>
                          {tag}
                        </span>
                      ))}
                    </div>
                    {(a.ownerId === d.account.id ||
                      a.collaborators.includes(d.account.id)) && (
                      <AreaTags area={a} run={run} refresh={refresh} />
                    )}
                    <p>
                      Revision {a.sceneRevision} ·{" "}
                      {d.accounts.find((x) => x.id === a.ownerId)?.name ??
                        "Author"}
                    </p>
                    <div className="actions">
                      {a.ownerId === d.account.id ||
                      a.collaborators.includes(d.account.id) ? (
                        <button onClick={() => edit(a.id)}>
                          Open editor ↗
                        </button>
                      ) : (
                        <button onClick={() => edit(a.id)}>
                          Inspect Thing ↗
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              ))}
          </div>
        </>
      )}
      <section className="library-panels">
        <div
          className="panel"
          hidden={tab !== "Characters" && tab !== "Sessions"}
        >
          <p className="eyebrow">GATHER YOUR PARTY</p>
          <h2>Your characters</h2>
          {tab === "Characters" && swap && (
            <div className="swap-character-prompt">
              <p>
                Choose a character to use in your current session. Your other
                characters stay where they are.
              </p>
              <button onClick={swap.cancel}>Cancel swap</button>
            </div>
          )}
          <CharacterCards
            characters={d.characters}
            selected={tab === "Sessions" ? anchorId : swap?.characterId}
            currentIds={currentIds}
            onToggleCurrent={toggleCurrent}
            onSelect={
              tab === "Sessions"
                ? (id) => {
                    setCharacterId(id);
                    if (!currentIds.includes(id))
                      saveCurrent([...currentIds, id]);
                  }
                : swap
                  ? (id) =>
                      void run(async () => {
                        await swap.choose(id);
                        if (!currentIds.includes(id))
                          saveCurrent([...currentIds, id]);
                      })
                  : undefined
            }
            onEdit={edit}
            onCreate={
              tab === "Characters"
                ? () =>
                    void run(async () => {
                      const c = await api("/api/things", "POST", {
                        preset: "character",
                        name: "New character",
                      });
                      await refresh();
                      edit(c.id);
                    })
                : undefined
            }
          />
          <p className="muted">
            Check any number of current characters to bring them into a session.
            Your choices are remembered in this browser.
          </p>
          <div hidden={tab !== "Sessions"}>
            <p>
              {currentIds.length} current character
              {currentIds.length === 1 ? "" : "s"} selected
              {anchorId
                ? ` · View as ${d.characters.find((c) => c.id === anchorId)?.name}`
                : ""}
            </p>
            <h2>Live sessions</h2>
            {d.sessions.map((s) => (
              <div className="session" key={s.id}>
                <div>
                  <strong>{s.name}</strong>
                  <small>
                    {s.memberIds.length} invited players ·{" "}
                    {Object.keys(s.pins).length} pinned areas
                  </small>
                </div>
                <button
                  className="primary"
                  disabled={!anchorId}
                  onClick={() =>
                    void run(() => join(s.id, anchorId, currentIds))
                  }
                >
                  Enter →
                </button>
                {s.hostId === d.account.id && (
                  <details>
                    <summary>Manage players</summary>
                    <AccountSelect
                      data={d}
                      value={recipient}
                      set={setRecipient}
                    />
                    <button
                      onClick={() =>
                        void run(async () => {
                          await api(`/api/sessions/${s.id}/invite`, "POST", {
                            recipientId: recipient,
                          });
                          await refresh();
                        })
                      }
                    >
                      Invite player
                    </button>
                    {s.memberIds
                      .filter((x) => x !== d.account.id)
                      .map((x) => (
                        <button
                          key={x}
                          onClick={() =>
                            void run(async () => {
                              await api(
                                `/api/sessions/${s.id}/remove`,
                                "POST",
                                {
                                  recipientId: x,
                                },
                              );
                              await refresh();
                            })
                          }
                        >
                          Remove {d.accounts.find((a) => a.id === x)?.name}
                        </button>
                      ))}
                  </details>
                )}
              </div>
            ))}
            <details>
              <summary>Host a new session</summary>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await api("/api/sessions", "POST", {
                      name: sessionName,
                      areaIds: chosen,
                    });
                    await refresh();
                    setSessionName("");
                  });
                }}
              >
                <input
                  aria-label="Session name"
                  value={sessionName}
                  onChange={(e) => setSessionName(e.target.value)}
                  placeholder="Session name"
                  required
                />
                {d.areas
                  .filter((a) => a.latestPublicationId)
                  .map((a) => (
                    <label className="check" key={a.id}>
                      <input
                        type="checkbox"
                        checked={chosen.includes(a.id)}
                        onChange={(e) =>
                          setChosen(
                            e.target.checked
                              ? [...chosen, a.id]
                              : chosen.filter((x) => x !== a.id),
                          )
                        }
                      />
                      {a.name}
                    </label>
                  ))}
                <button disabled={!chosen.length}>
                  Create private session
                </button>
                <p>
                  Approved links include connected published areas you have
                  permission to play.
                </p>
              </form>
            </details>
          </div>
        </div>
        <div className="panel" hidden={tab !== "Connections"}>
          <p className="eyebrow">WHAT’S BEHIND THAT DOOR?</p>
          <h2>Connections</h2>
          <p className="muted">
            Invite an author from a door in your scene editor. A proposal grants
            connection rights, never area editing rights.
          </p>
          {d.invitations.length === 0 && (
            <p>No invitations yet. Start with a door.</p>
          )}
          {d.invitations.map((inv) => (
            <div className="invitation" key={inv.id}>
              <strong>
                {inv.sourceName ?? inv.sourceAreaId} · {inv.doorId}
              </strong>
              <span className="badge">{inv.status}</span>
              <small>
                {d.accounts.find((a) => a.id === inv.inviterId)?.name} →{" "}
                {d.accounts.find((a) => a.id === inv.recipientId)?.name}
              </small>
              {inv.kind === "link" &&
                inv.inviterId === d.account.id &&
                inv.status === "pending" &&
                !inv.recipientId && (
                  <label>
                    Invitation link
                    <input
                      readOnly
                      value={`${location.origin}/contribute/${inv.id}`}
                    />
                  </label>
                )}
              {inv.status === "requested" && inv.inviterId === d.account.id && (
                <button
                  onClick={() =>
                    void run(async () => {
                      await api(`/api/invitations/${inv.id}/resolve`, "POST", {
                        approve: true,
                      });
                      await refresh();
                    })
                  }
                >
                  Approve creation request
                </button>
              )}
              {["requested", "pending", "proposed"].includes(inv.status) &&
                inv.inviterId === d.account.id && (
                  <button
                    onClick={() =>
                      void run(async () => {
                        await api(
                          `/api/invitations/${inv.id}/resolve`,
                          "POST",
                          { approve: false },
                        );
                        await refresh();
                      })
                    }
                  >
                    Decline / revoke invitation
                  </button>
                )}
              {inv.recipientId === d.account.id && inv.status === "pending" && (
                <FrontierActions
                  areaId={inv.sourceAreaId}
                  doorId={inv.doorId}
                  owner={false}
                  invitationId={inv.id}
                />
              )}
              {inv.targetAreaId && (
                <p className="muted">
                  Proposed destination: {inv.targetName ?? inv.targetAreaId} ·
                  arrival {inv.anchorId}
                </p>
              )}
              {inv.recipientId === d.account.id &&
                ["pending", "proposed"].includes(inv.status) && (
                  <>
                    <select
                      aria-label={`Target area for ${inv.doorId}`}
                      value={targets[inv.id]?.areaId ?? ""}
                      onChange={(e) => {
                        const areaId = e.target.value;
                        void run(async () => {
                          const draft = await api(`/api/areas/${areaId}/draft`);
                          setTargets({
                            ...targets,
                            [inv.id]: {
                              areaId,
                              anchorId: draft.scene.anchors[0].id,
                            },
                          });
                        });
                      }}
                    >
                      <option value="">Choose your destination area</option>
                      {d.areas
                        .filter((a) => a.ownerId === d.account.id)
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                    </select>
                    <input
                      aria-label="Arrival anchor ID"
                      placeholder="Arrival anchor ID"
                      value={targets[inv.id]?.anchorId ?? ""}
                      onChange={(e) =>
                        setTargets({
                          ...targets,
                          [inv.id]: {
                            ...targets[inv.id],
                            anchorId: e.target.value,
                          },
                        })
                      }
                    />
                    <button
                      disabled={!targets[inv.id]?.areaId}
                      onClick={() =>
                        void run(async () => {
                          await api(
                            `/api/invitations/${inv.id}/propose`,
                            "POST",
                            {
                              targetAreaId: targets[inv.id].areaId,
                              anchorId: targets[inv.id].anchorId,
                            },
                          );
                          await refresh();
                        }, "Proposal sent")
                      }
                    >
                      Propose connection
                    </button>
                    <small>
                      Acceptance also lets the inviter host this area in private
                      sessions. Editing remains yours.
                    </small>
                  </>
                )}
              {inv.inviterId === d.account.id && inv.status === "proposed" && (
                <button
                  onClick={() =>
                    void run(async () => {
                      await api(`/api/invitations/${inv.id}/accept`, "POST");
                      await refresh();
                    }, "Connection accepted. Publish both endpoint scenes, then include both areas in a session.")
                  }
                >
                  Accept proposal
                </button>
              )}
            </div>
          ))}
          {d.connections.map((c) => (
            <div className="invitation" key={c.id}>
              <strong>
                {c.doorId} → {c.anchorId}
              </strong>
              <span className="badge">
                {c.enabled ? "Connected" : "Disabled"}
              </span>
              {c.enabled && (
                <button
                  onClick={() =>
                    void run(async () => {
                      await api(`/api/connections/${c.id}/disable`, "POST");
                      await refresh();
                    })
                  }
                >
                  Disconnect
                </button>
              )}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
function AreaTags({
  area,
  run,
  refresh,
}: {
  area: Area;
  run: Run;
  refresh: () => Promise<any>;
}) {
  const [tags, setTags] = useState(area.tags ?? []);
  return (
    <details>
      <summary>Edit tags</summary>
      <TagInput value={tags} onChange={setTags} />
      <button
        onClick={() =>
          void run(async () => {
            await api(`/api/areas/${area.id}`, "PATCH", { tags });
            await refresh();
          }, "Tags saved")
        }
      >
        Save tags
      </button>
    </details>
  );
}
function AccountSelect({
  data,
  value,
  set,
}: {
  data: Library;
  value: string;
  set: (id: string) => void;
}) {
  return (
    <select
      aria-label="Recipient account"
      value={value}
      onChange={(e) => set(e.target.value)}
    >
      <option value="">Select an account</option>
      {data.accounts
        .filter((a) => a.id !== data.account.id)
        .map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
    </select>
  );
}
function SharingToggle({
  label,
  checked,
  commit,
  run,
}: {
  label: string;
  checked: boolean;
  commit: (value: boolean) => Promise<void>;
  run: Run;
}) {
  const [pending, setPending] = useState<boolean>();
  useEffect(() => setPending(undefined), [checked]);
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={pending ?? checked}
        disabled={pending !== undefined}
        onChange={(e) => {
          const value = e.target.checked;
          setPending(value);
          void run(async () => {
            try {
              await commit(value);
            } catch (error) {
              setPending(undefined);
              throw error;
            }
          });
        }}
      />
      {label}
    </label>
  );
}
function Play({
  sessionId,
  characterId,
  run,
  onLeave,
  returnRequest,
  onCharacterName,
}: {
  returnRequest: number;
  onCharacterName: (name: string) => void;
  sessionId: string;
  characterId: string;
  run: Run;
  onLeave: () => void;
}) {
  const [snapshot, setSnapshot] = useState<PlaySnapshot>(),
    [map, setMap] = useState(true),
    [selected, setSelected] = useState(characterId),
    [focus, setFocus] = useState(0),
    [text, setText] = useState(""),
    [channel, setChannel] = useState<"speech" | "ooc">("speech"),
    [status, setStatus] = useState("Connecting…");
  const viewed = useRef<ViewTarget>({ kind: "location" });
  const socket = useRef<Socket>(),
    current = useRef(snapshot),
    pending = useRef(false);
  current.current = snapshot;
  const drawing = useDrawing(socket, snapshot);
  const receive = (next: PlaySnapshot) => {
    if (JSON.stringify(viewed.current) !== JSON.stringify(next.view.target)) {
      setSelected(next.view.target.kind === "location" ? characterId : "");
      setFocus((n) => n + 1);
    }
    viewed.current = next.view.target;
    current.current = next;
    setSnapshot(next);
  };
  useEffect(() => {
    const s = io({ transports: ["websocket", "polling"] });
    socket.current = s;
    s.on("connect", () => {
      setStatus("Syncing…");
      s.emit(
        "subscribe",
        { sessionId, characterId, viewTarget: viewed.current },
        (result: any) => {
          if (result.ok) {
            receive(result.snapshot);
            setStatus("Live");
          } else setStatus(result.error?.message ?? "Unable to join");
        },
      );
    });
    s.on("snapshot", receive);
    s.on("disconnect", () => setStatus("Reconnecting…"));
    s.on("connect_error", () =>
      setStatus(
        "Connection unavailable. Sign in again if your session expired.",
      ),
    );
    s.on("revoked", (e: any) => {
      setStatus(e.message);
      setSnapshot(undefined);
    });
    return () => {
      s.disconnect();
    };
  }, [sessionId, characterId]);
  const navigate = (viewTarget: ViewTarget) =>
    new Promise<void>((resolve, reject) => {
      if (!socket.current?.connected)
        return reject(new Error("Wait for the connection to recover"));
      socket.current
        .timeout(8000)
        .emit(
          "view",
          { sessionId, characterId, viewTarget },
          (timeout: any, result: any) => {
            if (timeout || result?.error)
              return reject(
                new Error(
                  result?.error?.message ?? "Unable to open this space",
                ),
              );
            receive(result.snapshot);
            setSelected(viewTarget.kind === "location" ? characterId : "");
            setFocus((n) => n + 1);
            resolve();
          },
        );
    });
  const command = async (
    payload: Command extends infer C
      ? C extends Command
        ? Omit<C, "operationId" | "sessionId" | "characterId">
        : never
      : never,
  ) =>
    new Promise<void>((resolve, reject) => {
      if (!socket.current?.connected)
        return reject(new Error("Wait for the connection to recover"));
      socket.current
        .timeout(8000)
        .emit(
          "command",
          { ...payload, sessionId, characterId, operationId: uid() },
          (timeout: any, result: any) => {
            if (timeout)
              reject(
                new Error(
                  "No acknowledgment. Reconnect to check the current state.",
                ),
              );
            else if (result.error) reject(new Error(result.error.message));
            else resolve();
          },
        );
    });
  const travel = async (connectionId: string) => {
    if (pending.current) return;
    pending.current = true;
    try {
      await command({
        type: "travel",
        connectionId,
        revision: current.current!.placement.revision,
      });
    } finally {
      pending.current = false;
    }
  };
  const move = async (position: Vec3) => {
    if (pending.current || !current.current) return;
    pending.current = true;
    try {
      const state = current.current;
      if (
        !selected ||
        !(
          state.view.target.kind === "location"
            ? state.controllableIds
            : state.view.controllableIds
        ).includes(selected)
      )
        throw new Error("Select a Thing you control before moving");
      await command({
        type: "interact",
        action: "move",
        viewTarget: state.view.target,
        targetId: selected,
        position,
        revision: state.session.liveRevision ?? 0,
      });
    } finally {
      pending.current = false;
    }
  };
  const send = async () => {
    if (!snapshot) return;
    if (text.startsWith("/inspect ")) {
      const name = text.slice(9).toLowerCase(),
        t = [
          ...snapshot.view.scene.things,
          ...snapshot.publication.scene.doors,
        ].find((x) => x.name.toLowerCase() === name || x.id === name);
      if (!t) throw new Error("No visible Thing with that name");
      setSelected(t.id);
    } else if (text.startsWith("/go ")) {
      const name = text.slice(4).toLowerCase(),
        exit = snapshot.exits.find(
          (e) => e.name.toLowerCase() === name || e.doorId === name,
        );
      if (!exit) throw new Error("No available exit with that name");
      await travel(exit.connectionId);
    } else await command({ type: "chat", channel, text });
    setText("");
  };
  const handledReturn = useRef(0);
  useEffect(() => {
    if (snapshot?.character.name) onCharacterName(snapshot.character.name);
  }, [snapshot?.character.name, onCharacterName]);
  useEffect(() => {
    if (snapshot && returnRequest && handledReturn.current !== returnRequest) {
      handledReturn.current = returnRequest;
      void run(() => navigate({ kind: "location" }));
    }
  }, [returnRequest, !!snapshot]);
  if (!snapshot)
    return (
      <div className="loading" role="status">
        {status}
        <button onClick={onLeave}>Back to worlds</button>
      </div>
    );
  const scene = snapshot.view.scene,
    isLocation = snapshot.view.target.kind === "location",
    inventories = snapshot.inventories,
    inventoryThings = Object.values(inventories).flatMap((ts) =>
      flattenThings(ts),
    ),
    selectedThing = scene.things.find((t) => t.id === selected),
    selectedCharacter = isLocation
      ? snapshot.occupants.find((o) => o.character.id === selected)?.character
      : undefined,
    selectedDoor = scene.doors.find((d) => d.id === selected),
    exit = snapshot.exits.find((e) => e.doorId === selected);
  const openSelected = () => {
    const target: ViewTarget = selectedCharacter
      ? {
          kind: "interior",
          root: "character",
          rootId: selectedCharacter.id,
          path: [],
        }
      : snapshot.view.target.kind === "location"
        ? {
            kind: "interior",
            root: "area",
            rootId: snapshot.placement.areaId,
            path: [selected],
          }
        : {
            ...snapshot.view.target,
            path: [...snapshot.view.target.path, selected],
          };
    return navigate(target);
  };
  const carried = flattenThings(snapshot.inventory).some(
    (t) => t.id === selected && t.portable,
  );
  const canPeer = selectedCharacter
    ? snapshot.peerableIds.includes(selected)
    : snapshot.view.peerableIds.includes(selected);
  const selectedOwned = selectedCharacter
    ? selectedCharacter.ownerId === snapshot.character.ownerId
    : snapshot.view.ownedIds.includes(selected);
  const selectedControlled = (
    isLocation ? snapshot.controllableIds : snapshot.view.controllableIds
  ).includes(selected);
  const action = (
    action: "take" | "drop" | "enter" | "exit" | "control" | "flags",
    recipientId?: string,
  ) =>
    command({
      type: "interact",
      action,
      targetId: selected,
      viewTarget: snapshot.view.target,
      recipientId,
      revision: snapshot.session.liveRevision ?? 0,
    });
  const imageUrl = (id: string) =>
    id.startsWith("sample_") ? `/assets/${id}.svg` : `/api/assets/${id}`;

  return (
    <main className="workspace play-workspace" data-connection-status={status}>
      <div className="workspace-bar play-navigation">
        <nav aria-label="Viewed space">
          {snapshot.view.breadcrumbs.map((crumb, i) => (
            <button
              key={i}
              aria-current={
                i === snapshot.view.breadcrumbs.length - 1
                  ? "location"
                  : undefined
              }
              onClick={() => void run(() => navigate(crumb.target))}
            >
              {crumb.name}
            </button>
          ))}
        </nav>
      </div>
      <div className="workspace-grid play-grid">
        <aside className="panel prose">
          <p className="eyebrow">THE WORLD AROUND YOU</p>
          {!!snapshot.placement.interiorTrail?.length && (
            <button
              onClick={() =>
                void run(() =>
                  command({
                    type: "interact",
                    action: "exit",
                    targetId: characterId,
                    revision: snapshot.session.liveRevision ?? 0,
                  }),
                )
              }
            >
              ← Leave interior
            </button>
          )}

          {isLocation ? (
            <ReactMarkdown skipHtml>
              {snapshot.publication.article}
            </ReactMarkdown>
          ) : (
            <p>
              {snapshot.view.name} · select a token to inspect or arrange its
              contents.
            </p>
          )}
          {isLocation && (
            <section className="exit-catalog">
              <h3>Exits</h3>
              <a
                href={`/articles/${snapshot.publication.areaId}?sessionId=${sessionId}`}
                target="_blank"
                rel="noreferrer"
              >
                Browse this article ↗
              </a>
              {scene.doors.map((door) => {
                const linked = snapshot.exits.find((e) => e.doorId === door.id);
                return (
                  <div key={door.id}>
                    <strong>{door.name}</strong>
                    {linked ? (
                      <>
                        <a
                          href={`/articles/${linked.targetAreaId}?sessionId=${sessionId}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {linked.destinationName} ↗
                        </a>
                        <button
                          onClick={() =>
                            void run(() => travel(linked.connectionId))
                          }
                        >
                          Travel via {door.name} →
                        </button>
                      </>
                    ) : (
                      <small>Unexplored or unavailable</small>
                    )}
                  </div>
                );
              })}
            </section>
          )}
          {isLocation && (
            <>
              <h3>Here now</h3>
              {snapshot.occupants.map((o) => (
                <button
                  key={o.character.id}
                  onClick={() => setSelected(o.character.id)}
                >
                  ◉ {o.character.name}
                  {o.character.id === characterId ? " · you" : ""}
                </button>
              ))}
            </>
          )}
          <h3>Things & exits</h3>
          {[
            ...scene.things.filter(
              (t) =>
                (!isLocation || t.role === "spatial") &&
                t.visual?.mode !== "map",
            ),
            ...scene.doors,
          ].map((t) => (
            <button key={t.id} onClick={() => setSelected(t.id)}>
              {t.name}
              {"value" in t && t.value !== undefined ? `: ${t.value}` : ""}
            </button>
          ))}
          {(selectedThing || selectedDoor || selectedCharacter) && (
            <section className="selection">
              <h3>
                {(selectedThing ?? selectedDoor ?? selectedCharacter)!.name}
              </h3>
              <p>
                {selectedThing?.description ?? selectedCharacter?.description}
              </p>
              {selectedThing?.value !== undefined && (
                <p>{String(selectedThing.value)}</p>
              )}
              {(selectedThing?.imageAssetId ??
                selectedCharacter?.imageAssetId) && (
                <img
                  className="thing-art"
                  alt="Full artwork"
                  src={imageUrl(
                    (selectedThing?.imageAssetId ??
                      selectedCharacter?.imageAssetId)!,
                  )}
                />
              )}
              <div className="actions">
                {canPeer && (
                  <button onClick={() => void run(openSelected)}>
                    {selected === characterId
                      ? "Enter yourself"
                      : "Peer inside"}
                  </button>
                )}
                {isLocation &&
                  selectedThing?.portable &&
                  !selectedThing.interiorAreaId &&
                  selectedThing.visual?.mode !== "map" &&
                  !inventoryThings.some((t) => t.id === selected) && (
                    <button onClick={() => void run(() => action("take"))}>
                      Take
                    </button>
                  )}
                {carried && (
                  <button onClick={() => void run(() => action("drop"))}>
                    Drop in {snapshot.publication.name}
                  </button>
                )}
                {selectedThing?.interiorAreaId && (
                  <button onClick={() => void run(() => action("enter"))}>
                    Travel inside →
                  </button>
                )}
              </div>
              {(selectedCharacter || selectedThing) && !canPeer && (
                <small>Contents are private.</small>
              )}
              {selectedOwned && (
                <fieldset>
                  <legend>Sharing in this session</legend>
                  {(["visible", "peerable"] as const).map((flag) => (
                    <SharingToggle
                      key={
                        JSON.stringify(snapshot.view.target) + selected + flag
                      }
                      label={
                        flag === "visible"
                          ? "Visible to others"
                          : "Allow peering"
                      }
                      checked={
                        (selectedThing ?? selectedCharacter)?.[flag] ?? true
                      }
                      run={run}
                      commit={(value) =>
                        command({
                          type: "interact",
                          action: "flags",
                          targetId: selected,
                          viewTarget: snapshot.view.target,
                          revision: current.current!.session.liveRevision ?? 0,
                          [flag]: value,
                        })
                      }
                    />
                  ))}
                </fieldset>
              )}
              {selectedControlled && (
                <small>
                  You control this Thing. Right-click the ground to move it.
                </small>
              )}
              {selectedOwned && (selectedCharacter || isLocation) && (
                <label>
                  Controller
                  <select
                    aria-label="Assign controller"
                    value=""
                    onChange={(e) => {
                      if (e.target.value)
                        void run(() => action("control", e.target.value));
                    }}
                  >
                    <option value="">Assign or revoke control…</option>
                    {snapshot.session.memberIds.map((id) => (
                      <option key={id} value={id}>
                        {id === snapshot.character.ownerId
                          ? "Only me (revoke delegates)"
                          : id}
                      </option>
                    ))}
                  </select>
                  <small>
                    Control permits live movement, not template editing.
                  </small>
                </label>
              )}

              {selectedDoor &&
                (exit ? (
                  <button
                    className="primary"
                    onClick={() => void run(() => travel(exit.connectionId))}
                  >
                    Travel through →
                  </button>
                ) : (
                  <small>This door is not connected in this session.</small>
                ))}
            </section>
          )}
        </aside>
        <section className="viewport">
          {drawing.toolbar}
          <div className="view-toggle">
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
          </div>
          <Suspense fallback={<div className="loading">Opening scene…</div>}>
            <Scene
              drawingInteraction={drawing.interaction}
              scene={{ ...scene, drawing: snapshot.view.drawing?.drawing }}
              snapshot={isLocation ? snapshot : undefined}
              interior={!isLocation}
              backgroundAssetId={snapshot.view.backgroundAssetId}
              focus={focus}
              focusPosition={
                isLocation ? snapshot.placement.position : [0, 0, 0]
              }
              map={map}
              selected={selected}
              onSelect={setSelected}
              onMove={(p) => void run(() => move(p))}
            />
          </Suspense>
          <div className="scene-hint">
            Left-click to select · Right-click ground to move selected ·
            Middle-drag to orbit
          </div>
        </section>
        <aside className="panel chat">
          <div>
            <p className="eyebrow">AROUND THE TABLE</p>
            <h2>Conversation</h2>
          </div>
          <div className="messages" aria-live="polite">
            {snapshot.messages.length === 0 && (
              <p className="muted">The room is quiet. Start a story.</p>
            )}
            {snapshot.messages.map((m) => (
              <article key={m.id}>
                <small>
                  {m.displayName}{" "}
                  <span>{m.channel === "ooc" ? "OOC" : "SAYS"}</span>
                </small>
                <p>{m.text}</p>
              </article>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(send);
            }}
          >
            <select
              aria-label="Chat channel"
              value={channel}
              onChange={(e) => setChannel(e.target.value as any)}
            >
              <option value="speech">Speak in this area</option>
              <option value="ooc">Out of character · session</option>
            </select>
            <textarea
              aria-label="Chat message"
              placeholder="Say something… or /inspect Flask"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={2000}
            />
            <button className="primary" disabled={!text.trim()}>
              Send as{" "}
              {channel === "speech" ? snapshot.character.name : "yourself"} ↗
            </button>
          </form>
        </aside>
      </div>
    </main>
  );
}
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error?: string }
> {
  state: { error?: string } = {};
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    return this.state.error ? (
      <main className="loading">
        <h1>Unable to display this view</h1>
        <p>{this.state.error}</p>
        <button onClick={() => location.reload()}>Reload</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

function ArticleReader({ areaId }: { areaId: string }) {
  const [article, setArticle] = useState<{
    isOwner: boolean;
    name: string;
    article: string;
    publicationId: string;
    exits: {
      doorId: string;
      name: string;
      status: string;
      targetAreaId?: string;
      destinationName?: string;
    }[];
  }>();
  const [error, setError] = useState("");
  const sessionId = new URLSearchParams(location.search).get("sessionId");
  useEffect(() => {
    void api(
      `/api/areas/${areaId}/article${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""}`,
    )
      .then(setArticle)
      .catch((e) => setError(e.message));
  }, [areaId, sessionId]);
  return (
    <main className="library article-reader">
      <a href="/">← WikiTop</a>
      <p className="eyebrow">PUBLISHED ARTICLE · BROWSING ONLY</p>
      {error ? (
        <p role="alert">{error}</p>
      ) : !article ? (
        <p>Loading article…</p>
      ) : (
        <>
          <h1>{article.name}</h1>
          <ReactMarkdown skipHtml>{article.article}</ReactMarkdown>
          <section className="exit-catalog">
            <h2>Exits</h2>
            {!article.exits.length && <p>No exits cataloged.</p>}
            <ul>
              {article.exits.map((exit) => (
                <li key={exit.doorId} id={`exit-${exit.doorId}`}>
                  {exit.name} →{" "}
                  {exit.targetAreaId ? (
                    <a
                      href={`/articles/${exit.targetAreaId}${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""}`}
                    >
                      {exit.destinationName}
                    </a>
                  ) : (
                    <span>
                      {exit.status === "unexplored"
                        ? "Unexplored"
                        : "Unavailable"}
                    </span>
                  )}
                  {exit.status === "unexplored" && (
                    <FrontierActions
                      areaId={areaId}
                      doorId={exit.doorId}
                      owner={article.isOwner}
                      sessionId={sessionId ?? undefined}
                    />
                  )}
                </li>
              ))}
            </ul>
            <p className="muted">
              Browsing links never moves your character. Use Travel in live
              play.
            </p>
          </section>
        </>
      )}
    </main>
  );
}

function ContributionReader({ invitationId }: { invitationId: string }) {
  const [inv, setInv] = useState<{
    id: string;
    sourceAreaId: string;
    doorName: string;
  }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="library article-reader">
      <a href="/">← WikiTop</a>
      <h1>Build beyond an exit</h1>
      <p>
        Claim this invitation to create your own destination article and nested
        Things. The source stays under its owner’s control. Your proposed
        connection still needs their acceptance.
      </p>
      {!inv ? (
        <button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void api(`/api/invitations/${invitationId}/claim`, "POST")
              .then(setInv)
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          Claim invitation
        </button>
      ) : (
        <>
          <h2>{inv.doorName}</h2>
          <ClaimedFrontier
            invitationId={invitationId}
            sourceAreaId={inv.sourceAreaId}
          />
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
function ClaimedFrontier({
  invitationId,
  sourceAreaId,
}: {
  invitationId: string;
  sourceAreaId: string;
}) {
  const [doorId, setDoorId] = useState("");
  useEffect(() => {
    void api<Library>("/api/library").then((lib) =>
      setDoorId(
        lib.invitations.find((i) => i.id === invitationId)?.doorId ?? "",
      ),
    );
  }, [invitationId]);
  return doorId ? (
    <FrontierActions
      areaId={sourceAreaId}
      doorId={doorId}
      owner={false}
      invitationId={invitationId}
    />
  ) : (
    <p>Loading invitation…</p>
  );
}
