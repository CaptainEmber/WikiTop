import type { PortableMedia, ThingDocument } from "@wikitop/shared";

export interface LocalThingDraft {
  rootId: string;
  name: string;
  updatedAt: number;
  document: ThingDocument;
}
const DB = "wikitop-portable-things", VERSION = 1;
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("drafts")) db.createObjectStore("drafts", { keyPath: "rootId" });
      if (!db.objectStoreNames.contains("media")) db.createObjectStore("media", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local storage"));
  });
}
function done(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Local storage failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Local storage was cancelled"));
  });
}
export async function listLocalDrafts(): Promise<LocalThingDraft[]> {
  const db = await database(), tx = db.transaction("drafts", "readonly"), request = tx.objectStore("drafts").getAll();
  const result = await new Promise<LocalThingDraft[]>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  db.close(); return result.sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function loadLocalDraft(rootId: string) {
  const db = await database(), tx = db.transaction(["drafts", "media"], "readonly");
  const draftRequest = tx.objectStore("drafts").get(rootId), mediaRequest = tx.objectStore("media").getAll(IDBKeyRange.bound(`${rootId}:`, `${rootId}:\uffff`));
  const draft = await new Promise<LocalThingDraft | undefined>((resolve, reject) => { draftRequest.onsuccess = () => resolve(draftRequest.result); draftRequest.onerror = () => reject(draftRequest.error); });
  const rows = await new Promise<any[]>((resolve, reject) => { mediaRequest.onsuccess = () => resolve(mediaRequest.result); mediaRequest.onerror = () => reject(mediaRequest.error); });
  await done(tx); db.close();
  if (!draft) return;
  return { draft, media: new Map<string, PortableMedia>(rows.map((row) => [row.id, { id: row.id, mimeType: row.mimeType, bytes: new Uint8Array(row.bytes) }])) };
}
export async function saveLocalDraft(document: ThingDocument, media: Map<string, PortableMedia>) {
  const db = await database(), tx = db.transaction(["drafts", "media"], "readwrite"), rootId = document.rootId;
  tx.objectStore("drafts").put({ rootId, name: document.nodes[rootId].name, updatedAt: Date.now(), document: structuredClone(document) } satisfies LocalThingDraft);
  const store = tx.objectStore("media"), range = IDBKeyRange.bound(`${rootId}:`, `${rootId}:\uffff`);
  await new Promise<void>((resolve, reject) => { const request = store.openCursor(range); request.onsuccess = () => { const cursor = request.result; if (!cursor) return resolve(); cursor.delete(); cursor.continue(); }; request.onerror = () => reject(request.error); });
  for (const item of media.values()) store.put({ key: `${rootId}:${item.id}`, id: item.id, mimeType: item.mimeType, bytes: item.bytes.slice().buffer });
  await done(tx); db.close();
}
export async function deleteLocalDraft(rootId: string) {
  const db = await database(), tx = db.transaction(["drafts", "media"], "readwrite"); tx.objectStore("drafts").delete(rootId);
  const store = tx.objectStore("media"), range = IDBKeyRange.bound(`${rootId}:`, `${rootId}:\uffff`);
  await new Promise<void>((resolve, reject) => { const request = store.openCursor(range); request.onsuccess = () => { const cursor = request.result; if (!cursor) return resolve(); cursor.delete(); cursor.continue(); }; request.onerror = () => reject(request.error); });
  await done(tx); db.close();
}
