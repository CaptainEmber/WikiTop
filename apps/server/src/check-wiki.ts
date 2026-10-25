import { config } from "./config.js";
import { RemoteWiki } from "./wiki.js";
await new RemoteWiki(config()).check();
console.log("Wiki.js page, group, and user API schema matches the adapter.");
