// general-comment-author-data.test.ts
//
// Missing public Comment author source and final authority reread.
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
import {Kysely} from "kysely";
import {withSelectedFixture} from "./selected-fixture";

test("general byte-view retains absent poster fallback and revokes it on public identity changes",{
    skip:process.env.S2_SELECTED_FIXTURE!=="1"
},async()=>withSelectedFixture(async f=>{
    const talks=f.table(f.c,"talk2"),texts=f.table(f.c,"talktext2");
    await f.admin.query(`INSERT INTO ${talks}
        (journalid,jtalkid,nodetype,nodeid,parenttalkid,posterid,datepost,state)
        VALUES (900001,77,'L',300,0,900999,'2026-09-26 01:00:00','A')`);
    await f.admin.query(`INSERT INTO ${texts}(journalid,jtalkid,subject,body)
        VALUES (900001,77,'Missing author','VISIBLE_MISSING_AUTHOR')`);
    await f.admin.query(`INSERT INTO ${talks}
        (journalid,jtalkid,nodetype,nodeid,parenttalkid,posterid,datepost,state)
        VALUES (900001,78,'L',300,0,900998,'2026-09-26 01:00:00','D'),
            (900001,79,'L',300,0,900998,'2026-09-26 01:00:00','S')`);
    await f.admin.query(`INSERT INTO ${texts}(journalid,jtalkid,subject,body)
        VALUES (900001,78,'PRIVATE_DELETED_SUBJECT',NULL),
            (900001,79,'PRIVATE_SCREENED_SUBJECT',NULL)`);
    await f.admin.query(`INSERT INTO ${f.table(f.c,"talkprop2")}(journalid,jtalkid,tpropid,value)
        VALUES (900001,78,?,'PRIVATE_DELETED_PROP'),(900001,79,?,'PRIVATE_SCREENED_PROP')`,
    [f.talkProp('imported_from'),f.talkProp('imported_from')]);
    const request=f.request("ordinary6",{kind:"entry",ditemid:300*256+1});
    // The existing retained API remains on its prior strict branch.
    await assert.rejects(f.store.loadRawSnapshot(request));
    const issued=await f.store.loadNativeSelectedSnapshot(request);assert.ok(issued?.facts.comments);
    assert.equal(issued.facts.comments.headers.find(row=>row.jtalkid===77)?.posterid,900999);
    assert.equal(issued.facts.comments.authors.some(row=>row.userid===900999),false);
    assert.equal(issued.facts.comments.texts.find(row=>row.jtalkid===77)?.body,"VISIBLE_MISSING_AUTHOR");
    assert.equal(await f.store.revalidateNativeSelectedFingerprint(issued),true);
    await f.admin.query(`INSERT INTO ${f.table(f.g,"user")}
        (userid,user,clusterid,status,statusvis,journaltype,name,opt_showtalklinks,opt_whocanreply,
        opt_forcemoodtheme,moodthemeid,defaultpicid,dversion,caps)
        VALUES (900999,'restoredauthor',0,'A','V','P','Restored public','Y','all','N',1,NULL,10,2)`);
    await f.admin.query(`INSERT INTO ${f.table(f.g,"useridmap")}(userid,user)
        VALUES (900999,'restoredauthor')`);
    assert.equal(await f.store.revalidateNativeSelectedFingerprint(issued),false);
    const registered=await f.store.loadNativeSelectedSnapshot(request);assert.ok(registered?.facts.comments);
    assert.equal(registered.facts.comments.authors.some(row=>row.userid===900999),true);
    await f.admin.query(`UPDATE ${f.table(f.g,"user")} SET statusvis='S',clusterid=7
        WHERE userid=900999`);
    // A selected-body decode of this native nullable row would fail; the
    // suspended-only metadata path never selects its talktext2 record.
    await f.admin.query(`UPDATE ${texts} SET body=NULL
        WHERE journalid=900001 AND jtalkid=77`);
    await f.admin.query(`INSERT INTO ${f.table(f.c,"talkprop2")}(journalid,jtalkid,tpropid,value)
        VALUES (900001,77,?,'6'),(900001,77,?,'Source &<'),
            (900001,77,?,'Changed &<'),(900001,77,?,'1'),
            (900001,77,?,'PRIVATE_IP')`,[f.talkProp('picture_mapid'),f.talkProp('imported_from'),
        f.talkProp('edit_reason'),f.talkProp('admin_post'),f.talkProp('poster_ip')]);
    await f.admin.query(`INSERT INTO ${f.table(f.c,"userkeywords")}(userid,kwid,keyword)
        VALUES (900999,1,'suspended-keyword')`);
    await f.admin.query(`INSERT INTO ${f.table(f.c,"userpicmap3")}(userid,mapid,kwid,picid,redirect_mapid)
        VALUES (900999,5,1,951,NULL),(900999,6,NULL,NULL,5)`);
    await f.admin.query(`INSERT INTO ${f.table(f.c,"userpic2")}
        (userid,picid,width,height,state,description)
        VALUES (900999,951,10,10,'N','PRIVATE_SUSPENDED_IMAGE')`);
    await f.admin.query(`INSERT INTO ${f.table(f.c,"userproplite2")}(userid,upropid,value)
        VALUES (900999,?,'UTC')`,[f.prop('timezone')]);
    assert.equal(await f.store.revalidateNativeSelectedFingerprint(registered),false);
    // Record the actual compiled SELECTs for this request. The nullable body
    // below also catches accidental decode, but only this assertion proves
    // that the suspended talktext2 row was not fetched at all.
    const original=Kysely.prototype.getExecutor;
    const queries:{sql:string;parameters:readonly unknown[]}[]=[];
    Kysely.prototype.getExecutor=function(){
        const executor=original.call(this);
        return new Proxy(executor,{get(target,key){
            if(key==='executeQuery')return async(query: {sql:string;parameters:readonly unknown[]},...rest:unknown[])=>{
                queries.push({sql:query.sql,parameters:query.parameters});
                return (target.executeQuery as (...args:unknown[])=>Promise<unknown>).call(target,query,...rest);
            };
            const value=Reflect.get(target,key);
            return typeof value==='function'?value.bind(target):value;
        }});
    };
    let suspended:Awaited<ReturnType<typeof f.store.loadNativeSelectedSnapshot>>;
    try{suspended=await f.store.loadNativeSelectedSnapshot(request);}
    finally{Kysely.prototype.getExecutor=original;}
    assert.ok(queries.some(query=>/FROM talktext2\b/.test(query.sql)));
    assert.ok(queries.filter(query=>/FROM talktext2\b/.test(query.sql))
        .every(query=>![77,78,79].some(id=>query.parameters.some(value=>String(value)===String(id)))));
    assert.ok(queries.some(query=>/FROM talkprop2\b/.test(query.sql)&&
        query.parameters.some(value=>String(value)==='77')&&
        ![78,79].some(id=>query.parameters.some(value=>String(value)===String(id)))));
    assert.ok(queries.filter(query=>/FROM user WHERE userid IN/.test(query.sql))
        .every(query=>!query.parameters.some(value=>String(value)==='900998')));
    assert.ok(queries.some(query=>/FROM userpicmap3\b/.test(query.sql)));
    assert.ok(suspended?.facts.comments);
    assert.equal(suspended.facts.comments.authors.find(row=>row.userid===900999)?.timezone,'UTC');
    assert.equal(suspended.facts.comments.authors.find(row=>row.userid===900999)?.name,'');
    const redacted=suspended.facts.comments.texts.find(row=>row.jtalkid===77);
    assert.ok(redacted);assert.equal(redacted.body,null);assert.equal(redacted.subject,'');
    assert.equal(redacted.props.picture_mapid,'6');
    assert.equal(redacted.props.imported_from,'Source &<');
    assert.equal(redacted.props.edit_reason,'Changed &<');
    assert.equal(redacted.props.admin_post,'1');
    assert.equal(suspended.facts.comments.authors.find(row=>row.userid===900999)?.pictures.pictures.length,0);
    assert.deepEqual(suspended.facts.comments.authors.find(row=>row.userid===900999)?.pictures.mappings
        .map(row=>row.mapid),[5,6]);
    assert.ok(!JSON.stringify(suspended).includes("VISIBLE_MISSING_AUTHOR"));
    assert.ok(!JSON.stringify(suspended).includes('PRIVATE_IP'));
    assert.ok(!JSON.stringify(suspended).includes('PRIVATE_SUSPENDED_IMAGE'));
    assert.ok(!JSON.stringify(suspended).includes('PRIVATE_DELETED_'));
    assert.ok(!JSON.stringify(suspended).includes('PRIVATE_SCREENED_'));
    assert.equal(suspended.facts.comments.authors.some(row=>row.userid===900998),false);
    await f.admin.query(`UPDATE ${f.table(f.c,"userkeywords")} SET keyword='changed-keyword'
        WHERE userid=900999 AND kwid=1`);
    assert.equal(await f.store.revalidateNativeSelectedFingerprint(suspended),false);
    const changedMap=await f.store.loadNativeSelectedSnapshot(request);assert.ok(changedMap?.facts.comments);
    assert.equal(changedMap.facts.comments.authors.find(row=>row.userid===900999)?.pictures.mappings[0]?.keyword,
        'changed-keyword');
    // The same page-loaded suspended poster can have the public timezone in
    // global userprop instead. Both sides of the global bracket must read it.
    await f.admin.query(`DELETE FROM ${f.table(f.c,"userproplite2")}
        WHERE userid=900999 AND upropid=?`,[f.prop('timezone')]);
    await f.admin.query(`INSERT INTO ${f.table(f.g,"userprop")}(userid,upropid,value)
        VALUES (900999,?,'Europe/London')`,[f.prop('timezone')]);
    assert.equal(await f.store.revalidateNativeSelectedFingerprint(changedMap),false);
    const globalZone=await f.store.loadNativeSelectedSnapshot(request);assert.ok(globalZone?.facts.comments);
    assert.equal(globalZone.facts.comments.authors.find(row=>row.userid===900999)?.timezone,'Europe/London');
    assert.equal(await f.store.revalidateNativeSelectedFingerprint(globalZone),true);
}));
