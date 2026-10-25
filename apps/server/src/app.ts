import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import staticFiles from "@fastify/static";
import { Server } from "socket.io";
import { z, ZodError } from "zod";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  CommandSchema,
  DrawingPointSchema,
  ThingSchema,
  ThingDocumentSchema,
  TagsSchema,
  SpaceSchema,
  ViewTargetSchema,
  Id,
  flattenThings,
} from "@wikitop/shared";
import type { Config } from "./config.js";
import type { Store } from "./store.js";
import { World, id } from "./world.js";
import { Auth } from "./auth.js";
import { Assets } from "./assets.js";
import { DomainError, requireThat } from "./errors.js";
import { MemoryWiki } from "./wiki.js";
const Name = z.string().trim().min(1).max(120);
const object = (schema: z.ZodRawShape, body: unknown) =>
  z.object(schema).strict().parse(body);
const param = (req: any, key: string) => Id.parse(req.params[key]);
export async function buildApp(c: Config, store: Store, world: World) {
  await world.prepareViewState();
  const app = Fastify({
    logger:
      c.NODE_ENV !== "test"
        ? {
            serializers: {
              req: (req: any) => ({
                method: req.method,
                url: req.url?.split("?")[0],
                hostname: req.hostname,
                remoteAddress: req.ip,
              }),
            },
            redact: ["req.headers.authorization", "req.headers.cookie"],
          }
        : false,
    bodyLimit: 512 * 1024,
    trustProxy: 1,
  });
  await app.register(cookie);
  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0 },
  });
  const auth = new Auth(store, c),
    assets = new Assets(c);
  const rate = new Map<string, { time: number; count: number }>();
  app.addHook("onRequest", async (req) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.headers.origin;
      requireThat(
        origin === new URL(c.APP_URL).origin,
        "invalid_origin",
        "Request origin is not allowed",
        403,
      );
    }
    if (req.url.startsWith("/api") || req.url.startsWith("/auth")) {
      const key = req.ip,
        t = Date.now(),
        prev = rate.get(key);
      if (!prev || t - prev.time > 60000) rate.set(key, { time: t, count: 1 });
      else
        requireThat(
          ++prev.count <= 600,
          "rate_limited",
          "Too many requests",
          429,
        );
      if (rate.size > 10000)
        for (const [k, v] of rate) if (t - v.time > 60000) rate.delete(k);
    }
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({
        error: {
          code: "invalid_input",
          message: error.issues.map((i) => i.message).join("; "),
        },
      });
    if (error instanceof DomainError)
      return reply
        .code(error.status)
        .send({ error: { code: error.code, message: error.message } });
    const status = error.statusCode ?? 500;
    if (status >= 500) req.log.error(error);
    return reply.code(status).send({
      error: {
        code: status === 413 ? "file_too_large" : "request_failed",
        message:
          status === 413
            ? "Image exceeds the upload limit"
            : status >= 500
              ? "The request could not be completed"
              : error.message,
      },
    });
  });
  await auth.routes(app);
  app.get("/health", async () => ({ ok: true }));
  app.get("/health/ready", async () => {
    await store.read();
    return { ok: true };
  });
  app.get("/api/me", async (req) => ({
    account: await auth.account(req),
    wikiUrl: c.WIKI_MODE === "memory" ? "/api/dev/wiki" : c.WIKI_URL,
  }));
  app.get("/api/library", async (req) =>
    world.library((await auth.account(req)).id),
  );
  app.get("/api/operations", async (req) => {
    await auth.account(req);
    const s = await store.read();
    return {
      outboxPending: Object.values(s.outbox).filter((x) => !x.deliveredAt)
        .length,
      oldestPending:
        Object.values(s.outbox).find((x) => !x.deliveredAt)?.createdAt ?? null,
    };
  });
  app.post("/api/things", async (req) => {
    const a = await auth.account(req),
      b = object(
        {
          preset: z.enum(["character", "place", "item", "container"]),
          name: Name,
        },
        req.body,
      );
    return world.createThing(a.id, b.preset, b.name);
  });
  app.post("/api/drawings/save", async (req) =>
    world.saveDrawing(
      (await auth.account(req)).id,
      z
        .object({
          sessionId: Id,
          characterId: Id,
          viewTarget: ViewTargetSchema,
          boardId: z.string().max(1000),
          boardRevision: z.number().int().nonnegative(),
          draftRevision: z.string(),
          operationId: Id,
        })
        .strict()
        .parse(req.body),
    ),
  );
  app.get("/api/things/:id/document", async (req) =>
    world.thingDocument((await auth.account(req)).id, param(req, "id")),
  );
  app.put("/api/things/:id/document", async (req) => {
    const a = await auth.account(req),
      b = object(
        {
          revision: z.string().regex(/^[a-f0-9]{64}$/),
          operationId: Id,
          document: ThingDocumentSchema,
        },
        req.body,
      );
    return world.saveThingDocument(
      a.id,
      param(req, "id"),
      b.revision,
      b.operationId,
      b.document,
    );
  });
  app.post("/api/areas", async (req) => {
    const a = await auth.account(req),
      b = object({ name: Name }, req.body);
    return world.createArea(a.id, b.name);
  });
  app.get("/api/areas/:id/article", async (req) => {
    const actor = await auth.account(req);
    const query = object({ sessionId: Id.optional() }, req.query);
    return world.article(actor.id, param(req, "id"), query.sessionId);
  });
  app.patch("/api/areas/:id", async (req) => {
    const actor = await auth.account(req);
    const body = object({ tags: TagsSchema }, req.body);
    return world.setAreaTags(actor.id, param(req, "id"), body.tags);
  });
  app.get("/api/areas/:id/draft", async (req) =>
    world.draft((await auth.account(req)).id, param(req, "id")),
  );
  app.put("/api/areas/:id/scene", async (req) => {
    const a = await auth.account(req),
      b = object(
        { revision: z.number().int().nonnegative(), scene: z.unknown() },
        req.body,
      );
    return world.saveScene(a.id, param(req, "id"), b.revision, b.scene);
  });
  app.post("/api/areas/:id/publish", async (req) =>
    world.publish((await auth.account(req)).id, param(req, "id")),
  );
  app.post("/api/areas/:id/share", async (req) => {
    const a = await auth.account(req),
      b = object({ recipientId: Id }, req.body);
    return world.share(a.id, param(req, "id"), b.recipientId);
  });
  app.post("/api/areas/:id/exits/:doorId/create", async (req) => {
    const a = await auth.account(req),
      b = object({ name: Name, invitationId: Id.optional() }, req.body);
    return world.createBeyond(
      a.id,
      param(req, "id"),
      param(req, "doorId"),
      b.name,
      b.invitationId,
    );
  });
  app.post("/api/areas/:id/exits/:doorId/invite-link", async (req) => {
    const inv = await world.frontierInvite(
      (await auth.account(req)).id,
      param(req, "id"),
      param(req, "doorId"),
    );
    return { id: inv.id, url: `${c.APP_URL}/contribute/${inv.id}` };
  });
  app.post("/api/areas/:id/exits/:doorId/request", async (req) => {
    const a = await auth.account(req),
      b = object({ sessionId: Id.optional() }, req.body ?? {});
    return world.frontierInvite(
      a.id,
      param(req, "id"),
      param(req, "doorId"),
      true,
      b.sessionId,
    );
  });
  app.post("/api/invitations/:id/resolve", async (req) => {
    const a = await auth.account(req),
      b = object({ approve: z.boolean() }, req.body);
    return world.resolveFrontier(a.id, param(req, "id"), b.approve);
  });
  app.post("/api/invitations/:id/claim", async (req) =>
    world.claimFrontier((await auth.account(req)).id, param(req, "id")),
  );
  app.post("/api/invitations", async (req) => {
    const a = await auth.account(req),
      b = object({ sourceAreaId: Id, doorId: Id, recipientId: Id }, req.body);
    return world.inviteConnection(
      a.id,
      b.sourceAreaId,
      b.doorId,
      b.recipientId,
    );
  });
  app.post("/api/invitations/:id/propose", async (req) => {
    const a = await auth.account(req),
      b = object({ targetAreaId: Id, anchorId: Id }, req.body);
    return world.propose(a.id, param(req, "id"), b.targetAreaId, b.anchorId);
  });
  app.post("/api/invitations/:id/accept", async (req) =>
    world.accept((await auth.account(req)).id, param(req, "id")),
  );
  app.post("/api/connections/:id/disable", async (req) =>
    world.disable((await auth.account(req)).id, param(req, "id")),
  );
  app.post("/api/sessions", async (req) => {
    const a = await auth.account(req),
      b = object({ name: Name, areaIds: z.array(Id).min(1).max(30) }, req.body);
    return world.createSession(a.id, b.name, b.areaIds);
  });
  app.post("/api/sessions/:id/invite", async (req) => {
    const a = await auth.account(req),
      b = object({ recipientId: Id }, req.body);
    return world.invitePlayer(a.id, param(req, "id"), b.recipientId);
  });
  app.post("/api/sessions/:id/remove", async (req) => {
    const a = await auth.account(req),
      b = object({ recipientId: Id }, req.body);
    return world.removePlayer(a.id, param(req, "id"), b.recipientId);
  });
  app.patch("/api/characters/:id", async (req) => {
    const actor = await auth.account(req);
    const body = object(
      {
        name: Name.optional(),
        tags: TagsSchema.optional(),
        visible: z.boolean().optional(),
        peerable: z.boolean().optional(),
        space: SpaceSchema.optional(),
        description: z.string().max(10000).optional(),
        assetId: Id.optional(),
        imageAssetId: Id.optional(),
        children: z.array(ThingSchema).max(200).optional(),
      },
      req.body,
    );
    return world.updateCharacter(actor.id, param(req, "id"), body);
  });
  app.post("/api/characters", async (req) => {
    const a = await auth.account(req),
      b = object(
        {
          name: Name,
          assetId: Id.optional(),
          imageAssetId: Id.optional(),
          description: z.string().max(10000).optional(),
        },
        req.body,
      );
    return world.createCharacter(
      a.id,
      b.name,
      b.assetId,
      b.imageAssetId,
      b.description,
    );
  });
  app.post("/api/sessions/:id/join-characters", async (req) => {
    const actor = await auth.account(req);
    const body = z
      .object({ characterIds: z.array(Id).min(1).max(50) })
      .strict()
      .parse(req.body);
    return world.joinCharacters(actor.id, param(req, "id"), body.characterIds);
  });
  app.post("/api/sessions/:id/join", async (req) => {
    const a = await auth.account(req),
      b = object({ characterId: Id }, req.body);
    return world.join(a.id, param(req, "id"), b.characterId);
  });
  app.post("/api/sessions/:id/leave", async (req) => {
    const a = await auth.account(req),
      b = object({ characterId: Id }, req.body);
    return world.leave(a.id, param(req, "id"), b.characterId);
  });
  app.get("/api/sessions/:id/snapshot/:characterId", async (req) =>
    world.snapshot(
      await store.read(),
      (await auth.account(req)).id,
      param(req, "id"),
      param(req, "characterId"),
    ),
  );
  app.post("/api/assets", async (req) => {
    const a = await auth.account(req),
      file = await req.file();
    requireThat(file, "invalid_image", "Choose an image");
    const buffer = await file.toBuffer(),
      assetId = id();
    requireThat(
      !file.file.truncated,
      "file_too_large",
      "Asset exceeds 10 MiB",
      413,
    );
    const model =
      file.filename.toLowerCase().endsWith(".glb") ||
      file.mimetype === "model/gltf-binary";
    const key = model ? `models/${assetId}.glb` : `images/${assetId}.webp`;
    const metadata = model
      ? await assets.uploadModel(key, buffer)
      : { ...(await assets.upload(key, buffer)), kind: "image" as const };
    const asset = { id: assetId, ownerId: a.id, key, ...metadata };
    await store.transaction((s) => {
      s.assets[assetId] = asset;
    });
    return asset;
  });
  app.get("/api/assets/:id", async (req, reply) => {
    const actor = await auth.account(req),
      assetId = param(req, "id"),
      s = await store.read(),
      asset = s.assets[assetId];
    requireThat(asset, "not_found", "Image not found", 404);
    const has = (things: import("@wikitop/shared").Thing[]) =>
      flattenThings(things).some(
        (t) =>
          t.visual?.assetId === assetId ||
          t.visual?.mapAssetId === assetId ||
          t.modelAssetId === assetId ||
          t.imageAssetId === assetId ||
          t.space?.backgroundAssetId === assetId,
      );
    const allowed =
      asset.ownerId === actor.id ||
      Object.values(s.placements).some((p) => {
        if (
          s.characters[p.characterId]?.ownerId !== actor.id ||
          !s.sessions[p.sessionId]?.memberIds.includes(actor.id)
        )
          return false;
        const snapshot = world.snapshot(
          s,
          actor.id,
          p.sessionId,
          p.characterId,
        );
        return (
          has(snapshot.scene.things) ||
          Object.values(snapshot.inventories).some(has) ||
          snapshot.occupants.some(
            (o) =>
              o.character.assetId === assetId ||
              o.character.visual?.assetId === assetId ||
              o.character.modelAssetId === assetId ||
              o.character.imageAssetId === assetId ||
              o.character.space?.backgroundAssetId === assetId,
          )
        );
      });
    requireThat(
      allowed || (await world.canReadAsset(actor.id, assetId)),
      "forbidden",
      "Asset not available",
      403,
    );
    if (asset.url)
      return reply
        .header("Cache-Control", "private, no-store")
        .header("Referrer-Policy", "no-referrer")
        .redirect(asset.url);
    return reply
      .header("Cache-Control", "private, no-store")
      .type(asset.mime)
      .send(await assets.read(asset.key));
  });
  if (c.DEV_AUTH === "true" && world.wiki instanceof MemoryWiki) {
    const wiki = world.wiki;
    const escape = (value: string) =>
      value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll('"', "&quot;");
    app.get("/api/dev/wiki", async (req, reply) => {
      const actor = await auth.account(req),
        state = await store.read();
      const areas = Object.values(state.areas).filter(
        (area) =>
          area.ownerId === actor.id || area.collaborators.includes(actor.id),
      );
      return reply
        .type("text/html")
        .send(
          `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>WikiTop articles</title></head><body><main><a href="/">← Your worlds</a><h1>Your wiki articles</h1><p>Edit draft prose here. Publish from the area editor when ready; active sessions keep their current publication.</p><ul>${areas.map((area) => `<li><a href="/api/dev/wiki/${area.articleId}">${escape(area.name)}</a></li>`).join("")}</ul>${areas.length ? "" : "<p>Create an area in Your worlds to write your first article.</p>"}</main></body></html>`,
        );
    });
    app.get("/api/dev/wiki/:id", async (req, reply) => {
      const a = await auth.account(req),
        pageId = Number((req.params as any).id),
        s = await store.read(),
        area = Object.values(s.areas).find((x) => x.articleId === pageId);
      requireThat(
        area && (area.ownerId === a.id || area.collaborators.includes(a.id)),
        "forbidden",
        "Article unavailable",
        403,
      );
      const page = await wiki.read(pageId);
      const published = area.latestPublicationId
        ? await world.article(a.id, area.id)
        : undefined;
      const exitsHtml = published
        ? `<section><h2>Exits</h2><ul>${published.exits.map((exit) => `<li>${escape(exit.name)} → ${exit.targetAreaId ? `<a href="/articles/${exit.targetAreaId}">${escape(exit.destinationName!)}</a>` : exit.status === "unexplored" ? `<a href="/articles/${area.id}#exit-${exit.doorId}">Unexplored — build beyond this exit</a>` : "Unavailable"}</li>`).join("")}</ul><a href="/articles/${area.id}">Read published article</a><p>Generated from published doors and current approved connections.</p></section>`
        : "<p>Publish this area to catalog its exits.</p>";
      return reply
        .type("text/html")
        .send(
          `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Edit ${escape(area.name)}</title></head><body><main><a href="/api/dev/wiki">← Your wiki articles</a><h1>Edit ${escape(area.name)}</h1><p>Changes save to the draft. Publish from the area editor to make them available to new sessions.</p><form method="post"><label>Article content<textarea name="content" style="display:block;width:90%;height:60vh">${escape(page.content)}</textarea></label><button>Save article</button></form>${exitsHtml}</main></body></html>`,
        );
    });
    app.addContentTypeParser(
      "application/x-www-form-urlencoded",
      { parseAs: "string" },
      (_req, body, done) =>
        done(null, Object.fromEntries(new URLSearchParams(String(body)))),
    );
    app.post("/api/dev/wiki/:id", async (req, reply) => {
      const a = await auth.account(req),
        pageId = Number((req.params as any).id),
        s = await store.read();
      requireThat(
        Object.values(s.areas).some(
          (x) =>
            x.articleId === pageId &&
            (x.ownerId === a.id || x.collaborators.includes(a.id)),
        ),
        "forbidden",
        "Article unavailable",
        403,
      );
      const body = object({ content: z.string().max(100000) }, req.body);
      const page = await wiki.read(pageId);
      wiki.pages.set(pageId, { ...page, content: body.content });
      return reply.redirect(`/api/dev/wiki/${pageId}`);
    });
  }
  const io = new Server(app.server, {
    maxHttpBufferSize: 16000,
    serveClient: false,
    allowRequest: (req, cb) =>
      cb(null, req.headers.origin === new URL(c.APP_URL).origin),
  });
  io.use(async (socket, next) => {
    try {
      const account = await auth.account({
        cookies: app.parseCookie(socket.request.headers.cookie ?? ""),
      });
      socket.data.actor = account.id;
      next();
    } catch {
      next(new Error("Sign in required"));
    }
  });
  const failure = (e: unknown) => ({
    ok: false,
    error: {
      code:
        e instanceof DomainError
          ? e.code
          : e instanceof ZodError
            ? "invalid_input"
            : "command_failed",
      message:
        e instanceof DomainError
          ? e.message
          : e instanceof ZodError
            ? "Invalid command"
            : "Action could not be completed",
    },
  });
  io.on("connection", (socket) => {
    let budget = 0,
      start = Date.now();
    const clearPreview = () => {
      socket.data.ink = undefined;
      for (const peer of io.sockets.sockets.values())
        if (
          peer.data.subscription?.sessionId ===
          socket.data.subscription?.sessionId
        )
          peer.emit("drawing-clear-preview", socket.id);
    };
    socket.on("disconnect", clearPreview);
    let previewTime = 0;
    socket.on("drawing-preview", async (input) => {
      if (Date.now() - previewTime < 45) return;
      previewTime = Date.now();
      try {
        const actor = await auth.account({
          cookies: app.parseCookie(socket.request.headers.cookie ?? ""),
        });
        const b = z
          .object({
            boardId: z.string().max(1000),
            strokeId: Id.optional(),
            color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
            width: z.number().min(0.01).max(2),
            offset: z.number().int().min(0).max(512),
            points: z.array(DrawingPointSchema).max(64),
            cursor: DrawingPointSchema.optional(),
          })
          .strict()
          .parse(input);
        const sub = socket.data.subscription;
        if (!sub) return;
        const state = await store.read(),
          snap = world.snapshot(
            state,
            actor.id,
            sub.sessionId,
            sub.characterId,
            sub.viewTarget,
          ),
          board = snap.view.drawing!;
        if (board.id !== b.boardId || (!board.owner && !board.enabled)) return;
        const previous = socket.data.ink;
        const points = b.strokeId
          ? b.offset === 0
            ? b.points
            : previous?.strokeId === b.strokeId &&
                previous.points.length === b.offset
              ? [...previous.points, ...b.points]
              : []
          : [];
        if (points.length > 512) return;
        socket.data.ink = {
          ...b,
          points,
          actorId: actor.id,
          name: actor.name,
          updatedAt: Date.now(),
        };
        for (const peer of io.sockets.sockets.values()) {
          const dest = peer.data.subscription;
          if (
            peer.id === socket.id ||
            !dest ||
            dest.sessionId !== sub.sessionId
          )
            continue;
          try {
            await auth.account({
              cookies: app.parseCookie(peer.request.headers.cookie ?? ""),
            });
            const target = world.snapshot(
              state,
              peer.data.actor,
              dest.sessionId,
              dest.characterId,
              dest.viewTarget,
            );
            if (target.view.drawing?.id === board.id)
              peer.emit("drawing-preview", {
                ...socket.data.ink,
                connectionId: socket.id,
              });
          } catch {}
        }
      } catch {}
    });
    socket.on("subscribe", async (input, ack) => {
      if (typeof ack !== "function") return;
      try {
        const account = await auth.account({
          cookies: app.parseCookie(socket.request.headers.cookie ?? ""),
        });
        const b = object(
          {
            sessionId: Id,
            characterId: Id,
            viewTarget: ViewTargetSchema.optional(),
          },
          input,
        );
        const snapshot = world.snapshot(
          await store.read(),
          account.id,
          b.sessionId,
          b.characterId,
          b.viewTarget,
        );
        clearPreview();
        socket.data.subscription = { ...b, viewTarget: snapshot.view.target };
        ack({ ok: true, snapshot });
      } catch (e) {
        ack(failure(e));
      }
    });
    socket.on("view", async (input, ack) => {
      if (typeof ack !== "function") return;
      try {
        const actor = await auth.account({
          cookies: app.parseCookie(socket.request.headers.cookie ?? ""),
        });
        const b = object(
          { sessionId: Id, characterId: Id, viewTarget: ViewTargetSchema },
          input,
        );
        const state = await store.read();
        const snapshot = world.snapshot(
          state,
          actor.id,
          b.sessionId,
          b.characterId,
          b.viewTarget,
        );
        if (
          JSON.stringify(snapshot.view.target) !== JSON.stringify(b.viewTarget)
        )
          throw new DomainError(
            "view_unavailable",
            "That space is hidden, closed, or no longer accessible",
            403,
          );
        clearPreview();
        socket.data.subscription = { ...b, viewTarget: snapshot.view.target };
        ack({ ok: true, snapshot });
      } catch (e) {
        ack(failure(e));
      }
    });
    socket.on("command", async (input, ack) => {
      if (typeof ack !== "function") return;
      try {
        if (Date.now() - start > 1000) {
          budget = 0;
          start = Date.now();
        }
        requireThat(++budget <= 30, "rate_limited", "Slow down", 429);
        const actor = await auth.account({
          cookies: app.parseCookie(socket.request.headers.cookie ?? ""),
        });
        const command = CommandSchema.parse(input);
        const result = await world.command(actor.id, command);
        ack(result);
        await dispatch();
      } catch (e) {
        ack(failure(e));
      }
    });
  });
  let dispatching = false;
  async function dispatch() {
    if (dispatching) return;
    dispatching = true;
    try {
      const state = await store.read(),
        events = Object.values(state.outbox).filter((e) => !e.deliveredAt);
      if (!events.length) return;
      const sessions = new Set(events.map((e) => e.sessionId));
      for (const socket of io.sockets.sockets.values()) {
        const sub = socket.data.subscription;
        if (!sub || !sessions.has(sub.sessionId)) continue;
        try {
          await auth.account({
            cookies: app.parseCookie(socket.request.headers.cookie ?? ""),
          });
          const snapshot = world.snapshot(
            state,
            socket.data.actor,
            sub.sessionId,
            sub.characterId,
            sub.viewTarget,
          );
          socket.data.subscription = {
            ...sub,
            viewTarget: snapshot.view.target,
          };
          const ink = socket.data.ink,
            board = snapshot.view.drawing;
          if (
            ink &&
            (!board ||
              ink.boardId !== board.id ||
              (!board.enabled && !board.owner) ||
              board.drawing.strokes.some((s) => s.id === ink.strokeId))
          ) {
            socket.data.ink = undefined;
            for (const peer of io.sockets.sockets.values())
              if (peer.data.subscription?.sessionId === sub.sessionId)
                peer.emit("drawing-clear-preview", socket.id);
          }
          socket.emit("snapshot", snapshot);
        } catch {
          socket.emit("revoked", { message: "Session access ended" });
          socket.disconnect(true);
        }
      }
      await store.transaction((s) => {
        for (const e of events)
          if (s.outbox[e.id])
            s.outbox[e.id].deliveredAt = new Date().toISOString();
      });
    } catch (error) {
      app.log.error(error, "Outbox delivery failed");
    } finally {
      dispatching = false;
    }
  }
  const timer = setInterval(() => void dispatch(), 250);
  timer.unref();
  const expiry = setInterval(async () => {
    for (const socket of io.sockets.sockets.values())
      try {
        await auth.account({
          cookies: app.parseCookie(socket.request.headers.cookie ?? ""),
        });
      } catch {
        socket.emit("revoked", { message: "Sign in again" });
        socket.disconnect(true);
      }
  }, 30000);
  expiry.unref();
  app.addHook("onClose", async () => {
    clearInterval(timer);
    clearInterval(expiry);
    await io.close();
    await store.close();
  });
  const root = resolve(import.meta.dirname, "../../web/dist");
  if (existsSync(root)) {
    await app.register(staticFiles, { root });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api") || req.url.startsWith("/auth"))
        return reply.code(404).send({
          error: { code: "not_found", message: "Endpoint not found" },
        });
      return reply.sendFile("index.html");
    });
  }
  return { app, io, world, auth, dispatch, assets };
}
