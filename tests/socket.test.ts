import { describe, it, expect } from "vitest";
import { io, type Socket } from "socket.io-client";
import { buildApp } from "../apps/server/src/app";
import { MemoryStore } from "../apps/server/src/store";
import { MemoryWiki } from "../apps/server/src/wiki";
import { World } from "../apps/server/src/world";
import { config } from "../apps/server/src/config";
import { seedDemo } from "../apps/server/src/demo";
const enabled = process.env.RUN_SOCKET_TESTS === "true";
function ack(socket: Socket, event: string, payload: unknown): Promise<any> {
  return new Promise((resolve, reject) =>
    socket
      .timeout(5000)
      .emit(event, payload, (error: any, result: any) =>
        error ? reject(error) : resolve(result),
      ),
  );
}
describe.skipIf(!enabled)("live socket integration", () => {
  it("keeps ten identities synchronized, reconnects, and revokes removed members", async () => {
    const store = new MemoryStore(),
      wiki = new MemoryWiki(),
      world = new World(store, wiki);
    await seedDemo(world);
    let state = await store.read();
    const session = Object.values(state.sessions)[0];
    await store.transaction((s) => {
      for (let i = 3; i < 10; i++) {
        const id = `player_${i}`;
        s.accounts[id] = {
          id,
          issuer: "dev",
          subject: id,
          name: id,
          email: `${id}@example.test`,
        };
      }
    });
    for (const account of Object.values((await store.read()).accounts)) {
      if (!session.memberIds.includes(account.id))
        await world.invitePlayer("mara", session.id, account.id);
      if (
        !Object.values((await store.read()).characters).some(
          (c) => c.ownerId === account.id,
        )
      )
        await world.createCharacter(account.id, account.name, "sample_token");
    }
    state = await store.read();
    const actors = Object.values(state.accounts);
    for (const actor of actors) {
      const character = Object.values(state.characters).find(
        (c) => c.ownerId === actor.id,
      )!;
      await world.join(actor.id, session.id, character.id);
    }
    const server = await buildApp(
      config({
        NODE_ENV: "test",
        DEV_AUTH: "true",
        APP_URL: "http://127.0.0.1:3109",
      }),
      store,
      world,
    );
    await server.app.listen({ host: "127.0.0.1", port: 0 });
    const address = server.app.server.address() as { port: number };
    const sockets: Socket[] = [],
      snapshots: any[] = [];
    try {
      for (const [i, actor] of actors.entries()) {
        const login = await server.app.inject({
          method: "POST",
          url: "/auth/dev",
          headers: { origin: "http://127.0.0.1:3109" },
          payload: { accountId: actor.id },
        });
        const cookie = login.cookies
          .map((c) => `${c.name}=${c.value}`)
          .join("; ");
        const socket = io(`http://127.0.0.1:${address.port}`, {
          transports: ["websocket"],
          extraHeaders: { Origin: "http://127.0.0.1:3109", Cookie: cookie },
          autoConnect: false,
        });
        sockets.push(socket);
        await new Promise<void>((resolve, reject) => {
          socket.once("connect", resolve);
          socket.once("connect_error", reject);
          socket.connect();
        });
        socket.on("snapshot", (s) => {
          snapshots[i] = s;
        });
        const character = Object.values(state.characters).find(
          (c) => c.ownerId === actor.id,
        )!;
        const result = await ack(socket, "subscribe", {
          sessionId: session.id,
          characterId: character.id,
        });
        expect(result.ok).toBe(true);
        snapshots[i] = result.snapshot;
      }
      wiki.available = false;
      const commands = actors.map((actor, i) => ({
        type: "move",
        operationId: `load_${i}`,
        sessionId: session.id,
        characterId: Object.values(state.characters).find(
          (c) => c.ownerId === actor.id,
        )!.id,
        revision: 0,
        position: [i - 5, -2, 0],
      }));
      const results = await Promise.all(
        sockets.map((socket, i) => ack(socket, "command", commands[i])),
      );
      expect(results.every((r) => r.ok)).toBe(true);
      await expect
        .poll(() =>
          snapshots.every(
            (s) =>
              s.occupants.length === 10 &&
              s.occupants.every((o: any) => o.placement.revision === 1),
          ),
        )
        .toBe(true);
      sockets[1].disconnect();
      await new Promise<void>((resolve, reject) => {
        sockets[1].once("connect", resolve);
        sockets[1].once("connect_error", reject);
        sockets[1].connect();
      });
      const reconnected = await ack(sockets[1], "subscribe", {
        sessionId: session.id,
        characterId: commands[1].characterId,
      });
      expect(reconnected.snapshot.placement.revision).toBe(1);
      const removed = actors.findIndex((a) => a.id === "rowan");
      const revoked = new Promise<void>((resolve) =>
        sockets[removed].once("revoked", () => resolve()),
      );
      await world.removePlayer("mara", session.id, "rowan");
      await server.dispatch();
      await revoked;
      expect(sockets[removed].connected).toBe(false);
    } finally {
      for (const socket of sockets) socket.disconnect();
      await server.app.close();
    }
  }, 30000);
});
