import { Badge } from "@/components/ui/badge";
import { Tooltip,TooltipContent,TooltipTrigger,TooltipProvider } from "@/components/ui/tooltip";
export function TerminationReasonBadge({code,type,category}:{code?:string|null;type?:string|null;category?:string|null}) {
 if (!code) return <span className="text-muted-foreground">—</span>;
 return <TooltipProvider><Tooltip><TooltipTrigger asChild><Badge variant="outline" tabIndex={0}>{code}</Badge></TooltipTrigger><TooltipContent>Type: {type??"—"}<br/>Category: {category??"—"}</TooltipContent></Tooltip></TooltipProvider>;
}