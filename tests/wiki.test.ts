import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { RemoteWiki } from "../apps/server/src/wiki";
import { MemoryStore } from "../apps/server/src/store";
import { World } from "../apps/server/src/world";
import { config } from "../apps/server/src/config";
import { emptyScene } from "../packages/shared/src/index";
const enabled = !!process.env.WIKI_TEST_URL && !!process.env.WIKI_TEST_API_KEY;
describe.skipIf(!enabled)("pinned Wiki.js integration", () => {
  it("stores scenes, publishes source, and enforces native wiki author permissions", async () => {
    const c = config({
        NODE_ENV: "test",
        WIKI_URL: process.env.WIKI_TEST_URL,
        WIKI_API_KEY: process.env.WIKI_TEST_API_KEY,
        WIKI_AUTH_PROVIDER_KEY: "local",
      }),
      wiki = new RemoteWiki(c);
    await wiki.check();
    const suffix = randomUUID(),
      password = randomUUID() + "Aa!";
    const accounts = ["one", "two"].map((n) => ({
      id: `integration_${n}_${suffix}`,
      issuer: "test",
      subject: n,
      email: `${n}-${suffix}@example.test`,
      name: `Integration ${n}`,
    }));
    for (const a of accounts) {
      const result = (
        await wiki.query(
          'mutation($email:String!,$name:String!,$password:String!){users{create(email:$email,name:$name,passwordRaw:$password,providerKey:"local",groups:[],sendWelcomeEmail:false){responseResult{succeeded message}user{id}}}}',
          { email: a.email, name: a.name, password },
        )
      ).users.create;
      expect(
        result.responseResult.succeeded,
        result.responseResult.message,
      ).toBe(true);
    }
    const store = new MemoryStore();
    await store.transaction((s) => {
      for (const a of accounts) s.accounts[a.id] = a;
    });
    const world = new World(store, wiki),
      area = await world.createArea(accounts[0].id, "Integration area"),
      other = await world.createArea(accounts[1].id, "Other author area");
    const draft = await world.draft(accounts[0].id, area.id);
    expect(draft.scene).toEqual(emptyScene());
    await world.saveScene(accounts[0].id, area.id, 0, {
      ...draft.scene,
      doors: [{ id: "door", name: "A door", position: [1, 0, 0] }],
    });
    const publication = await world.publish(accounts[0].id, area.id);
    expect(publication.scene.revision).toBe(1);
    expect(publication.article).toContain("Integration area");
    async function userGraph(
      query: string,
      variables: Record<string, unknown>,
      token?: string,
    ) {
      const response = await fetch(`${c.WIKI_URL}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ query, variables }),
      });
      return response.json() as Promise<any>;
    }
    const auth = (
      await userGraph(
        'mutation($email:String!,$password:String!){authentication{login(username:$email,password:$password,strategy:"local"){jwt responseResult{succeeded message}}}}',
        { email: accounts[0].email, password },
      )
    ).data.authentication.login;
    expect(auth.responseResult.succeeded, auth.responseResult.message).toBe(
      true,
    );
    const write =
      'mutation($id:Int!){pages{update(id:$id,content:"Updated through native wiki permissions",tags:["wikitop"],isPublished:true){responseResult{succeeded message}}}}';
    const own = await userGraph(write, { id: area.articleId }, auth.jwt);
    expect(
      own.data?.pages.update.responseResult.succeeded,
      JSON.stringify(own),
    ).toBe(true);
    for (const pageId of [area.scenePageId, other.articleId]) {
      const forbidden = await userGraph(write, { id: pageId }, auth.jwt);
      expect(
        forbidden.errors?.length > 0 ||
          forbidden.data?.pages.update.responseResult.succeeded === false,
        JSON.stringify(forbidden),
      ).toBe(true);
    }
    // Wiki.js's single-page management API requires manage:pages even for reads.
    // Ordinary draft browsing uses its normal page route with read:pages.
    const otherPage = await wiki.read(other.articleId);
    const read = await fetch(`${c.WIKI_URL}/${otherPage.path}`, {
      headers: {
        Authorization: `Bearer ${auth.jwt}`,
        Cookie: `jwt=${auth.jwt}`,
      },
    });
    expect(read.status).toBe(200);
    expect(await read.text()).toContain("Other author area");
  }, 60000);
});
