import { config } from "./config.js";
import { Assets } from "./assets.js";
const c = config();
if (!c.S3_ENDPOINT) throw new Error("Configure S3_ENDPOINT");
await new Assets(c).ensureBucket();
console.log("Private asset bucket is ready");
