import { mkdir, writeFile } from "node:fs/promises";
import { exportThingGlb, ThingDocumentSchema, type ThingDocument } from "@wikitop/thing-format";
const make=(id:string,name:string,kind:string,description:string,tags:string[],placements:any[]=[]):ThingDocument=>ThingDocumentSchema.parse({schemaVersion:2,thing:{id,name,kind,description,tags,face:{media:{}},page:{width:id==="emberheart-tavern"?24:12,depth:id==="emberheart-tavern"?18:10,zones:id==="emberheart-tavern"?[{id:"hearth",name:"Hearth",x:4,y:2,width:6,depth:5,priority:1},{id:"bar",name:"Bar",x:-6,y:4,width:8,depth:3,priority:1}]:[],doors:[],anchors:[{id:"entrance",name:"Entrance",position:[0,-4,0]}],placements}}});
const at=(id:string,targetId:string,x:number,y:number,name?:string)=>({id,targetId,name,position:[x,y,0],rotation:[0,0,0,1],scale:[1,1,1]});
const docs=[
 make("emberheart-tavern","Emberheart Tavern","place","A warm public house where stories and worlds meet.",["setting","tavern"],[at("stairs","emberheart-basement",7,5,"Stairs to Basement"),at("guest","example-character",0,0,"A traveler")]),
 make("emberheart-basement","Emberheart Basement","place","A cool stone room beneath the tavern.",["setting","room"],[at("stairs-up","emberheart-tavern",-4,-3,"Stairs to Tavern"),at("stored-bag","example-backpack",2,1)]),
 make("example-character","Mara the Wayfarer","character","A reusable example character with visible equipment.",["character","example"],[at("worn-bag","example-backpack",2,0),at("held-sword","example-sword",-2,0)]),
 make("example-backpack","Traveler's Backpack","item","A backpack is a Thing page whose face can be placed on a character.",["item","container"],[at("packed-sword","example-sword",0,0)]),
 make("example-sword","Plain Sword","item","A practical sword and a small example Thing.",["item","weapon"]),
];
await mkdir("world/starter",{recursive:true});for(const d of docs)await writeFile(`world/starter/${d.thing.id}.glb`,new Uint8Array(await exportThingGlb(d,new Map())));console.log(`Wrote ${docs.length} CC0 starter Things.`);
