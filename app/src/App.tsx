import { useEffect, useState } from "react";
import EditorApp from "./EditorApp";
import PlayApp from "./PlayApp";
type Section="world"|"things"|"play";
const current=():Section=>location.hash.startsWith("#/play")?"play":location.hash==="#/things"?"things":"world";
export default function App(){const[section,setSection]=useState<Section>(current());useEffect(()=>{const update=()=>setSection(current());addEventListener("hashchange",update);return()=>removeEventListener("hashchange",update);},[]);const go=(value:Section)=>{location.hash=value==="world"?"#/world":`#/${value}`;setSection(value);};return <><nav className="top-tabs" aria-label="Main navigation"><button className={section==="world"?"active":""} onClick={()=>go("world")}>World</button><button className={section==="things"?"active":""} onClick={()=>go("things")}>My Things</button><button className={section==="play"?"active":""} onClick={()=>go("play")}>Play</button></nav><div className="with-top-tabs" key={section}>{section==="play"?<PlayApp/>:<EditorApp homeMode={section}/>}</div></>}
