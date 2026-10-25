import { THING_PACKAGE_MAX_BYTES, ThingDocumentSchema, type EmbeddedMedia, type MediaReference, type ThingDocument } from "./index.js";
import { validateGlb } from "./glb.js";

const JSON_CHUNK = 0x4e4f534a, BIN_CHUNK = 0x004e4942, MAGIC = 0x46546c67;
const pad4 = (n: number) => (n + 3) & ~3;
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((n) => n.toString(16).padStart(2, "0")).join("");
const digest = async (bytes: Uint8Array) => hex(await crypto.subtle.digest("SHA-256", bytes));
export const zUpToGltf = ([x, y, z]: [number, number, number]) => [x, z, -y] as [number, number, number];
export const gltfToZUp = ([x, y, z]: [number, number, number]) => [x, -z, y] as [number, number, number];
const mulQ = (a: number[], b: number[]) => [a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1], a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0], a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3], a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
const c = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2], ci = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
export const zUpQuaternionToGltf = (q: [number,number,number,number]) => mulQ(mulQ(c,q),ci) as [number,number,number,number];
export const gltfQuaternionToZUp = (q: [number,number,number,number]) => mulQ(mulQ(ci,q),c) as [number,number,number,number];

interface MediaManifest { id: string; mimeType: EmbeddedMedia["mimeType"]; byteLength: number; sha256: string; bufferView: number }
interface Manifest { format: "wikitop-thing"; version: 2; document: ThingDocument; media: MediaManifest[]; bindings: { root: number } }
export interface PortableThingImport { document: ThingDocument; media: Map<string, EmbeddedMedia>; generic: boolean; related: ThingDocument[] }
function validMime(mime: string, b: Uint8Array) {
  if (mime === "image/png") return b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  if (mime === "image/jpeg") return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (mime === "image/webp") return b.length >= 12 && new TextDecoder().decode(b.slice(0,4)) === "RIFF" && new TextDecoder().decode(b.slice(8,12)) === "WEBP";
  if (mime === "model/gltf-binary") return b.length >= 12 && new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(0,true) === MAGIC;
  return false;
}
function parse(input: ArrayBuffer) {
  if (input.byteLength < 20 || input.byteLength > THING_PACKAGE_MAX_BYTES) throw new Error("GLB must be between 20 bytes and 25 MiB");
  validateGlb(input); const view = new DataView(input); let at = 12, json: any, bin = new Uint8Array();
  while (at < input.byteLength) { const size = view.getUint32(at,true), type = view.getUint32(at+4,true); at += 8; if (size % 4 || at + size > input.byteLength) throw new Error("Invalid GLB chunk length"); if (type === JSON_CHUNK && !json) json = JSON.parse(new TextDecoder().decode(new Uint8Array(input,at,size)).trimEnd()); else if (type === BIN_CHUNK && !bin.length) bin = new Uint8Array(input,at,size); else throw new Error("Unsupported GLB chunks"); at += size; }
  if (!json || json.asset?.version !== "2.0") throw new Error("Invalid glTF JSON"); return { json, bin };
}
const references = (doc: ThingDocument) => [doc.thing.face.media.token, doc.thing.face.media.artwork, doc.thing.face.media.model, doc.thing.page.background].filter(Boolean) as MediaReference[];
export async function exportThingGlb(input: ThingDocument, media: Map<string, EmbeddedMedia>) {
  const document = ThingDocumentSchema.parse(structuredClone(input)), wanted = new Set<string>();
  for (const ref of references(document)) { if (ref.kind !== "embedded") throw new Error("Export requires every media reference to be embedded"); wanted.add(ref.mediaId); }
  const chunks: Uint8Array[] = [], bufferViews: any[] = [], manifestMedia: MediaManifest[] = []; let cursor = 0;
  const append = (bytes: Uint8Array, target?: number) => { const start = cursor; chunks.push(bytes); cursor += bytes.length; const padding = pad4(cursor)-cursor; if (padding) { chunks.push(new Uint8Array(padding)); cursor += padding; } bufferViews.push({ buffer:0, byteOffset:start, byteLength:bytes.length, ...(target ? {target}: {}) }); return bufferViews.length-1; };
  for (const id of [...wanted].sort()) { const item = media.get(id); if (!item) throw new Error(`Missing embedded media ${id}`); if (!validMime(item.mimeType,item.bytes)) throw new Error(`Media ${id} does not match ${item.mimeType}`); if (item.mimeType === "model/gltf-binary") validateGlb(item.bytes.buffer.slice(item.bytes.byteOffset,item.bytes.byteOffset+item.bytes.byteLength)); manifestMedia.push({ id, mimeType:item.mimeType, byteLength:item.bytes.length, sha256:await digest(item.bytes), bufferView:append(item.bytes) }); }
  const positions = new Float32Array([0,1,0,-.7,0,0,0,0,.7,.7,0,0,0,0,-.7,0,-1,0]), indices = new Uint16Array([0,1,2,0,2,3,0,3,4,0,4,1,5,2,1,5,3,2,5,4,3,5,1,4]);
  const posView=append(new Uint8Array(positions.buffer),34962), idxView=append(new Uint8Array(indices.buffer),34963);
  const gltf:any={asset:{version:"2.0",generator:"WikiTop",extras:{}},scene:0,scenes:[{name:document.thing.name,nodes:[0]}],nodes:[{name:document.thing.name,mesh:0,extras:{WikiTopThingId:document.thing.id}}],meshes:[{name:"Thing preview",primitives:[{attributes:{POSITION:0},indices:1,material:0}]}],materials:[{name:"WikiTop Thing",pbrMetallicRoughness:{baseColorFactor:[.25,.68,.58,1],metallicFactor:0,roughnessFactor:.8}}],accessors:[{bufferView:posView,componentType:5126,count:6,type:"VEC3",min:[-.7,-1,-.7],max:[.7,1,.7]},{bufferView:idxView,componentType:5123,count:indices.length,type:"SCALAR",min:[0],max:[5]}],bufferViews,buffers:[{byteLength:cursor}]};
  gltf.asset.extras.WikiTop={format:"wikitop-thing",version:2,document,media:manifestMedia,bindings:{root:0}} satisfies Manifest;
  const raw=new TextEncoder().encode(JSON.stringify(gltf)), jsonLength=pad4(raw.length), total=12+8+jsonLength+(cursor?8+cursor:0); if(total>THING_PACKAGE_MAX_BYTES) throw new Error("Thing exceeds 25 MiB");
  const out=new ArrayBuffer(total), v=new DataView(out), bytes=new Uint8Array(out); v.setUint32(0,MAGIC,true);v.setUint32(4,2,true);v.setUint32(8,total,true);v.setUint32(12,jsonLength,true);v.setUint32(16,JSON_CHUNK,true);bytes.set(raw,20);bytes.fill(0x20,20+raw.length,20+jsonLength); if(cursor){const start=20+jsonLength;v.setUint32(start,cursor,true);v.setUint32(start+4,BIN_CHUNK,true);let write=start+8;for(const chunk of chunks){bytes.set(chunk,write);write+=chunk.length;}} return out;
}
function legacyNodeToDocument(node:any, placements:any[]):ThingDocument { const media=node.media??{}; return ThingDocumentSchema.parse({schemaVersion:2,thing:{id:node.id,name:node.name,description:node.description??"",tags:node.tags,kind:node.character?"character":node.role==="inventory"?"item":"other",face:{visual:node.visual,media:{token:media.token,artwork:media.artwork,model:media.model}},page:{width:node.space?.width??20,depth:node.space?.depth??16,background:media.background,drawing:node.space?.drawing,zones:node.space?.zones??[],doors:node.space?.doors??[],anchors:node.space?.anchors??[{id:"entrance",name:"Entrance",position:[0,0,0]}],placements:placements.map((p)=>({id:`placement_${p.childId}`,targetId:p.childId,position:p.position,rotation:p.rotation,scale:p.scale}))}}}); }
export function splitLegacyThing(raw:any):ThingDocument[] { const doc=raw?.document??raw; if(doc?.schemaVersion!==1||!doc.nodes||!Array.isArray(doc.placements)) throw new Error("Invalid legacy Thing document"); return Object.values(doc.nodes).map((node:any)=>legacyNodeToDocument(node,doc.placements.filter((p:any)=>p.parentId===node.id))); }
export async function importThingGlb(input:ArrayBuffer,filename="Imported Thing.glb"):Promise<PortableThingImport>{ const {json,bin}=parse(input),raw=json.asset?.extras?.WikiTop; if(!raw){ if(input.byteLength>10*1024*1024)throw new Error("A model imported as one Thing must be at most 10 MiB"); const id=`thing_${crypto.randomUUID()}`,mediaId=`media_${crypto.randomUUID()}`,document=ThingDocumentSchema.parse({schemaVersion:2,thing:{id,name:filename.replace(/\.glb$/i,"")||"Imported Thing",description:"",kind:"object",face:{visual:{mode:"model",width:1.5,height:1.5,anchor:[.5,.5],footprint:[1,1]},media:{model:{kind:"embedded",mediaId,type:"model",mimeType:"model/gltf-binary"}}},page:{width:20,depth:16,zones:[],doors:[],anchors:[{id:"entrance",name:"Entrance",position:[0,0,0]}],placements:[]}}});return{document,media:new Map([[mediaId,{id:mediaId,mimeType:"model/gltf-binary",bytes:new Uint8Array(input.slice(0))}]]),generic:true,related:[]}; }
  if(raw.format!=="wikitop-thing"||![1,2].includes(raw.version))throw new Error("Unsupported WikiTop Thing package version"); const docs=raw.version===1?splitLegacyThing(raw):[ThingDocumentSchema.parse(raw.document)],document=docs.find((d)=>d.thing.id===(raw.document.rootId??raw.document.thing?.id))??docs[0],media=new Map<string,EmbeddedMedia>(); if(!Array.isArray(raw.media)||raw.media.length>2048)throw new Error("Invalid media manifest");
  for(const item of raw.media as MediaManifest[]){const view=json.bufferViews?.[item.bufferView],start=view?.byteOffset??0,end=start+(view?.byteLength??-1);if(!view||view.buffer!==0||view.byteLength!==item.byteLength||start<0||end>bin.length)throw new Error(`Invalid buffer view for ${item.id}`);const bytes=bin.slice(start,end);if(!validMime(item.mimeType,bytes)||await digest(bytes)!==item.sha256)throw new Error(`Media ${item.id} failed validation`);if(media.has(item.id))throw new Error(`Duplicate media ${item.id}`);media.set(item.id,{id:item.id,mimeType:item.mimeType,bytes});}
  for(const doc of docs)for(const ref of references(doc))if(ref.kind==="embedded"&&!media.has(ref.mediaId))throw new Error(`Missing embedded media ${ref.mediaId}`);return{document,media,generic:false,related:docs.filter((d)=>d!==document)};
}
