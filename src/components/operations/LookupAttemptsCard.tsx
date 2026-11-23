// © 2026 Farid Asnawi. All rights reserved. Proprietary. See LICENSE.
import { useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { Download, RefreshCw, Search, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TablePagination } from '@/components/TablePagination';
import { LockerDetail } from '@/components/LockerDetail';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format-date';
import { LOOKUP_PAGE_SIZE,lookupResult,lookupExport,wrongEnteredBadge,type LookupAttempt,type LookupPage } from '@/lib/lookup-attempts';
import { toast } from 'sonner';

export function LookupAttemptsCard() {
  const [client] = useState(()=>new QueryClient());
  return <QueryClientProvider client={client}><LookupAttemptsContent/></QueryClientProvider>;
}

function LookupAttemptsContent() {
  const {role,user} = useAuth();
  const [filter,setFilter] = useState('all');
  const [search,setSearch] = useState('');
  const [from,setFrom] = useState('');
  const [to,setTo] = useState('');
  const [page,setPage] = useState(1);
  const [selected,setSelected] = useState<LookupAttempt|null>(null);
  const [lockerId,setLockerId] = useState<string|null>(null);
  const [exporting,setExporting] = useState(false);
  const [opening,setOpening] = useState(false);
  const invalidDates = !!from && !!to && from>to;
  const dateStart = from ? new Date(`${from}T00:00:00`).toISOString() : null;
  const dateEnd = to ? (()=>{const d=new Date(`${to}T00:00:00`);d.setDate(d.getDate()+1);return d.toISOString();})() : null;
  const fetchPage = async (offset:number,before=dateEnd) => {
    const {data,error} = await supabase.rpc('search_lookup_attempts',{_search:search.trim(),_result:filter,...(dateStart?{_from:dateStart}:{}),...(before?{_before:before}:{}),_offset:offset});
    if(error) throw new Error(error.message);
    return data as unknown as LookupPage;
  };
  const query = useQuery({queryKey:['lookup-attempts',user?.id,filter,search,from,to,page],queryFn:()=>fetchPage((page-1)*LOOKUP_PAGE_SIZE),enabled:role==='admin'&&!invalidDates,retry:false});
  if(role!=='admin') return null;
  const rows=query.data?.rows??[];
  const result = (a:LookupAttempt) => <span className="inline-flex flex-wrap items-center gap-1">{a.success?<Badge variant="outline" className="border-info/30 bg-info/10 text-info">Success</Badge>:<span className="text-xs">{lookupResult(a)}</span>}{a.review&&<Badge variant="destructive">Review</Badge>}</span>;
  const openLocker = async()=>{
    if(!selected?.locker_number) return;
    setOpening(true);
    try {
      const {data,error}=await supabase.from('lockers_masked').select('id').eq('locker_number',selected.locker_number).is('deleted_at',null).maybeSingle();
      if(error) throw new Error(error.message);
      if(!data?.id) {toast.error('Locker no longer exists');return;}
      setSelected(null);setLockerId(data.id);
    }catch(e){toast.error(e instanceof Error?e.message:'Could not open locker');}finally{setOpening(false);}
  };
  const exportRows=async()=>{
    if(invalidDates) return;
    setExporting(true);
    try{
      const cutoff=dateEnd&&dateEnd<new Date().toISOString()?dateEnd:new Date().toISOString();
      const exported:ReturnType<typeof lookupExport>[]=[];
      for(let offset=0;;offset+=LOOKUP_PAGE_SIZE){
        const batch=await fetchPage(offset,cutoff);
        exported.push(...batch.rows.map(lookupExport));
        if(offset+batch.rows.length>=batch.total||batch.rows.length===0) break;
      }
      const XLSX=await import('xlsx');
      const sheet=XLSX.utils.json_to_sheet(exported,{header:['When','Locker','Badge entered','Name on record','IP','Result']});
      const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'Lookup attempts');XLSX.writeFile(book,'lookup-attempts.xlsx');
      toast.success(`Exported ${exported.length.toLocaleString()} lookup attempts`);
    }catch(e){toast.error(e instanceof Error?e.message:'Export failed');}finally{setExporting(false);}
  };
  return <>
    <Card className="min-w-0">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-lg">Recent lookup attempts</CardTitle>
        <div className="flex gap-1"><Button variant="outline" size="sm" onClick={exportRows} disabled={exporting||invalidDates||query.isPending}><Download className="mr-1 h-4 w-4"/>{exporting?'Exporting…':'Export'}</Button><Button variant="ghost" size="icon" aria-label="Refresh lookup attempts" title="Refresh" onClick={()=>query.refetch()} disabled={query.isFetching||invalidDates}><RefreshCw className={`h-4 w-4 ${query.isFetching?'animate-spin':''}`}/></Button></div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Tabs value={filter} onValueChange={v=>{setFilter(v);setPage(1);}}><TabsList><TabsTrigger value="all">All</TabsTrigger><TabsTrigger value="success">Success</TabsTrigger><TabsTrigger value="failed">Failed</TabsTrigger></TabsList></Tabs>
        <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground"/><Input aria-label="Search lookup attempts" placeholder="Locker, badge, name or IP" className="pl-9" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/></div>
        <div className="grid grid-cols-2 gap-2"><div className="min-w-0 space-y-1"><Label htmlFor="lookup-from">From</Label><Input id="lookup-from" type="date" value={from} onChange={e=>{setFrom(e.target.value);setPage(1);}}/></div><div className="min-w-0 space-y-1"><Label htmlFor="lookup-to">To</Label><Input id="lookup-to" type="date" value={to} onChange={e=>{setTo(e.target.value);setPage(1);}}/></div></div>
        {invalidDates?<p role="alert" className="text-sm text-destructive">From must be on or before To.</p>:query.isError?<p role="alert" className="text-sm text-destructive">Could not load lookup attempts. Please refresh.</p>:query.isPending?<p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>:<div className="max-h-96 overflow-auto">
          <div className="hidden md:block"><Table><TableHeader><TableRow>{['When','Locker','Badge entered','Name on record','IP','Result'].map(h=><TableHead key={h} className="whitespace-nowrap">{h}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.map(a=><TableRow key={a.id} tabIndex={0} aria-label={`Lookup ${a.locker_number??'unknown'} ${a.entered_badge??''}`} className="cursor-pointer" onClick={()=>setSelected(a)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelected(a);}}}><TableCell className="whitespace-nowrap text-xs">{formatDateTime(a.attempted_at)}</TableCell><TableCell className="font-mono text-xs">{a.locker_number??'—'}</TableCell><TableCell className={`font-mono text-xs ${wrongEnteredBadge(a)?'bg-warning/10 text-warning font-semibold':''}`}>{a.entered_badge??'—'}</TableCell><TableCell className="text-xs">{a.owner_name_snapshot??'—'}</TableCell><TableCell className="font-mono text-xs">{a.ip_address??'—'}</TableCell><TableCell>{result(a)}</TableCell></TableRow>)}</TableBody></Table></div>
          <div className="space-y-2 md:hidden">{rows.map(a=><Button key={a.id} variant="outline" className="h-auto w-full flex-col items-stretch gap-2 p-3 text-left whitespace-normal" onClick={()=>setSelected(a)}><span className="flex justify-between gap-2"><span className="font-mono">{a.locker_number??'—'}</span>{result(a)}</span><span className="text-xs text-muted-foreground">{formatDateTime(a.attempted_at)} · {a.ip_address??'—'}</span><span className={`break-words text-xs ${wrongEnteredBadge(a)?'text-warning':''}`}>Badge entered: {a.entered_badge??'—'}</span><span className="break-words text-xs">Name on record: {a.owner_name_snapshot??'—'}</span></Button>)}</div>
          {rows.length===0&&<p className="py-8 text-center text-sm text-muted-foreground">No matching attempts</p>}
        </div>}
        <TablePagination page={page} pageSize={LOOKUP_PAGE_SIZE} total={invalidDates?0:query.data?.total??0} loading={query.isFetching} onPageChange={setPage} label="attempts"/>
        <p className="text-xs text-muted-foreground">Lookup logs are kept for 90 days.</p>
      </CardContent>
    </Card>
    <Dialog open={!!selected} onOpenChange={open=>{if(!open)setSelected(null);}}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Lookup attempt · {selected?.locker_number??'—'}</DialogTitle></DialogHeader>{selected&&<><dl className="space-y-3 text-sm">{[['When',`${formatDateTime(selected.attempted_at)} (${new Date(selected.attempted_at).toISOString()})`],['IP',selected.ip_address??'—'],['Badge entered',selected.entered_badge??'—'],['Badge on record',selected.owner_badge_snapshot??'—'],['Name on record',selected.owner_name_snapshot??'—'],['Result',lookupResult(selected)]].map(([label,value])=><div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="break-words">{value}</dd></div>)}</dl>{selected.review&&<Badge variant="destructive" className="w-fit">Review</Badge>}<Button onClick={openLocker} disabled={!selected.locker_number||opening}><ExternalLink className="mr-2 h-4 w-4"/>{opening?'Opening…':'Open locker'}</Button></>}</DialogContent></Dialog>
    {lockerId&&<LockerDetail lockerId={lockerId} open onClose={()=>setLockerId(null)}/>}
  </>;
}
