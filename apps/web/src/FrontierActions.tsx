import { useState, useEffect } from "react";
import { api } from "./api";
export default function FrontierActions({
  areaId,
  doorId,
  owner,
  ownerId,
  invitationId,
  sessionId,
  disabled = false,
}: {
  areaId: string;
  doorId: string;
  owner: boolean;
  ownerId?: string;
  invitationId?: string;
  sessionId?: string;
  disabled?: boolean;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [created, setCreated] = useState<{
    area: { id: string };
    approvalRequired: boolean;
  }>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState(!ownerId);
  useEffect(() => {
    if (ownerId)
      void api("/api/me")
        .then((me) => setMine(me.account.id === ownerId))
        .catch(() => setMine(false));
  }, [ownerId]);
  const perform = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (ownerId && !mine) return null;
  return (
    <fieldset className="frontier-actions" disabled={disabled || busy}>
      <legend>Beyond this exit</legend>
      {created ? (
        <>
          <p>
            {created.approvalRequired
              ? "Draft created; awaiting the source owner’s connection acceptance. Save your destination edits, then propose its latest arrival anchor in Connections."
              : "Draft destination created and connected. Publish both areas to enable travel."}
          </p>
          <a
            href={`/?editArea=${created.area.id}`}
            target="_blank"
            rel="noreferrer"
          >
            Edit destination article / Thing ↗
          </a>
        </>
      ) : (
        <>
          {owner || invitationId ? (
            <>
              <label>
                Destination name
                <input
                  value={name}
                  maxLength={120}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="What lies beyond?"
                />
              </label>
              <button
                type="button"
                disabled={!name.trim()}
                onClick={() =>
                  void perform(async () => {
                    setCreated(
                      await api(
                        `/api/areas/${areaId}/exits/${doorId}/create`,
                        "POST",
                        { name, invitationId },
                      ),
                    );
                  })
                }
              >
                Create destination article / Thing
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() =>
                void perform(async () => {
                  const inv = await api(
                    `/api/areas/${areaId}/exits/${doorId}/request`,
                    "POST",
                    { sessionId },
                  );
                  setMessage(
                    inv.status === "pending"
                      ? "Permission granted. Create the destination from Connections."
                      : "Request sent. The owner must approve before you can create this destination.",
                  );
                })
              }
            >
              Request permission to create
            </button>
          )}
          {owner && (
            <button
              type="button"
              onClick={() =>
                void perform(async () => {
                  const link = await api(
                    `/api/areas/${areaId}/exits/${doorId}/invite-link`,
                    "POST",
                  );
                  setUrl(link.url);
                })
              }
            >
              Generate invitation link
            </button>
          )}
        </>
      )}
      {url && (
        <label>
          Invitation link
          <input
            aria-label="Invitation link"
            readOnly
            value={url}
            onFocus={(e) => e.target.select()}
          />
          <small>
            Single use · existing signed-in accounts only. Revoke in
            Connections.
          </small>
        </label>
      )}
      {message && <p role="status">{message}</p>}
      <small>
        Creates an owned draft space with an article, scene, and arrival point.
        Add nested Things in its editor. Grants never permit editing this
        source.
      </small>
    </fieldset>
  );
}
