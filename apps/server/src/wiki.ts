import type { Account, AreaScene } from "@wikitop/shared";
import type { Config } from "./config.js";
import { DomainError, requireThat } from "./errors.js";
export interface WikiPage {
  id: number;
  content: string;
  path: string;
  updatedAt: string;
  title?: string;
  description?: string;
  tags?: { tag: string }[];
}
export interface Wiki {
  read(id: number): Promise<WikiPage>;
  createArea(
    id: string,
    name: string,
    account: Account,
    scene: AreaScene,
  ): Promise<{ articleId: number; scenePageId: number }>;
  writeScene(id: number, scene: AreaScene): Promise<void>;
  writeArticle(id: number, content: string): Promise<void>;
  url(id: number, path: string): string;
  check(): Promise<void>;
}
export class MemoryWiki implements Wiki {
  pages = new Map<number, WikiPage>();
  nextId = 1;
  available = true;
  private ready() {
    if (!this.available)
      throw new DomainError("wiki_unavailable", "Wiki is unavailable", 503);
  }
  async read(id: number) {
    this.ready();
    const p = this.pages.get(id);
    requireThat(p, "wiki_missing", "Wiki page not found", 404);
    return structuredClone(p);
  }
  async createArea(
    id: string,
    name: string,
    account: Account,
    scene: AreaScene,
  ) {
    this.ready();
    const articleId = this.nextId++,
      scenePageId = this.nextId++;
    this.pages.set(articleId, {
      id: articleId,
      content: `# ${name}\n\nA place waiting for stories.`,
      path: `wikitop/articles/${account.id}/${id}`,
      updatedAt: new Date().toISOString(),
    });
    this.pages.set(scenePageId, {
      id: scenePageId,
      content: JSON.stringify(scene),
      path: `wikitop/scenes/${id}`,
      updatedAt: new Date().toISOString(),
    });
    return { articleId, scenePageId };
  }
  async writeScene(id: number, scene: AreaScene) {
    const p = await this.read(id);
    this.pages.set(id, {
      ...p,
      content: JSON.stringify(scene),
      updatedAt: new Date().toISOString(),
    });
  }
  async writeArticle(id: number, content: string) {
    const page = await this.read(id);
    this.pages.set(id, {
      ...page,
      content,
      updatedAt: new Date().toISOString(),
    });
  }
  url(id: number, path?: string) {
    return `/api/dev/wiki/${id}`;
  }
  async check() {
    this.ready();
  }
}
export class RemoteWiki implements Wiki {
  constructor(private config: Config) {}
  async query(query: string, variables: Record<string, unknown> = {}) {
    try {
      const response = await fetch(
        `${this.config.WIKI_INTERNAL_URL ?? this.config.WIKI_URL}/graphql`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.config.WIKI_API_KEY}`,
          },
          body: JSON.stringify({ query, variables }),
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = (await response.json()) as any;
      if (result.errors?.length)
        throw new Error(result.errors.map((e: any) => e.message).join("; "));
      return result.data;
    } catch (error) {
      throw new DomainError(
        "wiki_unavailable",
        `Wiki integration failed: ${error instanceof Error ? error.message : "request failed"}`,
        503,
      );
    }
  }
  private outcome(result: any) {
    requireThat(
      result?.responseResult?.succeeded,
      "wiki_rejected",
      result?.responseResult?.message ?? "Wiki rejected the request",
      502,
    );
    return result;
  }
  async check() {
    const data = await this.query(
      `query { pagesType:__type(name:"PageQuery"){fields{name}} mutations:__type(name:"PageMutation"){fields{name}} groupsType:__type(name:"GroupMutation"){fields{name}} usersType:__type(name:"UserQuery"){fields{name}} }`,
    );
    for (const [key, names] of Object.entries({
      pagesType: ["single", "singleByPath"],
      mutations: ["create", "update"],
      groupsType: ["create", "update", "assignUser"],
      usersType: ["list"],
    }))
      requireThat(
        names.every((n) => data[key]?.fields?.some((f: any) => f.name === n)),
        "wiki_schema_mismatch",
        "Wiki.js 2.x schema is required; run the pinned image",
        503,
      );
  }
  async read(id: number) {
    const data = await this.query(
      "query($id:Int!){pages{single(id:$id){id content path updatedAt title description tags{tag}}}}",
      { id },
    );
    requireThat(data.pages.single, "wiki_missing", "Wiki page not found", 404);
    return data.pages.single as WikiPage;
  }
  async ensureAuthor(account: Account) {
    const users = (
      await this.query(
        "query($filter:String){users{list(filter:$filter){id email providerKey isActive}}}",
        { filter: account.email },
      )
    ).users.list;
    const user = users.find(
      (u: any) =>
        u.email.toLowerCase() === account.email.toLowerCase() &&
        u.providerKey === this.config.WIKI_AUTH_PROVIDER_KEY &&
        u.isActive,
    );
    requireThat(
      user,
      "wiki_account_required",
      "Sign into the wiki with your shared account once, then retry. The administrator must configure WIKI_AUTH_PROVIDER_KEY.",
      409,
    );
    const groupName = `WikiTop author ${account.id}`;
    let group = (
      await this.query(
        "query($filter:String){groups{list(filter:$filter){id name}}}",
        { filter: groupName },
      )
    ).groups.list.find((g: any) => g.name === groupName);
    if (!group)
      group = this.outcome(
        (
          await this.query(
            "mutation($name:String!){groups{create(name:$name){responseResult{succeeded message}group{id}}}}",
            { name: groupName },
          )
        ).groups.create,
      ).group;
    const pageRules = [
      {
        id: `read-${account.id}`,
        deny: false,
        match: "START",
        roles: ["read:pages", "read:source", "read:history"],
        path: "wikitop",
        locales: ["en"],
      },
      {
        id: `write-${account.id}`,
        deny: false,
        match: "START",
        roles: ["write:pages"],
        path: `wikitop/articles/${account.id}/`,
        locales: ["en"],
      },
    ];
    this.outcome(
      (
        await this.query(
          'mutation($id:Int!,$name:String!,$permissions:[String]!,$rules:[PageRuleInput]!){groups{update(id:$id,name:$name,redirectOnLogin:"",permissions:$permissions,pageRules:$rules){responseResult{succeeded message}}}}',
          {
            id: group.id,
            name: groupName,
            permissions: [
              "read:pages",
              "read:source",
              "read:history",
              "write:pages",
            ],
            rules: pageRules,
          },
        )
      ).groups.update,
    );
    const membership = (
      await this.query("query($id:Int!){groups{single(id:$id){users{id}}}}", {
        id: group.id,
      })
    ).groups.single;
    if (!membership.users.some((u: { id: number }) => u.id === user.id)) {
      this.outcome(
        (
          await this.query(
            "mutation($groupId:Int!,$userId:Int!){groups{assignUser(groupId:$groupId,userId:$userId){responseResult{succeeded message}}}}",
            { groupId: group.id, userId: user.id },
          )
        ).groups.assignUser,
      );
    }
    account.wikiUserId = user.id;
    account.wikiGroupId = group.id;
  }
  private async create(path: string, title: string, content: string) {
    let existing: { id: number } | undefined;
    try {
      existing = (
        await this.query(
          'query($path:String!){pages{singleByPath(path:$path,locale:"en"){id}}}',
          { path },
        )
      ).pages.singleByPath;
    } catch (error) {
      // Wiki.js 2.x reports a missing page as a GraphQL error rather than null.
      if (
        !(error instanceof DomainError) ||
        error.message !== "Wiki integration failed: This page does not exist."
      )
        throw error;
    }
    if (existing) return existing.id as number;
    return this.outcome(
      (
        await this.query(
          'mutation($path:String!,$title:String!,$content:String!){pages{create(path:$path,title:$title,content:$content,description:"WikiTop authored content",editor:"markdown",isPublished:true,isPrivate:false,locale:"en",tags:["wikitop"]){responseResult{succeeded message}page{id}}}}',
          { path, title, content },
        )
      ).pages.create,
    ).page.id as number;
  }
  async createArea(
    id: string,
    name: string,
    account: Account,
    scene: AreaScene,
  ) {
    await this.ensureAuthor(account);
    const articleId = await this.create(
      `wikitop/articles/${account.id}/${id}`,
      name,
      `# ${name}\n\nA place waiting for stories.`,
    );
    const scenePageId = await this.create(
      `wikitop/scenes/${id}`,
      `${name} scene definition`,
      "```json\n" + JSON.stringify(scene, null, 2) + "\n```",
    );
    return { articleId, scenePageId };
  }
  async writeArticle(id: number, content: string) {
    const page = await this.read(id);
    this.outcome(
      (
        await this.query(
          "mutation($id:Int!,$content:String!,$title:String!,$description:String!,$tags:[String]!){pages{update(id:$id,content:$content,title:$title,description:$description,tags:$tags,isPublished:true){responseResult{succeeded message}page{id}}}}",
          {
            id,
            content: content,
            title: page.title ?? "Scene definition",
            description: page.description ?? "",
            tags: page.tags?.map((t) => t.tag) ?? ["wikitop"],
          },
        )
      ).pages.update,
    );
  }
  async writeScene(id: number, scene: AreaScene) {
    await this.writeArticle(
      id,
      "```json\n" + JSON.stringify(scene, null, 2) + "\n```",
    );
  }
  url(id: number, path?: string) {
    return `${this.config.WIKI_URL}/${path}`;
  }
}
