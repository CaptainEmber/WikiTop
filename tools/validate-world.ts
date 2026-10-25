import { resolve } from "node:path";
import { buildCatalog } from "./catalog-lib.js";
const catalog=await buildCatalog(resolve(process.argv[2]??"world")),ids=new Set(catalog.things.map(t=>t.id));let failed=false,total=0;
for(const t of catalog.things){total+=t.byteLength;if(t.byteLength>25*1024*1024){console.error(`${t.path}: exceeds 25 MiB`);failed=true;}for(const link of t.links)if(!ids.has(link)){console.error(`${t.path}: missing target ${link}`);failed=true;}}
console.log(`${catalog.things.length} Things, ${(total/1024/1024).toFixed(2)} MiB.`);if(total>250*1024*1024)console.warn("World exceeds the recommended 250 MiB starter size.");if(failed)process.exitCode=1;
