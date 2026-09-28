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
import {execFileSync} from "node:child_process";
import {Kysely} from "kysely";
import type mysql from "mysql2/promise";
import {MysqlPublicMaintainers} from "../live/data/public-maintainers";
import {GeneralSelectedText} from "../live/domain/general-selected-text";
import {generalSelectedComments} from "../live/domain/general-comment-projection";
import {generalCommentFromSource,type GeneralSuspendedCommentInput,
    generalCommentTreeFromSource,type GeneralCommentSourceOperations} from "../live/domain/general-comment-from-source";
import {generalCommentRecords} from "../live/domain/general-comment-records";
import {generalCommentEdit} from "../live/domain/general-comment-edit";
import type {GeneralPublicSession} from "../live/domain/general-public-session";
import type {GeneralTextEncoding} from "../live/domain/general-text-encoding";
import {NativeString,scalarPV,scalarTruthy} from "../runtime/native-scalar";
import {Context,runtime} from "../runtime/s2runtime";
import {withSelectedFixture} from "./selected-fixture";

function nativeCommentOfficial(schema:string,posterId:number):number {
    const source=String.raw`use strict;use warnings;no warnings 'once';
use lib '/workspaces/dreamwidth/cgi-bin';use DBI;use JSON::PP;
require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';require LJ::Comment;
my($schema,$posterid)=@ARGV;die 'Isolated schema required' unless $schema=~/\As6_selected_[a-f0-9]{16}_g\z/;
my $db=DBI->connect("DBI:mysql:database=$schema;mysql_socket=/var/run/mysqld/mysqld.sock",'root','',
 {RaiseError=>1,PrintError=>0,mysql_enable_utf8=>0});
$db->do('SET SESSION TRANSACTION READ ONLY');$db->do('START TRANSACTION READ ONLY');
my $journal=bless $db->selectrow_hashref('SELECT * FROM user WHERE userid=900001'),'LJ::User';
my $row=$db->selectrow_hashref('SELECT * FROM user WHERE userid=?',undef,$posterid);
my $poster=$row?bless($row,'LJ::User'):undef;
{package FixtureComment;our @ISA=('LJ::Comment');
 sub journal{$_[0]->{journal}}sub poster{$_[0]->{poster}}sub prop{1}
 package FixtureCache;sub get{undef}sub set{$_[3]}}
no warnings 'redefine';local *DW::Cache::request=sub{bless {},'FixtureCache'};
local *LJ::_get_rel_memcache=sub{undef};local *LJ::_set_rel_memcache=sub{};
local *LJ::get_db_reader=sub{$db};local *LJ::get_cluster_reader=sub{die 'Unexpected cluster relation'};
local *LJ::run_hook=sub{die 'Unexpected relationship hook'};
my $comment=bless {journal=>$journal,poster=>$poster},'FixtureComment';
print encode_json(0+$comment->admin_post);$db->do('ROLLBACK');$db->disconnect;`;
    return JSON.parse(execFileSync('perl',['-e',source,schema,String(posterId)],
        {encoding:'utf8',timeout:10000,maxBuffer:32768}));
}

function nativeMapKeywordWithoutId():unknown {
    const source=String.raw`use strict;use warnings;no warnings 'once';
use lib '/workspaces/dreamwidth/cgi-bin';use JSON::PP;
require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';require LJ::User::Icons;
my $poster=bless {userid=>900999,dversion=>9},'LJ::User';
no warnings 'redefine';
local *LJ::User::get_userpic_info=sub{{mapkw=>{7=>'mapped'}}};
local *LJ::User::resolve_mapid_redirects=sub{$_[1]};
print encode_json([$poster->get_keyword_from_mapid(undef),$poster->get_keyword_from_mapid(7)]);`;
    return JSON.parse(execFileSync('perl',['-e',source],
        {encoding:'utf8',timeout:10000,maxBuffer:32768}));
}

function nativeCommentDefinedProps():unknown {
    const source=String.raw`use strict;use warnings;no warnings 'once';
use lib '/workspaces/dreamwidth/cgi-bin';use JSON::PP;
require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';require LJ::Comment;
my %props=(import_source=>'',edit_time=>'1020');
{package FixtureComment;our @ISA=('LJ::Comment');sub prop{$props{$_[1]}}}
my $comment=bless {},'FixtureComment';
print encode_json([defined($props{import_source})?1:0,$comment->is_edited?1:0]);`;
    return JSON.parse(execFileSync('perl',['-e',source],
        {encoding:'utf8',timeout:10000,maxBuffer:32768}));
}

test("general byte-view retains absent poster fallback and revokes it on public identity changes",{
    skip:process.env.S2_SELECTED_FIXTURE!=="1"
},async()=>withSelectedFixture(async f=>{
    const talks=f.table(f.c,"talk2"),texts=f.table(f.c,"talktext2");
    await f.admin.query(`INSERT INTO ${talks}
        (journalid,jtalkid,nodetype,nodeid,parenttalkid,posterid,datepost,state)
        VALUES (900001,77,'L',300,0,900999,'2026-09-26 01:00:00','A')`);
    await f.admin.query(`INSERT INTO ${texts}(journalid,jtalkid,subject,body)
        VALUES (900001,77,'Missing author','VISIBLE_MISSING_AUTHOR')`);
    await f.admin.query(`INSERT INTO ${f.table(f.c,"talkprop2")}(journalid,jtalkid,tpropid,value)
        VALUES (900001,77,?,''),(900001,77,?,'sm01'),
            (900001,77,?,'1020'),(900001,77,?,'Why')`,
    [f.talkProp('import_source'),f.talkProp('subjecticon'),
        f.talkProp('edit_time'),f.talkProp('edit_reason')]);
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
    const noEncoding={async item(){throw Error('Unreached charset conversion');}} as unknown as GeneralTextEncoding;
    const navigation={permalink:NativeString.hostUtf8Bytes('/300.html'),styleArgument:undefined};
    // The existing retained API remains on its prior strict branch.
    await assert.rejects(f.store.loadRawSnapshot(request));
    const issued=await f.store.loadNativeSelectedSnapshot(request);assert.ok(issued?.facts.comments);
    assert.equal(issued.facts.comments.headers.find(row=>row.jtalkid===77)?.posterid,900999);
    const [nativeTimes]=await f.admin.query<mysql.RowDataPacket[]>(
        `SELECT UNIX_TIMESTAMP(datepost) AS datepost_unix FROM ${talks}
            WHERE journalid=900001 AND jtalkid=77`);
    assert.equal(issued.facts.comments.headers.find(row=>row.jtalkid===77)?.datepostUnix,
        String(nativeTimes[0]!.datepost_unix));
    assert.equal(issued.facts.comments.authors.some(row=>row.userid===900999),false);
    assert.equal(issued.facts.comments.texts.find(row=>row.jtalkid===77)?.body,"VISIBLE_MISSING_AUTHOR");
    const missing=await GeneralSelectedText.prepare(issued,noEncoding);
    const sourceConfig={commentSettings:f.startup.commentSettings,capabilities:f.startup.capabilities};
    const missingTree=generalSelectedComments(issued,sourceConfig,missing,navigation);
    assert.deepEqual(missingTree?.roots.map(row=>row.id),[77]);
    const missingFields=missingTree!.roots[0]!.fields!;
    assert.equal(missingFields.posterLoaded,false);assert.equal(missingFields.posterId,900999);
    assert.equal(missingFields.body?.bytes().toString(),'VISIBLE_MISSING_AUTHOR');
    assert.equal(missingFields.importSourceDefined,true);
    assert.equal(missingFields.subjectIcon?.bytes().toString(),'sm01');
    assert.equal(missingFields.editTime?.bytes().toString(),'1020');
    assert.equal(missingFields.editReason?.bytes().toString(),'Why');
    assert.deepEqual(nativeCommentDefinedProps(),[1,1]);
    const missingRecords=generalCommentRecords(missingTree!,{journal:{'.type':'UserLite'},
        ditemid:300*256+1,entryLogtimeUnix:undefined,noHtml:undefined,
        shown(){return {hasPicture:false};}});
    const missingInput=missingRecords[0]?.input;
    assert.equal(missingInput?.kind,'shown');
    if(missingInput?.kind!=='shown')throw Error('Missing selected shown comment');
    assert.equal(missingInput.importSourceDefined,true);
    assert.equal(missingInput.anonymous,true);
    assert.equal(scalarPV(missingInput.subjectIcon).bytes().toString(),'sm01');
    assert.equal(missingInput.body?.bytes().toString(),'VISIBLE_MISSING_AUTHOR');
    assert.equal(missingInput.permalinkUrl,missingTree!.roots[0]!.urls.permalink);
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
    const registeredPrepared=await GeneralSelectedText.prepare(registered,noEncoding);
    const registeredTree=generalSelectedComments(registered,sourceConfig,registeredPrepared,navigation);
    assert.equal(registeredTree?.roots[0]?.posterUsername?.bytes().toString(),"restoredauthor");
    const invalidName={...registered,facts:{...registered.facts,comments:{...registered.facts.comments!,
        authors:registered.facts.comments!.authors.map(author=>author.userid===900999?
            {...author,user:"café"}:author)}}};
    assert.throws(()=>generalSelectedComments(invalidName,sourceConfig,registeredPrepared,navigation));
    const registeredRecords=generalCommentRecords(registeredTree!,{journal:{'.type':'UserLite'},
        ditemid:300*256+1,entryLogtimeUnix:undefined,noHtml:undefined,
        shown(){return {hasPicture:false};}});
    assert.equal(registeredRecords[0]?.input.kind,"shown");
    if(registeredRecords[0]?.input.kind==="shown")
        assert.equal(registeredRecords[0].input.posterUsername?.bytes().toString(),"restoredauthor");
    await f.admin.query(`UPDATE ${f.table(f.g,"user")} SET statusvis='S',clusterid=7
        WHERE userid=900999`);
    // A selected-body decode of this native nullable row would fail; the
    // suspended-only metadata path never selects its talktext2 record.
    await f.admin.query(`UPDATE ${texts} SET body=NULL
        WHERE journalid=900001 AND jtalkid=77`);
    await f.admin.query(`INSERT INTO ${f.table(f.c,"talkprop2")}(journalid,jtalkid,tpropid,value)
        VALUES (900001,77,?,'6'),(900001,77,?,'Source &<'),
            (900001,77,?,'1'),(900001,77,?,'PRIVATE_IP')`,
    [f.talkProp('picture_mapid'),f.talkProp('imported_from'),
        f.talkProp('admin_post'),f.talkProp('poster_ip')]);
    await f.admin.query(`UPDATE ${f.table(f.c,"talkprop2")} SET value='Changed &<' WHERE
        journalid=900001 AND jtalkid=77 AND tpropid=?`,[f.talkProp('edit_reason')]);
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
    const selected=await GeneralSelectedText.prepare(globalZone,noEncoding);
    const selectedComment=globalZone.facts.comments.texts.find(row=>row.jtalkid===77)!;
    assert.equal(selected.comment(selectedComment).subject,undefined);
    assert.equal(scalarTruthy(selected.commentAdminPost(selectedComment)),false);
    assert.equal(nativeCommentOfficial(f.g,900999),0);
    const selectedTree=generalSelectedComments(globalZone,sourceConfig,selected,navigation);
    assert.deepEqual(selectedTree?.roots.map(row=>row.id),[77]);
    assert.equal(selectedTree?.roots[0]?.datepostUnix,String(nativeTimes[0]!.datepost_unix));
    assert.equal(selectedTree?.roots[0]?.posterUsername,undefined);
    const fields=selectedTree!.roots[0]!.fields!;
    assert.equal(fields.loaded,true);assert.equal(fields.posterSuspended,true);
    assert.equal(fields.subject,undefined);assert.equal(fields.body,undefined);
    assert.equal(fields.pictureKeyword?.bytes().toString(),'changed-keyword');
    assert.equal(fields.editTime?.bytes().toString(),'1020');
    assert.equal(fields.editReason?.bytes().toString(),'Changed &<');
    assert.deepEqual(nativeMapKeywordWithoutId(),[null,'mapped']);
    const ctx=new Context([],()=>{throw Error('Unreached S2 print');});
    ctx.prop._userpics_position=NativeString.hostUtf8Bytes('none');
    const fixed=NativeString.hostUtf8Bytes;
    const urls=selectedTree!.roots[0]!.urls;
    const input:GeneralSuspendedCommentInput={kind:'suspended-loaded',...fields,
        talkid:77*256+1,ditemid:300*256+1,depth:1,journal:{'.type':'UserLite'},
        datepostUnix:selectedTree!.roots[0]!.datepostUnix,entryLogtimeUnix:1000,
        permalinkUrl:urls.permalink,replyUrl:urls.reply,parentUrl:urls.parent,threadrootUrl:undefined,
        expandUrl:urls.expand,jsExpandUrl:urls.jsExpand,
        hasChildren:false,showableChildren:0,hideChildren:0,hiddenChild:0,echi:undefined,
        lastTalkid:0,lastJournalId:0};
    const modelOperations:GeneralCommentSourceOperations={
        cleanComment(){throw Error('Suspended body cleaner output is redacted');},
        dateTimeUnix:value=>({'.type':'DateTime',_value:value}),
        posterTime:value=>({'.type':'DateTime',_value:value,_zone:globalZone.facts.comments!
            .authors.find(row=>row.userid===900999)!.timezone}),
        poster(){throw Error('Suspended author presentation is redacted');},
        edit(){return generalCommentEdit(selectedTree!.roots[0]!,{
            permalink:navigation.permalink,siteRoot:fixed('/app'),
            journalName:fixed('ordinary6'),styleArgument:undefined});},
        subjectImage(){throw Error('Suspended icon is redacted');},
        picture(){throw Error('Suspended image is redacted');},
        esnEnabled(){return 0;},editCommentsEnabled(){return 0;}};
    const model=generalCommentFromSource(ctx,input,modelOperations);
    const approved=generalCommentRecords(selectedTree!,{journal:input.journal,
        ditemid:300*256+1,entryLogtimeUnix:undefined,noHtml:undefined,
        shown(){throw Error('Suspended selected author must not be presented');}});
    const [assembled]=generalCommentTreeFromSource(ctx,1,()=>approved,()=>modelOperations);
    assert.equal(assembled?._fromsuspended,1);
    assert.equal(assembled?._reply_url,urls.reply);
    assert.equal((approved[0]?.input as {readonly kind:string}).kind,'suspended-loaded');
    assert.equal(model._fromsuspended,1);assert.equal(model._full,0);
    assert.equal(model._permalink_url,urls.permalink);
    assert.equal(model._reply_url,urls.reply);
    assert.equal(scalarPV(model._edit_url).bytes().toString(),'/300.html?edit='+urls.talkId);
    assert.equal(scalarPV(model._editreason).bytes().toString(),'Changed &amp;&lt;');
    assert.equal(model._poster,undefined);assert.equal(scalarPV(model._text).bytes().toString(),'');
    assert.equal((model._time_poster as {readonly _zone:string})._zone,'Europe/London');
    assert.equal(scalarPV(runtime.memberSlot(model._metadata,fixed('picture_keyword'),'hash').get())
        .bytes().toString(),'changed-keyword');
    assert.equal(scalarPV(runtime.memberSlot(model._metadata,fixed('imported_from'),'hash').get())
        .bytes().toString(),'Source &<');
    await f.admin.query(`UPDATE ${f.table(f.g,"user")} SET journaltype='C' WHERE userid=900001`);
    await f.admin.query(`INSERT INTO ${f.table(f.g,"reluser")}(userid,targetid,type)
        VALUES (900001,900999,'A')`);
    const maintainers=new MysqlPublicMaintainers(f.startup.database);
    try {
        const witnesses:Awaited<ReturnType<typeof maintainers.snapshot>>[]=[];
        const authority={async entryMaintainer(journalId:number,posterId:number){
            const witness=await maintainers.snapshot(journalId,posterId);
            witnesses.push(witness);return witness.canManage;
        }} as GeneralPublicSession;
        const current=await f.store.loadNativeSelectedSnapshot(request);assert.ok(current?.facts.comments);
        const official=await GeneralSelectedText.prepare(current,noEncoding,authority);
        const officialComment=current.facts.comments.texts.find(row=>row.jtalkid===77)!;
        assert.equal(scalarTruthy(official.commentAdminPost(officialComment)),true);
        assert.equal(nativeCommentOfficial(f.g,900999),1);
        const officialModel=generalCommentFromSource(ctx,{...input,
            ...official.commentPublicFields(officialComment)},modelOperations);
        assert.equal(officialModel._admin_post,1);
        assert.ok(witnesses.some(row=>row.posterId===900999&&row.canManage));
        await f.admin.query(`DELETE FROM ${f.table(f.g,"reluser")}
            WHERE userid=900001 AND targetid=900999 AND type='A'`);
        assert.equal(await f.store.revalidateNativeSelectedFingerprint(current),true);
        assert.equal(await Promise.all(witnesses.map(witness=>maintainers.revalidate(witness)))
            .then(values=>values.every(Boolean)),false);
        const revoked=await f.store.loadNativeSelectedSnapshot(request);assert.ok(revoked?.facts.comments);
        const ordinary=await GeneralSelectedText.prepare(revoked,noEncoding,authority);
        const ordinaryComment=revoked.facts.comments.texts.find(row=>row.jtalkid===77)!;
        assert.equal(scalarTruthy(ordinary.commentAdminPost(ordinaryComment)),false);
        assert.equal(nativeCommentOfficial(f.g,900999),0);
        const ordinaryModel=generalCommentFromSource(ctx,{...input,
            ...ordinary.commentPublicFields(ordinaryComment)},modelOperations);
        assert.equal(ordinaryModel._admin_post,0);
        // A page-loaded dversion-9 poster takes the mapid branch even when an
        // old picture_keyword prop remains. Native lookup(undef) is undef.
        await f.admin.query(`DELETE FROM ${f.table(f.c,"talkprop2")}
            WHERE journalid=900001 AND jtalkid=77 AND tpropid=?`,[f.talkProp('picture_mapid')]);
        await f.admin.query(`INSERT INTO ${f.table(f.c,"talkprop2")}(journalid,jtalkid,tpropid,value)
            VALUES (900001,77,?,'legacy-should-not-win')`,[f.talkProp('picture_keyword')]);
        assert.equal(await f.store.revalidateNativeSelectedFingerprint(revoked),false);
        const legacy=await f.store.loadNativeSelectedSnapshot(request);assert.ok(legacy?.facts.comments);
        const legacyComment=legacy.facts.comments.texts.find(row=>row.jtalkid===77)!;
        assert.equal(legacy.facts.comments.authors.find(row=>row.userid===900999)?.dversion,10);
        assert.equal(legacyComment.props.picture_mapid,undefined);
        assert.equal(legacyComment.props.picture_keyword,'legacy-should-not-win');
        const legacySelected=await GeneralSelectedText.prepare(legacy,noEncoding,authority);
        assert.equal(legacySelected.commentPublicFields(legacyComment).pictureKeyword,undefined);
        // Talk marks selected full membership before assigning its nullable
        // talktext body; `_loaded` therefore remains true for a NULL body.
        await f.admin.query(`INSERT INTO ${talks}
            (journalid,jtalkid,nodetype,nodeid,parenttalkid,posterid,datepost,state)
            VALUES (900001,80,'L',300,0,0,'2026-09-26 01:01:00','A')`);
        await f.admin.query(`INSERT INTO ${texts}(journalid,jtalkid,subject,body)
            VALUES (900001,80,'Nullable full body',NULL)`);
        assert.equal(await f.store.revalidateNativeSelectedFingerprint(legacy),false);
        const nullable=await f.store.loadNativeSelectedSnapshot(request);assert.ok(nullable?.facts.comments);
        const nullableSelected=await GeneralSelectedText.prepare(nullable,noEncoding,authority);
        const tree=generalSelectedComments(nullable,sourceConfig,nullableSelected,navigation);
        assert.ok(tree);
        assert.deepEqual(tree?.roots.map(row=>row.id),[77,80]);
        assert.equal(tree.roots[1]?.full,true);
        assert.equal(tree.roots[1]?.fields?.loaded,true);
        assert.equal(tree.roots[1]?.fields?.body,undefined);
    } finally {await maintainers.close();}
},false,false,false,true));
