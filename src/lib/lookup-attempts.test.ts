// © 2026 Farid Asnawi. All rights reserved. Proprietary. See LICENSE.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { attemptLog } from '../../supabase/functions/locker-lookup/logging';
import { LOOKUP_PAGE_SIZE,lookupExport,wrongEnteredBadge,type LookupAttempt } from './lookup-attempts';
test('entered badge is trimmed and capped at 30 characters without storing ID input',()=>{
 const input = {ip:'192.0.2.1',locker:'1A',badge:'  '+ 'A'.repeat(40)+'  ',success:false,reason:'id_mismatch' as const,national_id:'DO_NOT_STORE',id_digits:'DO_NOT_STORE',owner:{employee_name:'Example',badge_number:'B1',national_id:'DO_NOT_STORE'}};
 const row=attemptLog(input); assert.equal(row.entered_badge,'A'.repeat(30)); assert.deepEqual(Object.keys(row).sort(),['entered_badge','failure_reason','ip_address','locker_number','owner_badge_snapshot','owner_name_snapshot','success'].sort()); assert.equal(JSON.stringify(row).includes('DO_NOT_STORE'),false); assert.equal(row.failure_reason,'id_mismatch');
});
test('empty lockers have no owner snapshots and successful attempts have no failure reason',()=>{
 assert.equal(attemptLog({ip:'x',locker:'1A',badge:'B',success:false,reason:'empty_locker',owner:{status:'empty',employee_name:'Stale',badge_number:'Stale'}}).owner_name_snapshot,null);
 assert.equal(attemptLog({ip:'x',locker:'1A',badge:'B',success:true,reason:'badge_mismatch'}).failure_reason,null);
});
test('only failed entered badges differing from known on-record badges are highlighted',()=>{
 assert.equal(wrongEnteredBadge({success:false,entered_badge:'B2',owner_badge_snapshot:'B1'}),true);
 assert.equal(wrongEnteredBadge({success:true,entered_badge:'B2',owner_badge_snapshot:'B1'}),false);
 assert.equal(wrongEnteredBadge({success:false,entered_badge:'B2',owner_badge_snapshot:null}),false);
});
test('exports have exactly six requested columns and page size is 50',()=>{
 const a:LookupAttempt={id:'1',attempted_at:'2026-11-23T05:00:00Z',ip_address:'192.0.2.1',locker_number:'1A',entered_badge:'B2',owner_badge_snapshot:'B1',owner_name_snapshot:'Example',success:false,failure_reason:'badge_mismatch',review:true};
 assert.deepEqual(Object.keys(lookupExport(a)),['When','Locker','Badge entered','Name on record','IP','Result']); assert.equal(lookupExport(a).Result,'Wrong badge'); assert.equal(LOOKUP_PAGE_SIZE,50);
});