import type { TerminationMetadata } from "./termination-reasons";
/** Pass private HR notes only in memory to the same-origin termination tab. */
export function openTerminationTab(lockerId:string,date:string|null|undefined,metadata:TerminationMetadata) {
  const params=new URLSearchParams();
  if(date)params.set("date",date);
  const tab=window.open(`/terminate/${lockerId}?${params}`,"_blank");
  if(!tab)return;
  const receive=(event:MessageEvent)=>{
    if(event.origin!==window.location.origin || event.source!==tab || event.data?.type!=="termination-metadata-request" || event.data?.lockerId!==lockerId)return;
    tab.postMessage({type:"termination-metadata",lockerId,metadata},window.location.origin);
    window.removeEventListener("message",receive);
  };
  window.addEventListener("message",receive);
  window.setTimeout(()=>window.removeEventListener("message",receive),60_000);
}