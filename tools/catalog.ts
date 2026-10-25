import { writePublicCatalog } from "./catalog-lib.js";
const catalog=await writePublicCatalog();
console.log(`Cataloged ${catalog.things.length} Things.`);
