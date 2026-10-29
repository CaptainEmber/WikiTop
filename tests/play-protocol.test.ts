import { describe, expect, it } from "vitest";
import { PlayCommandSchema, PlayRoomSnapshotSchema, promoteLongestConnected } from "@wikitop/play-protocol";
const character={id:"mara",name:"Mara",description:"",revision:"one",graphIds:["mara","bag"]};
const participant=(id:string,joinedAt:number,role:"host"|"player"="player")=>({id,name:id,role,connected:true,joinedAt,character,reconnectUntil:9999999999999,position:[0,0,0] as [number,number,number]});
const snapshot=()=>PlayRoomSnapshotSchema.parse({id:"room",revision:0,hostId:"host",worldOwnerId:"host",location:{thingId:"tavern",source:"published"},world:{repository:"CaptainEmber/WikiTop",commit:"abc",rawBase:"https://raw.githubusercontent.com/CaptainEmber/WikiTop/abc/"},participants:[participant("host",1,"host"),participant("early",2),participant("late",3)],boards:{},createdAt:1});
describe("play protocol",()=>{
  it("validates revisioned movement and drawing commands",()=>{expect(PlayCommandSchema.parse({type:"move",operationId:"op",revision:2,participantId:"mara",position:[1,2,0]}).type).toBe("move");expect(()=>PlayCommandSchema.parse({type:"move",operationId:"op",revision:2,participantId:"mara",position:[Infinity,2,0]})).toThrow();expect(()=>PlayCommandSchema.parse({type:"thing-chunk",requestId:"request",targetId:"player",thingId:"mara",index:0,total:1,byteLength:1,sha256:"bad",data:"AA=="})).toThrow();});
  it("promotes the longest-connected participant",()=>{const room=snapshot();room.participants[0].connected=false;expect(promoteLongestConnected(room)).toBe("early");expect(room.hostId).toBe("early");expect(room.participants.find(p=>p.id==="early")?.role).toBe("host");expect(room.participants.find(p=>p.id==="host")?.role).toBe("player");});
  it("limits snapshots to ten participants",()=>{const room=snapshot() as any;room.participants=Array.from({length:11},(_,i)=>participant(`p${i}`,i));expect(PlayRoomSnapshotSchema.safeParse(room).success).toBe(false);});
});
