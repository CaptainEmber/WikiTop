import { DurableObject } from "cloudflare:workers";
import {
  PlayCommandSchema,
  PlayRoomSnapshotSchema,
  ROOM_EMPTY_TTL_MS,
  ROOM_MAX_PARTICIPANTS,
  promoteLongestConnected,
  type CharacterSummary,
  type PlayCommand,
  type PlayParticipant,
  type PlayRoomSnapshot,
  type PlayServerMessage,
  type WorldRevision,
} from "@wikitop/play-protocol";
import { z } from "zod";

interface Env {
  ROOMS: DurableObjectNamespace<PlayRoom>;
  ALLOWED_ORIGINS: string;
}
interface StoredRoom {
  snapshot: PlayRoomSnapshot;
  inviteHash: string;
  reconnectHashes: Record<string, string>;
  operations: string[];
}
interface Attachment {
  participantId: string;
  reconnectSecret: string;
  windowAt: number;
  messages: number;
}
const CreateSchema = z.object({
  location: z.object({
    thingId: z.string().min(1).max(160),
    source: z.enum(["published", "host-local"]),
  }),
  world: z.object({
    repository: z.string(),
    commit: z.string(),
    rawBase: z.string().url(),
  }),
  host: z.object({
    id: z.string().min(1).max(160),
    name: z.string().min(1).max(60),
    character: z.any(),
  }),
});
const encoder = new TextEncoder();
const hash = async (value: string) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
const secret = () => {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
};
const json = (value: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
function cors(request: Request, env: Env) {
  const origin = request.headers.get("Origin") ?? "";
  return env.ALLOWED_ORIGINS.split(",").includes(origin)
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "Content-Type,Sec-WebSocket-Protocol",
        "Access-Control-Allow-Methods": "POST,GET,OPTIONS",
        Vary: "Origin",
      }
    : undefined;
}

export default {
  async fetch(request: Request, env: Env) {
    const headers = cors(request, env);
    if (request.method === "OPTIONS")
      return headers
        ? new Response(null, { status: 204, headers })
        : new Response("Forbidden", { status: 403 });
    if (!headers) return json({ error: "Origin not allowed" }, 403);
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/rooms") {
      const parsed = CreateSchema.safeParse(
        await request.json().catch(() => null),
      );
      if (!parsed.success) return json({ error: "Invalid room" }, 400, headers);
      const id = env.ROOMS.newUniqueId(),
        inviteSecret = secret(),
        hostSecret = secret(),
        now = Date.now(),
        character = parsed.data.host.character as CharacterSummary;
      const participant: PlayParticipant = {
        id: parsed.data.host.id,
        name: parsed.data.host.name,
        role: "host",
        connected: false,
        joinedAt: now,
        character,
        reconnectUntil: now + ROOM_EMPTY_TTL_MS,
        position: [0, 0, 0],
      };
      const snapshot: PlayRoomSnapshot = PlayRoomSnapshotSchema.parse({
        id: id.toString(),
        revision: 0,
        hostId: participant.id,
        worldOwnerId: participant.id,
        location: parsed.data.location,
        world: parsed.data.world,
        participants: [participant],
        boards: {},
        createdAt: now,
      });
      await env.ROOMS.get(id).fetch("https://room/initialize", {
        method: "POST",
        body: JSON.stringify({
          snapshot,
          inviteHash: await hash(inviteSecret),
          hostId: participant.id,
          hostHash: await hash(hostSecret),
        }),
      });
      return json(
        {
          roomId: id.toString(),
          inviteSecret,
          participantId: participant.id,
          reconnectSecret: hostSecret,
          snapshot,
        },
        201,
        headers,
      );
    }
    const match = url.pathname.match(/^\/rooms\/([a-f0-9]+)\/connect$/);
    if (match) {
      let id: DurableObjectId;
      try {
        id = env.ROOMS.idFromString(match[1]);
      } catch {
        return json({ error: "Invalid room" }, 404, headers);
      }
      return env.ROOMS.get(id).fetch(request);
    }
    return json({ error: "Not found" }, 404, headers);
  },
} satisfies ExportedHandler<Env>;

export class PlayRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong"),
    );
  }
  private async load() {
    return this.ctx.storage.get<StoredRoom>("room");
  }
  private async save(room: StoredRoom) {
    await this.ctx.storage.put("room", room);
  }
  private send(ws: WebSocket, message: PlayServerMessage) {
    ws.send(JSON.stringify(message));
  }
  private broadcast(message: PlayServerMessage, except?: WebSocket) {
    const data = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets())
      if (socket !== except)
        try {
          socket.send(data);
        } catch {}
  }
  private socketFor(participantId: string) {
    return this.ctx.getWebSockets(`p:${participantId}`)[0];
  }
  async fetch(request: Request) {
    const url = new URL(request.url);
    if (url.pathname === "/initialize" && request.method === "POST") {
      if (await this.load()) return new Response("Exists", { status: 409 });
      const body = await request.json<any>();
      const stored: StoredRoom = {
        snapshot: PlayRoomSnapshotSchema.parse(body.snapshot),
        inviteHash: body.inviteHash,
        reconnectHashes: { [body.hostId]: body.hostHash },
        operations: [],
      };
      await this.save(stored);
      await this.ctx.storage.setAlarm(Date.now() + ROOM_EMPTY_TTL_MS);
      return new Response("Created", { status: 201 });
    }
    if (request.headers.get("Upgrade") !== "websocket")
      return new Response("Upgrade required", { status: 426 });
    const room = await this.load();
    if (!room) return new Response("Room expired", { status: 410 });
    const protocol = request.headers.get("Sec-WebSocket-Protocol") ?? "",
      match = protocol.match(/^wikitop\.([A-Za-z0-9_-]{40,})$/);
    if (!match) return new Response("Missing room credential", { status: 401 });
    const supplied = await hash(match[1]),
      requestedId = url.searchParams.get("participantId") ?? "",
      name = (url.searchParams.get("name") ?? "Guest").slice(0, 60),
      characterRaw = url.searchParams.get("character");
    let character: CharacterSummary;
    try {
      character = JSON.parse(characterRaw ?? "");
    } catch {
      return new Response("Invalid character", { status: 400 });
    }
    let participant = room.snapshot.participants.find(
        (p) => p.id === requestedId,
      ),
      reconnectSecret = match[1];
    if (participant) {
      if (room.reconnectHashes[participant.id] !== supplied)
        return new Response("Invalid reconnect credential", { status: 403 });
    } else {
      if (supplied !== room.inviteHash)
        return new Response("Invalid invitation", { status: 403 });
      if (
        room.snapshot.participants.filter((p) => p.connected).length >=
        ROOM_MAX_PARTICIPANTS
      )
        return new Response("Room full", { status: 409 });
      if (room.snapshot.participants.length >= ROOM_MAX_PARTICIPANTS) {
        const stale = room.snapshot.participants
          .filter((p) => !p.connected)
          .sort((a, b) => a.joinedAt - b.joinedAt)[0];
        if (!stale) return new Response("Room full", { status: 409 });
        room.snapshot.participants = room.snapshot.participants.filter(
          (p) => p.id !== stale.id,
        );
        delete room.reconnectHashes[stale.id];
      }
      const id = `player_${crypto.randomUUID()}`,
        nextSecret = secret();
      reconnectSecret = nextSecret;
      participant = {
        id,
        name,
        role: "player",
        connected: true,
        joinedAt: Date.now(),
        character,
        position: [0, 0, 0],
        reconnectUntil: Date.now() + ROOM_EMPTY_TTL_MS,
      };
      room.snapshot.participants.push(participant);
      room.reconnectHashes[id] = await hash(nextSecret);
    }
    participant.connected = true;
    participant.name = name;
    participant.character = character;
    participant.reconnectUntil = Date.now() + ROOM_EMPTY_TTL_MS;
    room.snapshot.revision++;
    await this.ctx.storage.deleteAlarm();
    await this.save(room);
    const pair = new WebSocketPair(),
      client = pair[0],
      server = pair[1];
    this.ctx.acceptWebSocket(server, [`p:${participant.id}`]);
    server.serializeAttachment({
      participantId: participant.id,
      reconnectSecret,
      windowAt: Date.now(),
      messages: 0,
    } satisfies Attachment);
    this.send(server, {
      type: "welcome",
      participantId: participant.id,
      reconnectSecret,
      snapshot: room.snapshot,
    });
    this.broadcast({ type: "snapshot", snapshot: room.snapshot }, server);
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "Sec-WebSocket-Protocol": protocol },
    });
  }
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== "string") {
      ws.close(1003, "JSON commands only");
      return;
    }
    const attachment = ws.deserializeAttachment() as Attachment,
      now = Date.now();
    if (now - attachment.windowAt > 10000) {
      attachment.windowAt = now;
      attachment.messages = 0;
    }
    if (++attachment.messages > 300) {
      ws.close(1008, "Rate limit");
      return;
    }
    ws.serializeAttachment(attachment);
    const parsed = PlayCommandSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      this.send(ws, {
        type: "error",
        code: "invalid-command",
        message: "Invalid play command",
      });
      return;
    }
    await this.command(ws, attachment.participantId, parsed.data);
  }
  private async command(ws: WebSocket, actorId: string, command: PlayCommand) {
    const room = await this.load();
    if (!room) return;
    const actor = room.snapshot.participants.find((p) => p.id === actorId);
    if (!actor) return;
    const host = room.snapshot.hostId === actorId;
    if (command.type === "thing-request") {
      const target = this.socketFor(command.ownerId);
      if (target)
        this.send(target, {
          type: "thing-request",
          requestId: command.requestId,
          requesterId: actorId,
          thingId: command.thingId,
        });
      else
        this.send(ws, {
          type: "error",
          code: "source-offline",
          message: "Thing owner is offline",
        });
      return;
    }
    if (command.type === "thing-chunk") {
      const target = this.socketFor(command.targetId);
      if (target)
        this.send(target, {
          type: "thing-chunk",
          requestId: command.requestId,
          ownerId: actorId,
          thingId: command.thingId,
          index: command.index,
          total: command.total,
          byteLength: command.byteLength,
          sha256: command.sha256,
          data: command.data,
        });
      return;
    }
    if (command.type === "cursor") {
      this.broadcast(
        {
          type: "cursor",
          participantId: actorId,
          thingId: command.thingId,
          position: command.position,
          color: command.color,
        },
        ws,
      );
      return;
    }
    if (room.operations.includes(command.operationId)) {
      this.send(ws, {
        type: "ack",
        operationId: command.operationId,
        revision: room.snapshot.revision,
      });
      return;
    }
    if (command.revision !== room.snapshot.revision) {
      this.send(ws, {
        type: "error",
        operationId: command.operationId,
        code: "stale-revision",
        message: "Room changed; retry from the latest state",
      });
      this.send(ws, { type: "snapshot", snapshot: room.snapshot });
      return;
    }
    const fail = (message: string) =>
      this.send(ws, {
        type: "error",
        operationId: command.operationId,
        code: "forbidden",
        message,
      });
    if (command.type === "move") {
      if (command.participantId !== actorId && !host)
        return fail("Only the owner or host can move this token");
      const target = room.snapshot.participants.find(
        (p) => p.id === command.participantId,
      );
      if (!target) return fail("Participant not found");
      target.position = command.position;
    } else if (command.type === "travel") {
      if (!host) return fail("Only the host can move the party");
      if (
        command.source === "host-local" &&
        actorId !== room.snapshot.worldOwnerId
      )
        return fail(
          "Only the local world's source can open an uncached destination",
        );
      room.snapshot.location = {
        thingId: command.thingId,
        source: command.source,
        anchorId: command.anchorId,
      };
      for (const p of room.snapshot.participants) p.position = command.arrival;
    } else if (command.type === "transfer-host") {
      if (!host) return fail("Only the host can transfer leadership");
      const target = room.snapshot.participants.find(
        (p) => p.id === command.participantId && p.connected,
      );
      if (!target) return fail("Choose a connected participant");
      room.snapshot.participants.forEach(
        (p) => (p.role = p.id === target.id ? "host" : "player"),
      );
      room.snapshot.hostId = target.id;
    } else if (command.type === "character-update") {
      if (command.character.id !== actor.character.id)
        return fail("Character identity cannot change during a room");
      actor.character = command.character;
    } else if (
      command.type === "instance-move" ||
      command.type === "instance-update"
    ) {
      if (!host) return fail("Only the host can change placed Things");
      if (command.instance.pageId !== room.snapshot.location.thingId)
        return fail("Placed Thing is not on the party page");
      const page = room.snapshot.instances[command.instance.pageId] ?? {};
      const existing = page[command.instance.placementId];
      if (existing && existing.targetId !== command.instance.targetId)
        return fail("Placed Thing target cannot change");
      page[command.instance.placementId] = command.instance;
      room.snapshot.instances[command.instance.pageId] = page;
    } else if (command.type === "instance-reset") {
      if (!host) return fail("Only the host can reset placed Things");
      if (command.pageId !== room.snapshot.location.thingId)
        return fail("Placed Thing is not on the party page");
      delete room.snapshot.instances[command.pageId]?.[command.placementId];
    } else {
      const thingId = command.thingId,
        board = room.snapshot.boards[thingId] ?? {
          thingId,
          revision: 0,
          enabled: false,
          drawing: { version: 1, strokes: [] },
        };
      if (command.boardRevision !== board.revision) {
        this.send(ws, {
          type: "error",
          operationId: command.operationId,
          code: "stale-board",
          message: "Drawing changed; retry",
        });
        return;
      }
      if (command.type === "drawing-enable") {
        if (!host) return fail("Only the host can enable drawing");
        board.enabled = command.enabled;
      } else if (command.type === "drawing-clear") {
        if (!host) return fail("Only the host can clear drawing");
        board.drawing = { version: 1, strokes: [] };
      } else if (command.type === "drawing-stroke") {
        if (!board.enabled) return fail("Drawing is disabled");
        if (
          board.drawing.strokes.length >= 300 ||
          board.drawing.strokes.reduce((n, s) => n + s.points.length, 0) +
            command.stroke.points.length >
            30000
        )
          return fail("Drawing limit reached");
        command.stroke.authorId = actorId;
        board.drawing.strokes.push(command.stroke);
      } else if (command.type === "drawing-erase") {
        const stroke = board.drawing.strokes.find(
          (s) => s.id === command.strokeId,
        );
        if (!stroke || (!host && stroke.authorId !== actorId))
          return fail("You cannot erase that stroke");
        board.drawing.strokes = board.drawing.strokes.filter(
          (s) => s.id !== command.strokeId,
        );
      }
      board.revision++;
      room.snapshot.boards[thingId] = board;
    }
    room.operations.push(command.operationId);
    room.operations = room.operations.slice(-500);
    room.snapshot.revision++;
    await this.save(room);
    this.send(ws, {
      type: "ack",
      operationId: command.operationId,
      revision: room.snapshot.revision,
    });
    this.broadcast({ type: "snapshot", snapshot: room.snapshot });
  }
  async webSocketClose(ws: WebSocket) {
    const a = ws.deserializeAttachment() as Attachment,
      room = await this.load();
    if (!room) return;
    const p = room.snapshot.participants.find((x) => x.id === a.participantId);
    if (p) p.connected = false;
    const connected = room.snapshot.participants.filter((x) => x.connected);
    if (room.snapshot.hostId === a.participantId && connected.length)
      promoteLongestConnected(room.snapshot);
    room.snapshot.revision++;
    await this.save(room);
    this.broadcast({ type: "snapshot", snapshot: room.snapshot });
    if (!connected.length)
      await this.ctx.storage.setAlarm(Date.now() + ROOM_EMPTY_TTL_MS);
  }
  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws);
  }
  async alarm() {
    for (const ws of this.ctx.getWebSockets()) ws.close(1001, "Room expired");
    await this.ctx.storage.deleteAll();
  }
}
