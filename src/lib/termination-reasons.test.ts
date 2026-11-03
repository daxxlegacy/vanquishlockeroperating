import { test } from "node:test";
import assert from "node:assert/strict";
import { mapHrReason,mapTerminationType,suggestedType,reasonClash,validTerminationMetadata,localDateIso } from "./termination-reasons";
import { parseHrRows } from "./hr-parser";
test("HR separation mapping never uses another reason column",()=>{
  assert.equal(mapHrReason(" Resignation "),"RESIGN"); assert.equal(mapHrReason("Absence Without Leave"),"AWOL"); assert.equal(mapHrReason("Return To Vendor"),"RTV"); assert.equal(mapHrReason("Others"),"OTHER"); assert.equal(mapHrReason(""),"OTHER");
});
test("type normalization and clashes",()=>{assert.equal(mapTerminationType("Involuntary"),"Involuntary");assert.equal(mapTerminationType("VOLUNTARY"),"Voluntary");assert.equal(reasonClash("Involuntary","RESIGN"),true);assert.equal(reasonClash("Voluntary","RESIGN"),false);});
test("suggestions and OTHER type requirement",()=>{assert.equal(suggestedType("RESIGN"),"Voluntary");assert.equal(suggestedType("AWOL"),"Involuntary");assert.equal(suggestedType("RTV"),null);assert.equal(suggestedType("OTHER"),null);assert.equal(validTerminationMetadata({reason_code:"OTHER"}),false);assert.equal(validTerminationMetadata({reason_code:"OTHER",termination_type:"Voluntary"}),true);});
test("local date respects local calendar methods",()=>{const date=new Date(2026,10,3,0,15);assert.equal(localDateIso(date),"2026-11-03");});
test("header mapped blocks recover only verified alternate layouts, ignoring IDs",()=>{
 const h=["Employee Code","Employee Name","Term Type13","SeparationType 18","Actual/Suspected 19","Reason 20"];
 const h2=["Employee Code","Employee Name","National ID","Term Type13","SeparationType 18","Actual/Suspected 19","Reason 20"];
 const raw=[h,["1","One","Voluntary","Resignation","Another Job","Private note"],["2","Two","000000-00-0000","Involuntary","AWOL","Attendance Issue","Private note"],h2,["3","Three","000000-00-0000","Voluntary","","Others","Private note"]];
 const parsed=parseHrRows(raw,"termination.xlsx",false);
 assert.equal(parsed.people.length,3);assert.equal(parsed.needsCheck.length,0);assert.equal(parsed.people[1].reason_code,"AWOL");assert.equal(parsed.people[1].termination_type,"Involuntary");assert.equal(parsed.people[2].warnings[0],"No reason in HR file");assert.equal(parsed.people[0].reason_detail,null);assert.equal(JSON.stringify(parsed).includes("000000-00-0000"),false);
});
test("unresolved shifted row goes to Needs check without raw values",()=>{const parsed=parseHrRows([["Employee Code","Employee Name","Term Type13"],["1","One","000000-00-0000"]],"termination.xlsx",true);assert.equal(parsed.people.length,0);assert.equal(parsed.needsCheck.length,1);assert.equal(JSON.stringify(parsed).includes("000000-00-0000"),false);});