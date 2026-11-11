// © 2026 Farid Asnawi. All rights reserved. Proprietary. See LICENSE.
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from "@/components/ui/select";
import { REASON_CATEGORIES,reasonClash,type TerminationMetadata,type TerminationType } from "@/lib/termination-reasons";
export function TerminationMetadataFields({value,onChange,id}:{value:TerminationMetadata;onChange:(v:TerminationMetadata)=>void;id:string}) {
 return <>
  <div><Label htmlFor={`${id}-type`}>Termination type{value.reason_code==="OTHER"?" *":""}</Label><Select value={value.termination_type??"none"} onValueChange={v=>onChange({...value,termination_type:v==="none"?null:v as TerminationType})}><SelectTrigger id={`${id}-type`}><SelectValue placeholder="Select type"/></SelectTrigger><SelectContent><SelectItem value="none">Not selected</SelectItem><SelectItem value="Voluntary">Voluntary</SelectItem><SelectItem value="Involuntary">Involuntary</SelectItem></SelectContent></Select></div>
  <div><Label htmlFor={`${id}-category`}>Category</Label><Select value={value.reason_category??"none"} onValueChange={v=>onChange({...value,reason_category:v==="none"?null:v})}><SelectTrigger id={`${id}-category`}><SelectValue/></SelectTrigger><SelectContent><SelectItem value="none">Not selected</SelectItem>{REASON_CATEGORIES.map(c=><SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
  {value.reason_code==="OTHER"&&<div><Label htmlFor={`${id}-note`}>Note (optional)</Label><Input id={`${id}-note`} maxLength={500} value={value.reason_detail??""} onChange={e=>onChange({...value,reason_detail:e.target.value})}/></div>}
  {reasonClash(value.termination_type,value.reason_code)&&<p className="text-xs text-warning">Type and Reason clash</p>}
 </>;
}