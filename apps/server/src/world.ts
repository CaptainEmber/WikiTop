import { drawingView, drawingContext, drawCommand } from "./drawing.js";
import { exportDocument, legacyIds, documentChildren } from "./documents.js";
import { createHash, randomUUID } from "node:crypto";
import {
  AreaSceneSchema,
  ThingDocumentSchema,
  type ThingDocument,
  type ThingDraft,
  type MediaReference,
  TagsSchema,
  emptyScene,
  flattenThings,
  zoneAt,
  type WorldState,
  type Area,
  type AreaScene,
  type PlaySnapshot,
  type Command,
  type Connection,
  type Account,
  type Thing,
  type Space,
  type ViewTarget,
  type Vec3,
} from "@wikitop/shared";
import type { Store } from "./store.js";
import type { Wiki } from "./wiki.js";
import {
  controls,
  sceneThings,
  inventory,
  interact,
  publicSession,
} from "./live-things.js";
import {
  prepareViews,
  copyCharacterInventory,
  projectThings,
  characterVisible,
  characterPeerable,
  viewSnapshot,
} from "./views.js";
import { requireThat, DomainError } from "./errors.js";
export const id = () => randomUUID();
export const hash = (v: unknown) =>
  createHash("sha256")
    .update(typeof v === "string" ? v : (JSON.stringify(v) ?? "null"))
    .digest("hex");
const now = () => new Date().toISOString();
export function member(s: WorldState, actor: string, sessionId: string) {
  const session = s.sessions[sessionId];
  requireThat(
    session && session.memberIds.includes(actor),
    "forbidden",
    "Session is unavailable",
    403,
  );
  return session;
}
export function editable(s: WorldState, actor: string, areaId: string) {
  const area = s.areas[areaId];
  requireThat(
    area && (area.ownerId === actor || area.collaborators.includes(actor)),
    "forbidden",
    "You cannot edit this area",
    403,
  );
  return area;
}
function owned(s: WorldState, actor: string, areaId: string) {
  const area = s.areas[areaId];
  requireThat(
    area && area.ownerId === actor,
    "forbidden",
    "Only the area owner can do that",
    403,
  );
  return area;
}
function playable(s: WorldState, actor: string, area: Area) {
  return (
    area.ownerId === actor ||
    area.collaborators.includes(actor) ||
    area.sharedWith.includes(actor)
  );
}
function emit(s: WorldState, sessionId: string, type: string) {
  const eventId = id();
  s.outbox[eventId] = { id: eventId, sessionId, type, createdAt: now() };
}
function validateAssets(
  s: WorldState,
  scene: AreaScene,
  allowedOwners?: string[],
) {
  for (const t of flattenThings(scene.things)) {
    if (t.space?.backgroundAssetId)
      requireThat(
        s.assets[t.space.backgroundAssetId] ||
          ["sample_map", "sample_token", "sample_card"].includes(
            t.space.backgroundAssetId,
          ),
        "invalid_asset",
        "Background is unavailable",
      );
    if (
      t.space?.backgroundAssetId &&
      allowedOwners &&
      s.assets[t.space.backgroundAssetId]
    )
      requireThat(
        allowedOwners.includes(s.assets[t.space.backgroundAssetId].ownerId),
        "invalid_asset",
        "Choose your own background",
      );
    if (t.imageAssetId)
      requireThat(
        s.assets[t.imageAssetId] ||
          ["sample_map", "sample_token", "sample_card"].includes(
            t.imageAssetId,
          ),
        "invalid_asset",
        "Full art asset is unavailable",
      );
    if (t.imageAssetId && allowedOwners && s.assets[t.imageAssetId])
      requireThat(
        allowedOwners.includes(s.assets[t.imageAssetId].ownerId),
        "invalid_asset",
        "Use your own full art",
      );
    const assetId = t.visual?.assetId;
    if (t.visual?.mode === "model")
      requireThat(
        assetId === "sample_model" ||
          !!(assetId && s.assets[assetId]?.kind === "model"),
        "invalid_asset",
        "Choose a supported GLB model",
      );
    else if (assetId)
      requireThat(
        s.assets[assetId] ||
          ["sample_map", "sample_token", "sample_card"].includes(assetId),
        "invalid_asset",
        "An image asset is missing",
      );
    if (assetId && s.assets[assetId] && allowedOwners)
      requireThat(
        allowedOwners.includes(s.assets[assetId].ownerId),
        "forbidden_asset",
        "Use an image uploaded by you or this area’s owner",
        403,
      );
  }
}
export class World {
  constructor(
    public store: Store,
    public wiki: Wiki,
  ) {}
  private async scene(area: Area) {
    const page = await this.wiki.read(area.scenePageId);
    let data: unknown;
    try {
      data = JSON.parse(
        page.content.replace(/^```json\s*/, "").replace(/\s*```$/, ""),
      );
    } catch {
      throw new DomainError(
        "invalid_scene",
        "Scene wiki page is not valid JSON",
      );
    }
    requireThat(
      (data as { schemaVersion?: number })?.schemaVersion === 2,
      "coordinate_migration_required",
      "This area uses legacy Y-up coordinates. Run pnpm migrate:coordinates before editing or publishing.",
      409,
    );
    const scene = AreaSceneSchema.parse(data);
    requireThat(
      scene.revision === area.sceneRevision && hash(scene) === area.sceneHash,
      "draft_conflict",
      "Scene definition changed outside the editor; restore it before saving",
      409,
    );
    return scene;
  }
  private async documentRecord(
    s: WorldState,
    actor: string,
    rootId: string,
  ): Promise<ThingDraft> {
    const area = s.areas[rootId],
      character = s.characters[rootId];
    requireThat(area || character, "not_found", "Thing unavailable", 404);
    if (character) {
      requireThat(
        character.ownerId === actor,
        "forbidden",
        "Character draft unavailable",
        403,
      );
      const document = exportDocument(
        s,
        character,
        character.description ?? "",
        character.children ?? [],
      );
      return {
        document,
        revision: hash(document),
        canEdit: true,
        canPublish: false,
        ownerId: actor,
        sourceKind: "character",
      };
    }
    const canEdit =
      area.ownerId === actor || area.collaborators.includes(actor);
    requireThat(
      canEdit || playable(s, actor, area),
      "forbidden",
      "Thing unavailable",
      403,
    );
    let scene: AreaScene, prose: string, articleUrl: string | undefined;
    if (canEdit) {
      scene = await this.scene(area);
      const page = await this.wiki.read(area.articleId);
      prose = page.content;
      articleUrl = this.wiki.url(area.articleId, page.path);
    } else {
      const publication = s.publications[area.latestPublicationId!];
      requireThat(
        publication,
        "not_found",
        "No published Thing available",
        404,
      );
      const filter = (ts: Thing[]): Thing[] =>
        ts
          .filter((t) => t.visible ?? true)
          .map((t) => {
            const peerable =
              t.peerable ?? t.contentsVisibility !== "controllers";
            return {
              ...t,
              children: peerable ? filter(t.children) : [],
              space: peerable ? t.space : undefined,
              layout: peerable ? t.layout : undefined,
            };
          });
      scene = {
        ...publication.scene,
        things: filter(publication.scene.things),
      };
      prose = publication.article;
    }
    const document = exportDocument(
      s,
      {
        ...area,
        thingFields: canEdit
          ? area.thingFields
          : s.publications[area.latestPublicationId!].thingFields,
        name: canEdit
          ? area.name
          : s.publications[area.latestPublicationId!].name,
      },
      prose,
      scene.things,
      scene,
    );
    return {
      document,
      revision: hash(document),
      canEdit,
      canPublish: area.ownerId === actor,
      ownerId: area.ownerId,
      sourceKind: "area",
      articleUrl,
      unconnectedDoorIds: canEdit
        ? scene.doors
            .filter(
              (d) =>
                !Object.values(s.connections).some(
                  (c) =>
                    c.enabled && c.sourceAreaId === rootId && c.doorId === d.id,
                ),
            )
            .map((d) => d.id)
        : undefined,
    };
  }
  async thingDocument(actor: string, rootId: string) {
    return this.documentRecord(await this.store.read(), actor, rootId);
  }
  async saveThingDocument(
    actor: string,
    rootId: string,
    expectedRevision: string,
    operationId: string,
    input: unknown,
    guard?: (state: WorldState) => void,
  ): Promise<ThingDraft> {
    const document = ThingDocumentSchema.parse(input);
    requireThat(
      document.rootId === rootId,
      "invalid_document",
      "Root identity cannot change",
      400,
    );
    return this.store.transaction(async (s) => {
      const current = await this.documentRecord(s, actor, rootId);
      requireThat(
        current.canEdit,
        "forbidden",
        "Editing is not permitted",
        403,
      );
      const key = hash(`${actor}:${operationId}`),
        fingerprint = hash({ rootId, expectedRevision, document });
      if (s.operations[key]) {
        requireThat(
          s.operations[key].fingerprint === fingerprint,
          "operation_conflict",
          "Operation ID reused",
          409,
        );
        return s.operations[key].result as ThingDraft;
      }
      requireThat(
        current.revision === expectedRevision,
        "draft_conflict",
        "This Thing changed. Keep your local copy and reload the latest draft.",
        409,
      );
      guard?.(s);
      const root = document.nodes[rootId],
        area = s.areas[rootId],
        character = s.characters[rootId];
      requireThat(
        !!root.character === !!character &&
          !Object.values(document.nodes).some(
            (n) => n.id !== rootId && n.character,
          ),
        "unsupported_conversion",
        "Character capability changes are not supported by this storage adapter",
        400,
      );
      requireThat(
        !area || root.space,
        "invalid_document",
        "Place roots must keep their space component",
        400,
      );
      const oldChildren = area
        ? (await this.scene(area)).things
        : (character.children ?? []);
      const ids = legacyIds(rootId, oldChildren, s);
      // Imported permissions and legacy IDs are never accepted from document JSON.
      for (const nodeId of Object.keys(document.nodes))
        requireThat(
          nodeId === rootId ||
            ids.has(nodeId) ||
            /^thing_[a-f0-9-]{32,40}$/.test(nodeId),
          "invalid_identity",
          "New Things require a globally unique Thing ID",
          400,
        );
      for (const nodeId of Object.keys(document.nodes)) {
        const claimed = s.thingIds[nodeId];
        requireThat(
          !claimed || claimed.rootId === rootId,
          "identity_conflict",
          "A Thing identity already belongs to another document",
          409,
        );
        s.thingIds[nodeId] = {
          id: nodeId,
          rootId,
          legacyId: ids.get(nodeId) ?? nodeId,
        };
      }
      const resolve = (
        ref?: MediaReference,
        type?: "image" | "model",
      ): string | undefined => {
        if (!ref) return;
        if (ref.kind === "url") {
          requireThat(
            !type || type === ref.type,
            "invalid_asset",
            "Wrong media type",
            400,
          );
          const found = Object.values(s.assets).find(
            (a) =>
              a.ownerId === actor && a.url === ref.url && a.kind === ref.type,
          );
          if (found) return found.id;
          const assetId = id();
          s.assets[assetId] = {
            id: assetId,
            ownerId: actor,
            key: "",
            url: ref.url,
            kind: ref.type,
            mime: ref.type === "model" ? "model/gltf-binary" : "image/remote",
            width: 0,
            height: 0,
          };
          return assetId;
        }
        requireThat(
          ref.kind !== "embedded",
          "invalid_asset",
          "Upload portable embedded media before saving it to the server",
          400,
        );
        const asset = s.assets[ref.assetId],
          sample = ref.assetId.startsWith("sample_");
        requireThat(
          asset
            ? [actor, current.ownerId].includes(asset.ownerId)
            : [
                "sample_model",
                "sample_token",
                "sample_card",
                "sample_map",
              ].includes(ref.assetId),
          "forbidden_asset",
          "Use your own media or the root owner's media",
          403,
        );
        const kind =
          sample && ref.assetId === "sample_model"
            ? "model"
            : (asset?.kind ?? "image");
        requireThat(
          !type || kind === type,
          "invalid_asset",
          "Wrong media type",
          400,
        );
        return ref.assetId;
      };
      // Validate media slots even when they are not the current presentation.
      for (const node of Object.values(document.nodes)) {
        requireThat(
          !node.media.background || node.space,
          "invalid_document",
          "A background requires a space component",
          400,
        );
        resolve(node.media.token, "image");
        resolve(node.media.artwork, "image");
        resolve(node.media.background, "image");
        resolve(node.media.model, "model");
      }
      const children = documentChildren(document, rootId, ids, (ref) =>
        resolve(ref),
      );
      const rootPresentation =
        root.visual ??
        (root.media.token || root.media.model
          ? {
              mode: root.media.model ? ("model" as const) : ("token" as const),
              width: 1.5,
              height: 1.5,
              anchor: [0.5, 0.5] as [number, number],
              footprint: [1, 1] as [number, number],
            }
          : undefined);
      const rootVisual = rootPresentation
        ? {
            ...rootPresentation,
            assetId: resolve(
              rootPresentation.mode === "model"
                ? root.media.model
                : root.media.token,
            ),
            mapAssetId:
              rootPresentation.mode === "model"
                ? resolve(root.media.token)
                : undefined,
          }
        : undefined;
      const rootFields: Partial<Thing> = {
        role: root.role,
        contentsVisibility: root.contentsVisibility,
        interiorAreaId: root.interiorAreaId,
        visible: root.visible,
        peerable: root.peerable,
        portable: root.portable,
        value: root.value,
        visual: rootVisual,
        modelAssetId: resolve(root.media.model),
        imageAssetId: resolve(root.media.artwork),
        space: root.space
          ? {
              drawing: root.space.drawing,
              width: root.space.width,
              depth: root.space.depth,
              backgroundAssetId: resolve(root.media.background),
            }
          : undefined,
      };
      const rootLayout = root.space ?? {
        width: 20,
        depth: 16,
        zones: [],
        doors: [],
        anchors: [
          { id: "entrance", name: "Entrance", position: [0, 0, 0] as Vec3 },
        ],
      };
      for (const node of Object.values(document.nodes))
        if (node.space)
          AreaSceneSchema.parse({
            ...emptyScene(),
            ...node.space,
            things: documentChildren(document, node.id, ids, (ref) =>
              resolve(ref),
            ),
          });
      if (area) {
        const nextScene = AreaSceneSchema.parse({
          ...emptyScene(),
          ...rootLayout,
          revision: area.sceneRevision + 1,
          things: children,
        });
        validateAssets(s, nextScene, [actor, area.ownerId]);
        const oldArticle = await this.wiki.read(area.articleId);
        await this.wiki.writeArticle(area.articleId, root.description);
        try {
          await this.wiki.writeScene(area.scenePageId, nextScene);
        } catch (error) {
          try {
            await this.wiki.writeArticle(area.articleId, oldArticle.content);
          } catch {
            throw new DomainError(
              "wiki_partial_save",
              "Wiki save was interrupted. Reload and reconcile the wiki draft before retrying.",
              503,
            );
          }
          throw error;
        }
        Object.assign(area, {
          name: root.name,
          tags: root.tags,
          thingFields: rootFields,
          sceneRevision: nextScene.revision,
          sceneHash: hash(nextScene),
        });
      } else {
        AreaSceneSchema.parse({
          ...emptyScene(),
          ...rootLayout,
          things: children,
        });
        Object.assign(character, {
          thingFields: {
            role: root.role,
            portable: root.portable,
            value: root.value,
            contentsVisibility: root.contentsVisibility,
            interiorAreaId: root.interiorAreaId,
          },
          name: root.name,
          description: root.description,
          tags: root.tags,
          visible: root.visible,
          peerable: root.peerable,
          space: rootFields.space,
          assetId: resolve(root.media.token),
          imageAssetId: rootFields.imageAssetId,
          layout: root.space
            ? {
                zones: root.space.zones,
                doors: root.space.doors,
                anchors: root.space.anchors,
              }
            : undefined,
          visual: rootVisual,
          modelAssetId: rootFields.modelAssetId,
          children,
        });
        for (const session of Object.values(s.sessions))
          if (session.memberIds.includes(actor))
            emit(s, session.id, "character_profile");
      }
      const result = await this.documentRecord(s, actor, rootId);
      s.operations[key] = {
        id: key,
        actorId: actor,
        fingerprint,
        result,
        createdAt: now(),
      };
      return result;
    }, "authoring");
  }
  async canReadAsset(actor: string, assetId: string): Promise<boolean> {
    const state = await this.store.read();
    for (const area of Object.values(state.areas)) {
      if (!playable(state, actor, area)) continue;
      try {
        const draft = await this.documentRecord(state, actor, area.id);
        for (const node of Object.values(draft.document.nodes))
          if (
            Object.values(node.media).some(
              (ref) =>
                (ref?.kind === "asset" && ref.assetId === assetId) ||
                (ref?.kind === "url" && ref.url === state.assets[assetId]?.url),
            )
          )
            return true;
      } catch {
        /* A wiki outage does not prevent play's separate asset authorization. */
      }
    }
    return false;
  }
  async createThing(
    actor: string,
    preset: "character" | "place" | "item" | "container",
    name: string,
  ) {
    if (preset === "character")
      return this.createCharacter(actor, name, "sample_token");
    const area = await this.createArea(actor, name);
    await this.store.transaction((s) => {
      s.areas[area.id].authoringPreset = preset;
      s.areas[area.id].tags = [preset];
    }, "authoring");
    return area;
  }
  async draft(actor: string, areaId: string) {
    const state = await this.store.read();
    const area = editable(state, actor, areaId);
    const [scene, article] = await Promise.all([
      this.scene(area),
      this.wiki.read(area.articleId),
    ]);
    return {
      area,
      scene,
      articleUrl: this.wiki.url(area.articleId, article.path),
      unconnectedDoorIds: scene.doors
        .filter(
          (d) =>
            !Object.values(state.connections).some(
              (c) =>
                c.enabled && c.sourceAreaId === areaId && c.doorId === d.id,
            ),
        )
        .map((d) => d.id),
    };
  }
  async createArea(actor: string, name: string) {
    return this.store.transaction(
      (s) => this.registerArea(s, actor, name),
      "authoring",
    );
  }
  private async registerArea(s: WorldState, actor: string, name: string) {
    const account = s.accounts[actor];
    requireThat(account, "unauthenticated", "Sign in required", 401);
    const areaId = id();
    const scene = emptyScene();
    const pages = await this.wiki.createArea(areaId, name, account, scene);
    const area: Area = {
      id: areaId,
      name,
      ownerId: actor,
      collaborators: [],
      sharedWith: [],
      ...pages,
      sceneRevision: 0,
      sceneHash: hash(scene),
      createdAt: now(),
    };
    s.areas[area.id] = area;
    return area;
  }
  async setAreaTags(actor: string, areaId: string, tags: string[]) {
    const normalized = TagsSchema.parse(tags);
    return this.store.transaction((s) => {
      const area = editable(s, actor, areaId);
      area.tags = normalized;
      return area;
    }, "authoring");
  }
  async saveScene(
    actor: string,
    areaId: string,
    expected: number,
    input: unknown,
  ) {
    const parsed = AreaSceneSchema.parse(input);
    return this.store.transaction(async (s) => {
      const area = editable(s, actor, areaId);
      requireThat(
        area.sceneRevision === expected && parsed.revision === expected,
        "draft_conflict",
        "Reload the latest scene before saving",
        409,
      );
      await this.scene(area);
      validateAssets(s, parsed, [actor, area.ownerId]);
      const scene = { ...parsed, revision: expected + 1 };
      await this.wiki.writeScene(area.scenePageId, scene);
      area.sceneRevision = scene.revision;
      area.sceneHash = hash(scene);
      return {
        area,
        scene,
        unconnectedDoorIds: scene.doors
          .filter(
            (d) =>
              !Object.values(s.connections).some(
                (c) =>
                  c.enabled && c.sourceAreaId === areaId && c.doorId === d.id,
              ),
          )
          .map((d) => d.id),
      };
    }, "authoring");
  }
  async publish(actor: string, areaId: string) {
    return this.store.transaction(async (s) => {
      const area = owned(s, actor, areaId),
        scene = await this.scene(area);
      validateAssets(s, scene);
      const article = await this.wiki.read(area.articleId);
      const publicationId = id();
      const pub = {
        id: publicationId,
        areaId,
        name: area.name,
        thingFields: structuredClone(area.thingFields),
        tags: [...(area.tags ?? [])],
        article: article.content,
        scene: structuredClone(scene),
        articleHash: hash(article.content),
        sceneHash: hash(scene),
        articlePageId: area.articleId,
        scenePageId: area.scenePageId,
        publishedBy: actor,
        createdAt: now(),
      };
      s.publications[publicationId] = pub;
      area.latestPublicationId = publicationId;
      return pub;
    }, "authoring");
  }
  async share(actor: string, areaId: string, recipientId: string) {
    return this.store.transaction((s) => {
      const area = owned(s, actor, areaId);
      requireThat(
        s.accounts[recipientId],
        "not_found",
        "Account not found",
        404,
      );
      if (!area.sharedWith.includes(recipientId))
        area.sharedWith.push(recipientId);
      return area;
    }, "authoring");
  }
  async inviteConnection(
    actor: string,
    sourceAreaId: string,
    doorId: string,
    recipientId: string,
  ) {
    return this.store.transaction(async (s) => {
      const area = owned(s, actor, sourceAreaId);
      requireThat(
        s.accounts[recipientId] && recipientId !== actor,
        "invalid_recipient",
        "Choose another existing author",
      );
      const scene = await this.scene(area);
      const door = scene.doors.find((d) => d.id === doorId);
      requireThat(door, "not_found", "Door not found", 404);
      const invitation = {
        id: id(),
        sourceAreaId,
        doorId,
        inviterId: actor,
        recipientId,
        status: "pending" as const,
        sourceRevision: scene.revision,
        sourceEndpointHash: hash(door),
      };
      s.invitations[invitation.id] = invitation;
      return invitation;
    }, "authoring");
  }
  private async frontier(
    s: WorldState,
    sourceAreaId: string,
    doorId: string,
    expectedHash?: string,
  ) {
    const area = s.areas[sourceAreaId];
    requireThat(area, "not_found", "Source unavailable", 404);
    const scene = await this.scene(area);
    const door = scene.doors.find((d) => d.id === doorId);
    requireThat(door, "not_found", "Door not found", 404);
    requireThat(
      !expectedHash || hash(door) === expectedHash,
      "stale_invitation",
      "Door changed; request a new invitation",
      409,
    );
    requireThat(
      !Object.values(s.connections).some(
        (c) =>
          c.enabled && c.sourceAreaId === sourceAreaId && c.doorId === doorId,
      ),
      "conflict",
      "Door already connected",
      409,
    );
    return { area, scene, door };
  }
  async frontierInvite(
    actor: string,
    sourceAreaId: string,
    doorId: string,
    request = false,
    sessionId?: string,
  ) {
    // Readers must have access to the published broken link; link generation is owner-only.
    if (request) {
      const article = await this.article(actor, sourceAreaId, sessionId);
      requireThat(
        article.exits.some(
          (e) => e.doorId === doorId && e.status === "unexplored",
        ),
        "conflict",
        "This is not an unexplored exit",
        409,
      );
    }
    return this.store.transaction(async (s) => {
      if (!request) owned(s, actor, sourceAreaId);
      const { area, scene, door } = await this.frontier(
        s,
        sourceAreaId,
        doorId,
      );
      if (request) {
        requireThat(
          actor !== area.ownerId,
          "conflict",
          "Owners can create destinations directly",
          409,
        );
        const publication =
          s.publications[
            (sessionId
              ? s.sessions[sessionId]?.pins[sourceAreaId]
              : undefined) ?? area.latestPublicationId!
          ];
        requireThat(
          publication &&
            hash(publication.scene.doors.find((d) => d.id === doorId)) ===
              hash(door),
          "stale_invitation",
          "Draft door differs from the published exit",
          409,
        );
        const prior = Object.values(s.invitations).find(
          (i) =>
            i.sourceAreaId === sourceAreaId &&
            i.doorId === doorId &&
            i.recipientId === actor &&
            ["requested", "pending", "proposed"].includes(i.status),
        );
        if (prior) return prior;
      }
      const inv = {
        id: id(),
        sourceAreaId,
        doorId,
        inviterId: area.ownerId,
        recipientId: request ? actor : "",
        kind: request ? ("request" as const) : ("link" as const),
        status: request ? ("requested" as const) : ("pending" as const),
        sourceRevision: scene.revision,
        sourceEndpointHash: hash(door),
      };
      s.invitations[inv.id] = inv;
      return inv;
    }, "authoring");
  }
  async resolveFrontier(actor: string, invitationId: string, approve: boolean) {
    return this.store.transaction(async (s) => {
      const inv = s.invitations[invitationId];
      requireThat(inv, "not_found", "Invitation unavailable", 404);
      owned(s, actor, inv.sourceAreaId);
      requireThat(
        approve
          ? inv.status === "requested"
          : ["requested", "pending", "proposed"].includes(inv.status),
        "conflict",
        "Invitation already resolved",
        409,
      );
      if (approve) {
        const { scene } = await this.frontier(
          s,
          inv.sourceAreaId,
          inv.doorId,
          inv.sourceEndpointHash,
        );
        requireThat(
          scene.revision === inv.sourceRevision,
          "stale_invitation",
          "Source changed; request again",
          409,
        );
      }
      inv.status = approve ? "pending" : "declined";
      return inv;
    }, "authoring");
  }
  async claimFrontier(actor: string, invitationId: string) {
    return this.store.transaction(async (s) => {
      const inv = s.invitations[invitationId];
      requireThat(
        s.accounts[actor] &&
          inv?.kind === "link" &&
          inv.status === "pending" &&
          (!inv.recipientId || inv.recipientId === actor),
        "forbidden",
        "Invitation unavailable",
        403,
      );
      requireThat(
        actor !== inv.inviterId,
        "conflict",
        "Owners can create destinations directly",
        409,
      );
      const { scene } = await this.frontier(
        s,
        inv.sourceAreaId,
        inv.doorId,
        inv.sourceEndpointHash,
      );
      requireThat(
        scene.revision === inv.sourceRevision,
        "stale_invitation",
        "Source changed; ask for a new link",
        409,
      );
      inv.recipientId = actor;
      return {
        id: inv.id,
        doorName: scene.doors.find((d) => d.id === inv.doorId)!.name,
        sourceAreaId: inv.sourceAreaId,
      };
    }, "authoring");
  }
  async createBeyond(
    actor: string,
    sourceAreaId: string,
    doorId: string,
    name: string,
    invitationId?: string,
  ) {
    return this.store.transaction(async (s) => {
      const inv = invitationId ? s.invitations[invitationId] : undefined;
      if (invitationId) {
        requireThat(
          inv &&
            inv.sourceAreaId === sourceAreaId &&
            inv.doorId === doorId &&
            inv.recipientId === actor &&
            inv.status === "pending",
          "forbidden",
          "An approved invitation is required",
          403,
        );
        requireThat(
          !inv.createdAreaId,
          "conflict",
          "Destination already created",
          409,
        );
      } else owned(s, actor, sourceAreaId);
      const { area, scene, door } = await this.frontier(
        s,
        sourceAreaId,
        doorId,
        inv?.sourceEndpointHash,
      );
      if (inv)
        requireThat(
          scene.revision === inv.sourceRevision,
          "stale_invitation",
          "Source changed; request a new invitation",
          409,
        );
      const target = await this.registerArea(s, actor, name);
      const targetScene = await this.scene(target);
      const anchor = targetScene.anchors[0];
      if (inv) {
        Object.assign(inv, {
          createdAreaId: target.id,
          status: "proposed",
          targetAreaId: target.id,
          anchorId: anchor.id,
          targetRevision: targetScene.revision,
          targetEndpointHash: hash(anchor),
        });
      } else {
        const connection: Connection = {
          id: id(),
          sourceAreaId: area.id,
          doorId,
          targetAreaId: target.id,
          anchorId: anchor.id,
          sourceEndpointHash: hash(door),
          targetEndpointHash: hash(anchor),
          enabled: true,
        };
        s.connections[connection.id] = connection;
      }
      return { area: target, approvalRequired: !!inv };
    }, "authoring");
  }
  async propose(
    actor: string,
    invitationId: string,
    targetAreaId: string,
    anchorId: string,
  ) {
    return this.store.transaction(async (s) => {
      const inv = s.invitations[invitationId];
      requireThat(
        inv && inv.recipientId === actor,
        "forbidden",
        "Invitation unavailable",
        403,
      );
      requireThat(
        inv.status === "pending" || inv.status === "proposed",
        "conflict",
        "Invitation already resolved",
        409,
      );
      const source = s.areas[inv.sourceAreaId];
      const sourceScene = await this.scene(source);
      const door = sourceScene.doors.find((d) => d.id === inv.doorId);
      requireThat(
        door &&
          sourceScene.revision === inv.sourceRevision &&
          hash(door) === inv.sourceEndpointHash,
        "stale_invitation",
        "Source changed; request a new invitation",
        409,
      );
      const target = owned(s, actor, targetAreaId);
      const scene = await this.scene(target);
      const anchor = scene.anchors.find((a) => a.id === anchorId);
      requireThat(anchor, "not_found", "Arrival point not found", 404);
      Object.assign(inv, {
        status: "proposed",
        targetAreaId,
        anchorId,
        targetRevision: scene.revision,
        targetEndpointHash: hash(anchor),
      });
      return inv;
    }, "authoring");
  }
  async accept(actor: string, invitationId: string) {
    return this.store.transaction(async (s) => {
      const inv = s.invitations[invitationId];
      requireThat(inv, "not_found", "Invitation not found", 404);
      const source = owned(s, actor, inv.sourceAreaId);
      requireThat(
        inv.status === "proposed" && inv.targetAreaId && inv.anchorId,
        "conflict",
        "No pending proposal",
        409,
      );
      const target = s.areas[inv.targetAreaId];
      requireThat(
        target && target.ownerId === inv.recipientId,
        "stale_invitation",
        "Target ownership changed",
        409,
      );
      const a = await this.scene(source),
        b = await this.scene(target);
      requireThat(
        a.revision === inv.sourceRevision &&
          b.revision === inv.targetRevision &&
          hash(a.doors.find((d) => d.id === inv.doorId)) ===
            inv.sourceEndpointHash &&
          hash(b.anchors.find((x) => x.id === inv.anchorId)) ===
            inv.targetEndpointHash,
        "stale_invitation",
        "An area changed; create a new proposal",
        409,
      );
      requireThat(
        !Object.values(s.connections).some(
          (c) =>
            c.enabled &&
            c.sourceAreaId === source.id &&
            c.doorId === inv.doorId,
        ),
        "conflict",
        "Door already connected",
        409,
      );
      const connection: Connection = {
        id: id(),
        sourceAreaId: source.id,
        doorId: inv.doorId,
        targetAreaId: target.id,
        anchorId: inv.anchorId,
        sourceEndpointHash: inv.sourceEndpointHash,
        targetEndpointHash: inv.targetEndpointHash!,
        enabled: true,
      };
      s.connections[connection.id] = connection;
      inv.status = "accepted";
      // Proposing an endpoint also grants the source owner permission to host that destination.
      if (!target.sharedWith.includes(actor)) target.sharedWith.push(actor);
      return connection;
    }, "authoring");
  }
  async disable(actor: string, connectionId: string) {
    return this.store.transaction((s) => {
      const c = s.connections[connectionId];
      requireThat(
        c &&
          (s.areas[c.sourceAreaId]?.ownerId === actor ||
            s.areas[c.targetAreaId]?.ownerId === actor),
        "forbidden",
        "You do not own an endpoint",
        403,
      );
      c.enabled = false;
      for (const session of Object.values(s.sessions))
        emit(s, session.id, "connection_disabled");
      return c;
    });
  }
  async createSession(actor: string, name: string, areaIds: string[]) {
    return this.store.transaction((s) => {
      requireThat(areaIds.length > 0, "invalid_session", "Choose an area");
      const pins: Record<string, string> = {};
      for (const areaId of areaIds) {
        const area = s.areas[areaId];
        requireThat(
          area && playable(s, actor, area) && area.latestPublicationId,
          "forbidden",
          "Area is not published or shared with you",
          403,
        );
        if (areaId === areaIds[0]) pins[areaId] = area.latestPublicationId;
      }
      // Approved authored links carry into each session, within the host's access.
      const allowedAreaIds = [...new Set(areaIds)];
      for (const sourceId of allowedAreaIds) {
        const sourceScene =
          s.publications[s.areas[sourceId].latestPublicationId!].scene;
        for (const thing of flattenThings(sourceScene.things)) {
          const target = thing.interiorAreaId && s.areas[thing.interiorAreaId];
          if (
            target &&
            target.latestPublicationId &&
            playable(s, actor, target) &&
            !allowedAreaIds.includes(target.id)
          )
            allowedAreaIds.push(target.id);
        }
        const source = s.publications[s.areas[sourceId].latestPublicationId!];
        for (const c of Object.values(s.connections)) {
          const targetArea = s.areas[c.targetAreaId];
          if (
            !c.enabled ||
            c.sourceAreaId !== sourceId ||
            allowedAreaIds.includes(c.targetAreaId) ||
            !targetArea ||
            !playable(s, actor, targetArea) ||
            !targetArea.latestPublicationId
          )
            continue;
          const target = s.publications[targetArea.latestPublicationId];
          if (
            hash(source.scene.doors.find((d) => d.id === c.doorId)) ===
              c.sourceEndpointHash &&
            hash(target.scene.anchors.find((a) => a.id === c.anchorId)) ===
              c.targetEndpointHash
          )
            allowedAreaIds.push(targetArea.id);
        }
      }
      const session = {
        id: id(),
        name,
        hostId: actor,
        memberIds: [actor],
        allowedAreaIds,
        pins,
        createdAt: now(),
      };
      s.sessions[session.id] = session;
      return publicSession(session);
    });
  }
  async invitePlayer(actor: string, sessionId: string, recipientId: string) {
    return this.store.transaction((s) => {
      const session = member(s, actor, sessionId);
      requireThat(session.hostId === actor, "forbidden", "Host only", 403);
      requireThat(
        s.accounts[recipientId],
        "not_found",
        "Account not found",
        404,
      );
      if (!session.memberIds.includes(recipientId))
        session.memberIds.push(recipientId);
      emit(s, sessionId, "membership");
      return publicSession(session);
    });
  }
  async removePlayer(actor: string, sessionId: string, recipientId: string) {
    return this.store.transaction((s) => {
      const session = member(s, actor, sessionId);
      requireThat(
        session.hostId === actor && recipientId !== actor,
        "forbidden",
        "Host cannot be removed",
        403,
      );
      session.memberIds = session.memberIds.filter((x) => x !== recipientId);
      for (const p of Object.values(s.placements))
        if (
          p.sessionId === sessionId &&
          s.characters[p.characterId].ownerId === recipientId
        )
          delete s.placements[p.id];
      emit(s, sessionId, "membership");
      return publicSession(session);
    });
  }
  async createCharacter(
    actor: string,
    name: string,
    assetId?: string,
    imageAssetId?: string,
    description = "",
  ) {
    return this.store.transaction((s) => {
      if (assetId)
        requireThat(
          s.assets[assetId]?.ownerId === actor || assetId === "sample_token",
          "invalid_asset",
          "Choose your own image",
        );
      if (imageAssetId)
        requireThat(
          s.assets[imageAssetId]?.ownerId === actor ||
            imageAssetId === "sample_card",
          "invalid_asset",
          "Choose your own full art",
        );
      const c = {
        id: id(),
        ownerId: actor,
        name,
        assetId,
        imageAssetId,
        description,
      };
      s.characters[c.id] = c;
      return c;
    });
  }
  async updateCharacter(
    actor: string,
    characterId: string,
    patch: {
      tags?: string[];
      visible?: boolean;
      peerable?: boolean;
      space?: Space;
      name?: string;
      description?: string;
      assetId?: string;
      imageAssetId?: string;
      children?: Thing[];
    },
  ) {
    return this.store.transaction((s) => {
      const c = s.characters[characterId];
      requireThat(
        c?.ownerId === actor,
        "forbidden",
        "Only the character owner can edit its template",
        403,
      );
      for (const assetId of [
        patch.assetId,
        patch.imageAssetId,
        patch.space?.backgroundAssetId,
      ])
        if (assetId)
          requireThat(
            s.assets[assetId]?.ownerId === actor ||
              ["sample_token", "sample_card", "sample_map"].includes(assetId),
            "invalid_asset",
            "Choose your own image",
          );
      if (patch.children) {
        AreaSceneSchema.parse({ ...emptyScene(), things: patch.children });
        validateAssets(s, { ...emptyScene(), things: patch.children }, [actor]);
      }
      if (patch.tags) patch.tags = TagsSchema.parse(patch.tags);
      Object.assign(c, patch);
      for (const session of Object.values(s.sessions))
        if (session.memberIds.includes(actor))
          emit(s, session.id, "character_profile");
      return c;
    });
  }
  private joinCharacter(
    s: WorldState,
    actor: string,
    sessionId: string,
    characterId: string,
  ) {
    const session = member(s, actor, sessionId),
      c = s.characters[characterId];
    requireThat(
      c && c.ownerId === actor,
      "forbidden",
      "Choose your own character",
      403,
    );
    const existing = s.placements[characterId];
    if (existing) {
      requireThat(
        existing.sessionId === sessionId,
        "already_placed",
        "Character is active in another session; leave it first",
        409,
      );
      return existing;
    }
    session.inventories ??= {};
    session.inventories[characterId] ??= copyCharacterInventory(
      c.children ?? [],
      characterId,
    );
    const areaId = session.allowedAreaIds[0],
      pub = s.publications[session.pins[areaId]],
      anchor = pub.scene.anchors[0];
    const p = {
      id: characterId,
      characterId,
      sessionId,
      areaId,
      parentId: areaId,
      position: anchor.position,
      zoneId: zoneAt(pub.scene, anchor.position),
      revision: 0,
    };
    s.placements[p.id] = p;
    prepareViews(s, session);
    session.liveRevision = (session.liveRevision ?? 0) + 1;
    emit(s, sessionId, "join");
    return p;
  }
  async join(actor: string, sessionId: string, characterId: string) {
    return this.store.transaction((s) =>
      this.joinCharacter(s, actor, sessionId, characterId),
    );
  }
  async joinCharacters(
    actor: string,
    sessionId: string,
    characterIds: string[],
  ) {
    requireThat(
      characterIds.length > 0 && characterIds.length <= 50,
      "invalid_characters",
      "Select between one and fifty characters",
    );
    return this.store.transaction((s) =>
      [...new Set(characterIds)].map((id) =>
        this.joinCharacter(s, actor, sessionId, id),
      ),
    );
  }
  async leave(actor: string, sessionId: string, characterId: string) {
    return this.store.transaction((s) => {
      member(s, actor, sessionId);
      const p = s.placements[characterId];
      requireThat(
        p &&
          p.sessionId === sessionId &&
          s.characters[characterId]?.ownerId === actor,
        "forbidden",
        "Character unavailable",
        403,
      );
      delete s.placements[characterId];
      emit(s, sessionId, "leave");
      return { ok: true };
    });
  }
  async article(actor: string, areaId: string, sessionId?: string) {
    const s = await this.store.read();
    const area = s.areas[areaId];
    const session = sessionId ? member(s, actor, sessionId) : undefined;
    const accessible = (target: Area | undefined) =>
      !!target &&
      (session
        ? session.allowedAreaIds.includes(target.id) &&
          playable(s, session.hostId, target)
        : playable(s, actor, target));
    requireThat(accessible(area), "forbidden", "Article unavailable", 403);
    const publication =
      s.publications[(session?.pins[areaId] ?? area.latestPublicationId)!];
    requireThat(
      publication,
      "not_found",
      "No published article available",
      404,
    );
    const exits = publication.scene.doors.map((door) => {
      const connections = Object.values(s.connections).filter(
        (c) => c.sourceAreaId === areaId && c.doorId === door.id,
      );
      const connection = connections.find((c) => {
        if (!c.enabled || !accessible(s.areas[c.targetAreaId])) return false;
        const target =
          s.publications[
            (session?.pins[c.targetAreaId] ??
              s.areas[c.targetAreaId]?.latestPublicationId)!
          ];
        return (
          target &&
          hash(door) === c.sourceEndpointHash &&
          hash(target.scene.anchors.find((a) => a.id === c.anchorId)) ===
            c.targetEndpointHash
        );
      });
      if (!connection)
        return {
          doorId: door.id,
          name: door.name,
          status: connections.length
            ? ("unavailable" as const)
            : ("unexplored" as const),
        };
      const target =
        s.publications[
          (session?.pins[connection.targetAreaId] ??
            s.areas[connection.targetAreaId].latestPublicationId)!
        ];
      return {
        doorId: door.id,
        name: door.name,
        status: "connected" as const,
        targetAreaId: target.areaId,
        destinationName: target.name,
      };
    });
    return {
      areaId,
      isOwner: area.ownerId === actor,
      publicationId: publication.id,
      name: publication.name,
      article: publication.article,
      exits,
    };
  }
  private exitUsable(
    s: WorldState,
    sessionId: string,
    areaId: string,
    c: Connection,
  ) {
    const session = s.sessions[sessionId];
    if (
      !c.enabled ||
      c.sourceAreaId !== areaId ||
      !session.allowedAreaIds.includes(c.targetAreaId)
    )
      return false;
    const source = s.publications[session.pins[areaId]],
      target =
        s.publications[
          session.pins[c.targetAreaId] ??
            s.areas[c.targetAreaId]?.latestPublicationId
        ];
    return (
      !!source &&
      !!target &&
      hash(source.scene.doors.find((d) => d.id === c.doorId)) ===
        c.sourceEndpointHash &&
      hash(target.scene.anchors.find((a) => a.id === c.anchorId)) ===
        c.targetEndpointHash
    );
  }
  snapshot(
    s: WorldState,
    actor: string,
    sessionId: string,
    characterId: string,
    viewTarget: ViewTarget = { kind: "location" },
  ): PlaySnapshot {
    const session = member(s, actor, sessionId),
      character = s.characters[characterId],
      placement = s.placements[characterId];
    requireThat(
      character?.ownerId === actor && placement?.sessionId === sessionId,
      "forbidden",
      "Join with your own character",
      403,
    );
    const publication = s.publications[session.pins[placement.areaId]];
    const canControl = (id: string) =>
      controls(s, session, actor, placement.areaId, id);
    const rawThings = sceneThings(s, session, placement.areaId);
    const scene = {
      ...publication.scene,
      things: projectThings(
        s,
        session,
        actor,
        "area",
        placement.areaId,
        rawThings,
      ),
    };
    const safeSession = publicSession(session);
    let view;
    try {
      view = viewSnapshot(s, session, actor, placement, viewTarget);
    } catch (error) {
      if (!(error instanceof DomainError) || error.code !== "view_unavailable")
        throw error;
      view = viewSnapshot(s, session, actor, placement);
    }
    const occupants = Object.values(s.placements).filter(
      (p) =>
        p.sessionId === sessionId &&
        p.areaId === placement.areaId &&
        characterVisible(s, session, actor, p.characterId),
    );
    return {
      session: safeSession,
      view: {
        ...view,
        drawing: drawingView(s, session, actor, placement, view.target),
      },
      publication: {
        ...publication,
        scene,
      },
      scene,
      inventory: structuredClone(inventory(s, session, characterId)),
      inventories: Object.fromEntries(
        occupants
          .filter((p) => characterPeerable(s, session, actor, p.characterId))
          .map((p) => [
            p.characterId,
            projectThings(
              s,
              session,
              actor,
              "character",
              p.characterId,
              inventory(s, session, p.characterId),
            ),
          ]),
      ),
      controllableIds: [
        ...viewSnapshot(s, session, actor, placement).controllableIds,
        ...occupants
          .filter(
            (p) =>
              canControl(p.characterId) &&
              characterVisible(s, session, actor, p.characterId),
          )
          .map((p) => p.characterId),
      ],
      peerableIds: [
        ...viewSnapshot(s, session, actor, placement).peerableIds,
        ...occupants
          .filter((p) => characterPeerable(s, session, actor, p.characterId))
          .map((p) => p.characterId),
      ],
      character: {
        ...character,
        ...session.characterFlags?.[characterId],
        children: undefined,
      },
      placement,
      occupants: Object.values(s.placements)
        .filter(
          (p) =>
            p.sessionId === sessionId &&
            p.areaId === placement.areaId &&
            characterVisible(s, session, actor, p.characterId),
        )
        .map((p) => ({
          character: {
            ...s.characters[p.characterId],
            thingFields: undefined,
            ...session.characterFlags?.[p.characterId],
            space: characterPeerable(s, session, actor, p.characterId)
              ? session.characterSpaces?.[p.characterId]
              : undefined,
            children: undefined,
          },
          placement:
            p.characterId === characterId
              ? p
              : { ...p, interiorTrail: undefined },
        })),
      messages: Object.values(s.messages)
        .filter(
          (m) =>
            m.sessionId === sessionId &&
            (m.channel === "ooc" || m.areaId === placement.areaId),
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(-100),
      exits: Object.values(s.connections)
        .filter(
          (c) =>
            this.exitUsable(s, sessionId, placement.areaId, c) &&
            s.areas[c.targetAreaId] &&
            playable(s, session.hostId, s.areas[c.targetAreaId]),
        )
        .map((c) => ({
          doorId: c.doorId,
          connectionId: c.id,
          targetAreaId: c.targetAreaId,
          destinationName:
            s.publications[
              s.sessions[sessionId].pins[c.targetAreaId] ??
                s.areas[c.targetAreaId].latestPublicationId!
            ].name,
          name: publication.scene.doors.find((d) => d.id === c.doorId)!.name,
        })),
    };
  }
  async command(actor: string, command: Command) {
    return this.store.transaction((s) => {
      const operationKey = hash(`${actor}:${command.operationId}`),
        prior = s.operations[operationKey],
        fingerprint = hash(command);
      if (prior) {
        requireThat(
          prior.fingerprint === fingerprint,
          "operation_conflict",
          "Operation ID reused for another action",
          409,
        );
        member(s, actor, command.sessionId);
        return prior.result;
      }
      const session = member(s, actor, command.sessionId),
        character = s.characters[command.characterId],
        p = s.placements[command.characterId];
      requireThat(
        character?.ownerId === actor && p?.sessionId === session.id,
        "forbidden",
        "You cannot control that character",
        403,
      );
      prepareViews(s, session);
      if (command.type === "drawing") {
        drawCommand(s, session, actor, p, command);
      } else if (command.type === "interact") {
        interact(s, session, actor, p, command);
      } else if (command.type === "chat") {
        const m = {
          id: id(),
          sessionId: session.id,
          actorId: actor,
          characterId: character.id,
          displayName:
            command.channel === "speech"
              ? character.name
              : s.accounts[actor].name,
          channel: command.channel,
          areaId: command.channel === "speech" ? p.areaId : undefined,
          text: command.text,
          createdAt: now(),
        };
        s.messages[m.id] = m;
      } else {
        requireThat(
          p.revision === command.revision,
          "stale_placement",
          "Position changed; use the current snapshot",
          409,
        );
        if (command.type === "move") {
          const scene = s.publications[session.pins[p.areaId]].scene;
          requireThat(
            command.position[2] === 0 &&
              Math.abs(command.position[0]) <= scene.width / 2 &&
              Math.abs(command.position[1]) <= scene.depth / 2,
            "out_of_bounds",
            "Choose a position inside the area",
          );
          p.position = command.position;
          p.zoneId = zoneAt(scene, p.position);
        } else {
          const connection = s.connections[command.connectionId];
          requireThat(
            connection && this.exitUsable(s, session.id, p.areaId, connection),
            "exit_unavailable",
            "This exit is unavailable",
            409,
          );
          const targetArea = s.areas[connection.targetAreaId];
          requireThat(
            targetArea && playable(s, session.hostId, targetArea),
            "admission_denied",
            "Destination access was withdrawn",
            403,
          );
          session.pins[targetArea.id] ??= targetArea.latestPublicationId!;
          const pub = s.publications[session.pins[targetArea.id]],
            anchor = pub.scene.anchors.find(
              (a) => a.id === connection.anchorId,
            )!;
          p.interiorTrail = [];
          p.areaId = targetArea.id;
          p.parentId = targetArea.id;
          p.position = anchor.position;
          p.zoneId = zoneAt(pub.scene, p.position);
        }
        p.revision++;
        session.liveRevision = (session.liveRevision ?? 0) + 1;
      }
      prepareViews(s, session);
      const result = { ok: true, revision: p.revision };
      s.operations[operationKey] = {
        id: operationKey,
        actorId: actor,
        fingerprint,
        result,
        createdAt: now(),
      };
      emit(s, session.id, command.type);
      return result;
    });
  }
  async saveDrawing(
    actor: string,
    input: {
      sessionId: string;
      characterId: string;
      viewTarget: ViewTarget;
      boardId: string;
      boardRevision: number;
      draftRevision: string;
      operationId: string;
    },
  ) {
    const s = await this.store.read();
    const snap = this.snapshot(
      s,
      actor,
      input.sessionId,
      input.characterId,
      input.viewTarget,
    );
    const ctx = drawingContext(
      s,
      s.sessions[input.sessionId],
      actor,
      snap.placement,
      input.viewTarget,
    );
    requireThat(
      ctx.id === input.boardId && ctx.c.ownerId === actor && ctx.source,
      "forbidden",
      "Only the source owner can save this drawing",
      403,
    );
    const operationKey = hash(`${actor}:drawing-save:${input.operationId}`),
      fingerprint = hash(input),
      prior = s.operations[operationKey];
    if (prior) {
      requireThat(
        prior.fingerprint === fingerprint,
        "operation_conflict",
        "Operation ID reused for another save",
        409,
      );
      return prior.result as { ok: boolean; savedRevision: number };
    }
    const draft = await this.thingDocument(actor, ctx.source!.rootId);
    const node = draft.document.nodes[ctx.source!.nodeId];
    requireThat(node, "source_missing", "The source Thing is unavailable", 409);
    node.space ??= {
      width: ctx.c.space.width,
      depth: ctx.c.space.depth,
      zones: [],
      doors: [],
      anchors: [{ id: "entrance", name: "Entrance", position: [0, 0, 0] }],
    };
    requireThat(
      hash(node.space!.drawing ?? { version: 1, strokes: [] }) ===
        hash(ctx.board?.saved ?? ctx.initial),
      "drawing_source_conflict",
      "The authored drawing changed. Session ink is retained; reconcile the draft before saving.",
      409,
    );
    const captured = structuredClone(ctx.board?.drawing ?? ctx.initial);
    node.space!.drawing = captured;
    await this.saveThingDocument(
      actor,
      ctx.source!.rootId,
      input.draftRevision,
      hash(`drawing-save-inner:${input.operationId}`),
      draft.document,
      (latest) => {
        const fresh = this.snapshot(
          latest,
          actor,
          input.sessionId,
          input.characterId,
          input.viewTarget,
        );
        const live = drawingContext(
          latest,
          latest.sessions[input.sessionId],
          actor,
          fresh.placement,
          input.viewTarget,
        );
        requireThat(
          live.id === input.boardId &&
            live.c.ownerId === actor &&
            live.board?.revision === input.boardRevision,
          "board_conflict",
          "Drawing changed before saving; try again",
          409,
        );
      },
    );
    // Never write session records from the authoring transaction: play can advance while Wiki.js is saving.
    await this.store.transaction((latest) => {
      const board = latest.sessions[input.sessionId]?.drawings?.[input.boardId];
      if (board) board.saved = captured;
      latest.operations[operationKey] = {
        id: operationKey,
        actorId: actor,
        fingerprint,
        result: { ok: true, savedRevision: input.boardRevision },
        createdAt: now(),
      };
      emit(latest, input.sessionId, "drawing_saved");
    });
    return { ok: true, savedRevision: input.boardRevision };
  }
  async prepareViewState() {
    await this.store.transaction((s) => {
      for (const session of Object.values(s.sessions)) prepareViews(s, session);
    });
  }
  async library(actor: string) {
    const s = await this.store.read();
    return {
      account: s.accounts[actor],
      accounts: Object.values(s.accounts).map(({ id, name, email }) => ({
        id,
        name,
        email,
      })),
      areas: Object.values(s.areas).filter((a) => playable(s, actor, a)),
      invitations: Object.values(s.invitations)
        .filter((i) => i.inviterId === actor || i.recipientId === actor)
        .map((i) => ({
          ...i,
          sourceName: s.areas[i.sourceAreaId]?.name,
          targetName: i.targetAreaId
            ? s.areas[i.targetAreaId]?.name
            : undefined,
        })),
      connections: Object.values(s.connections).filter(
        (c) =>
          s.areas[c.sourceAreaId]?.ownerId === actor ||
          s.areas[c.targetAreaId]?.ownerId === actor,
      ),
      sessions: Object.values(s.sessions)
        .filter((x) => x.memberIds.includes(actor))
        .map(publicSession),
      characters: Object.values(s.characters).filter(
        (c) => c.ownerId === actor,
      ),
    };
  }
}
