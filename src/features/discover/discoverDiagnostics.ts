import { isAndroidApp } from "../../app/platform";
type Detail = { ms?: number; count?: number; total?: number; state?: string; attached?: number; loading?: number; failed?: number };
type Event = Detail & { at: number; stage: string };
let enabled=false, start=0, events: Event[] = [], timer: number | undefined;
export function discoverTrace(stage: string, detail: Detail = {}) {
  if(!enabled)return;
  events.push({at:Math.round(performance.now()-start),stage,...detail});
  if(events.length>2048)events.splice(0,256);
}
export function discoverImageTrace(img: HTMLImageElement) {
  if(!enabled)return;
  const entry=performance.getEntriesByName(img.currentSrc||img.src,"resource").at(-1) as PerformanceResourceTiming | undefined;
  discoverTrace("image-load",{...(entry?{ms:Math.round(entry.duration)}:{}),state:entry&&entry.responseStart>0?"resource-timing":"timing-unavailable"});
  const began=performance.now();
  void img.decode().then(()=>discoverTrace("image-decode",{ms:Math.round(performance.now()-began)}),()=>discoverTrace("image-decode",{state:"failed"}));
}
function sample() {
  const cards=Array.from(document.querySelectorAll(".discoverPage .discoverCover")).filter(el=>{
    const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth;
  });
  let count=0,attached=0,loading=0,failed=0;
  for(const card of cards){
    const img=card.querySelector("img");
    if(!img)continue;
    attached++;
    if(!img.complete)loading++;
    else if(img.naturalWidth>0)count++;
    else failed++;
  }
  discoverTrace("coverage",{total:cards.length,count,attached,loading,failed});
}
async function discoverDebug(action: "start"|"report"|"stop"|"reset" = "report") {
  if(action==="start"||action==="reset"){
    if(timer!==undefined)window.clearInterval(timer);
    events=[];start=performance.now();enabled=true;
    await window.localitfy.getDiscoveries({diagnostics:"start"}).catch(()=>null);
    sample();timer=window.setInterval(sample,1000);
  }else if(action==="stop"){
    sample();enabled=false;if(timer!==undefined)window.clearInterval(timer);timer=undefined;
  }
  const backend=await window.localitfy.getDiscoveries({diagnostics:action==="stop"?"stop":"report"}).catch(()=>null);
  return {enabled,renderer:events.slice(),backend:backend?.status==="diagnostics"?backend.events:[]};
}
if(import.meta.env.DEV && typeof window!=="undefined" && !isAndroidApp()) Object.assign(window,{discoverDebug});
