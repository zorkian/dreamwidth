// general-request.test.ts
//
// General parent initialization/data ordering and final release controls.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.
//

import assert from "node:assert/strict";
import test from "node:test";
import {GeneralRequestPipeline} from "../live/render/general-request";
import {decodeGeneralModel} from "../live/render/general-model-wire";
import {NativeString} from "../runtime/native-string";
import {config,snapshot} from "../live/tests/fixtures";
import type {NativeJournalAuthority,NativeSelectedSnapshot} from "../live/contracts";
import type {ActiveProgramSnapshot} from "../live/data/active-program";
import type {PreparedProgram,PrivateProgramTransfer} from "../live/render/program-coordinator";
import type {GeneralPublicSession} from "../live/domain/general-public-session";

function fixture(initError=false) {
    const raw=snapshot(), order:string[]=[];
    const request=raw.request;
    const programRequest={username:request.username,view:request.page.kind,selection:"journal" as const};
    const u=raw.owner;
    let journal:NativeJournalAuthority={userid:u.userid,username:u.user,clusterid:u.clusterid,status:u.status,
        statusvis:u.statusvis,journaltype:u.journaltype,dversion:u.dversion,caps:u.caps,oldEncoding:0,
        publicSettings:u.publicSettings,fingerprint:"journal"};
    const active=({request:programRequest,journal:{userid:u.userid,username:u.user,clusterId:u.clusterid,
        status:u.status,statusvis:u.statusvis,journaltype:u.journaltype,dversion:u.dversion,caps:u.caps}}) as ActiveProgramSnapshot;
    let selectedCurrent=true;
    const prepared={} as PreparedProgram;
    const pipeline=new GeneralRequestPipeline({
        async loadNativeJournalAuthority(){order.push("journal");return journal;},
        async revalidateNativeJournalAuthority(value){assert.equal(value,journal);order.push("check-journal");return true;},
        async loadNativeSelectedSnapshot(bound){
            order.push("selected");assert.equal(bound.page.kind,"recent");
            assert.equal((bound.page as {itemshow:number}).itemshow,3);
            return {encoding:"dbi-byte-view",oldEncoding:0,undefinedEntryEvents:[],sources:[],
                facts:{...raw,request:bound}} as NativeSelectedSnapshot;
        },
        async revalidateNativeSelectedFingerprint(){order.push("check-selected");return selectedCurrent;},
    },{
        async load(){order.push("active");return active;},
        async revalidate(value){assert.equal(value,active);order.push("check-active");return true;},
    },{
        async prepare(){order.push("compile");return prepared;},
        transfer(value){assert.equal(value,prepared);return {} as PrivateProgramTransfer;},
    },{
        async render(_job,conversation){
            order.push("init");
            if(!initError){const resume=await conversation.select(3) as {page:unknown};
                const model=decodeGeneralModel(resume.page) as Record<string,unknown>;
                assert.deepEqual(Object.keys(model),[".type","_title"]);
                assert.deepEqual((model._title as NativeString).bytes(),Buffer.from([255]));}
            order.push("print");return {bytes:Buffer.from([255,0,97]),utf8:false};
        },
    },config,{
        helpers(){return {host:async()=>{throw Error("Unexpected host");},session:{
            async finish(operation:()=>Promise<boolean>){order.push("check-public");return operation();},
        } as GeneralPublicSession};},
        async project(){order.push("project");return {".type":"RecentPage",_title:NativeString.bytes(Buffer.from([255]))};},
    });
    return {pipeline,request,programRequest,order,setChanged(){selectedCurrent=false;},
        setPrivate(){journal={...journal,statusvis:"S"};}};
}

test("general parent init precedes selected data, approved wire and final reread",async()=>{
    const control=fixture();
    const result=await control.pipeline.render(control.request,control.programRequest);
    assert.ok(result.ok);assert.deepEqual(result.html,Buffer.from([255,0,97]));
    assert.deepEqual(control.order,["journal","active","compile","init","selected","project","print",
        "check-public","check-journal","check-active","check-selected"]);
    const changed=fixture();changed.setChanged();
    assert.deepEqual(await changed.pipeline.render(changed.request,changed.programRequest),{ok:false,reason:"changed"});
});
test("init errors recheck without selected SQL; private owner cannot initialize",async()=>{
    const control=fixture(true);
    assert.ok((await control.pipeline.render(control.request,control.programRequest)).ok);
    assert.deepEqual(control.order,["journal","active","compile","init","print","check-public","check-journal","check-active"]);
    const privateOwner=fixture();privateOwner.setPrivate();
    assert.deepEqual(await privateOwner.pipeline.render(privateOwner.request,privateOwner.programRequest),{ok:false,reason:"unsupported"});
    assert.deepEqual(privateOwner.order,["journal"]);
});
