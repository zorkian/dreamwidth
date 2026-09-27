// general-text-encoding.test.ts
//
// Installed encoding setup and native selected-field conversion ordering.
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
import {mkdtempSync,rmSync} from "node:fs";
import path from "node:path";
import {tmpdir} from "node:os";
import {NativeString} from "../runtime/native-string";
import type {NativeProfile} from "../runtime/native-profile";
import {GeneralEncodingProfile} from "../live/domain/general-encoding-profile";
import {GeneralSelectedText} from "../live/domain/general-selected-text";
import {MysqlPublicEncodings} from "../live/data/public-encodings";
import {withSelectedFixture} from "./selected-fixture";
import {GeneralTextEncoding} from "../live/domain/general-text-encoding";
import {GeneralPublicSession} from "../live/domain/general-public-session";

const pv=(value:number[])=>NativeString.bytes(Buffer.from(value));
test("trusted setup and native item_toutf8 preserve source lookup/error/binary ordering",async()=>{
    const directory=mkdtempSync(path.join(tmpdir(),"g2c-encoding-"));
    try {
        const sandbox=path.join(directory,"sandbox");
        execFileSync("cc",["-std=c11","-Wall","-Wextra","-Werror","-O2","live/render/sandbox.c","-o",sandbox]);
        const root=path.resolve("../..");
        const scalar=JSON.parse(execFileSync("perl",["tools/compile-active.pl",root,path.join(root,"S2.pm")],{
            input:JSON.stringify({profileOnly:true}),encoding:"utf8",maxBuffer:1048576,timeout:10000})).profile as NativeProfile;
        const profile=GeneralEncodingProfile.create({perl:"/usr/bin/perl",sandbox,prlimit:"/usr/bin/prlimit",
            perlLibrary:"/opt/dreamwidth-extlib/lib/perl5"},scalar);
        assert.match(profile.identity,/^[a-f0-9]{64}$/);assert.equal(profile.current(),true);
        const oracle=`use strict; use warnings; no warnings 'once';
            use lib '/workspaces/dreamwidth/cgi-bin';use JSON::PP;use MIME::Base64 qw(encode_base64);
            BEGIN {require DBI;no warnings 'redefine';*DBI::connect=sub{die 'DB forbidden'};*DBI::connect_cached=sub{die 'DB forbidden'};}
            require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';require LJ::ConvUTF8;
            my @out; for my $oldenc(0,1,2) {my $calls=0; %LJ::CACHE_ENCODINGS=();
            no warnings 'redefine';local *LJ::load_codes=sub {$calls++;%{$_[0]->{encoding}}=(1=>'iso-8859-1',2=>'missing-charset');};
            my $subject=pack('C*',255);my $text;my %props=(current_music=>pack('C*',233),xpost=>pack('C*',255,0));
            LJ::item_toutf8({oldenc=>$oldenc},\\$subject,\\$text,\\%props);
            push @out,{subject=>encode_base64($subject,''),text=>defined($text)?encode_base64($text,''):undef,
            props=>{map {$_=>encode_base64($props{$_},'')} keys %props},calls=>$calls};}
            print encode_json(\\@out);`;
        const rows=JSON.parse(execFileSync("perl",["-e",oracle],{encoding:"utf8",timeout:10000}));
        for(const oldEncoding of [0,1,2]) {
            let calls=0;
            const session=new GeneralPublicSession({async snapshot(){throw Error("No user lookup");},async revalidate(){return true;}},
                {async snapshot(){throw Error("No translation lookup");},async revalidate(){return true;}},scalar,25,
                {async snapshot(){calls++;return {entries:[[NativeString.hostUtf8Bytes("1"),NativeString.hostUtf8Bytes("iso-8859-1")],
                    [NativeString.hostUtf8Bytes("2"),NativeString.hostUtf8Bytes("missing-charset")]],fingerprint:"codes"};},async revalidate(){return true;}});
            const converter=new GeneralTextEncoding(session,profile,oldEncoding,{maxInputBytes:1048576,maxOutputBytes:1048576});
            assert.equal(await converter.text(undefined),undefined);
            assert.equal((await converter.text(pv([65,10,13])))!.bytes().toString("base64"),"QQoN");assert.equal(calls,0);
            const original={current_music:pv([233]),xpost:pv([255,0])};
            const result=await converter.item(pv([255]),undefined,original);
            assert.deepEqual({subject:result.subject!.bytes().toString("base64"),text:result.text??null,
                props:Object.fromEntries(Object.entries(result.props).map(([key,value])=>[key,value!.bytes().toString("base64")])),calls},rows[oldEncoding]);
            assert.equal(original.current_music.bytes().toString("base64"),"6Q==");
            assert.equal(await session.finish(async()=>converter.current()),true);
        }
        await withSelectedFixture(async({admin,store,g,c,table,request,startup})=>{
            await admin.query(`INSERT INTO ${table(g,"codes")} (type,code,item,sortorder) VALUES ('encoding','1','iso-8859-1',1)`);
            await admin.query(`UPDATE ${table(g,"user")} SET oldenc=1 WHERE userid=900001`);
            await admin.query(`INSERT INTO ${table(c,"userpic2")} (userid,picid,width,height,state,description)
                VALUES (900001,8101,101,99,'X',CONVERT(? USING latin1))`,[Buffer.from([255,38,60])]);
            const [definitions]=await admin.query<any[]>(`SELECT propid FROM ${table(g,"logproplist")} WHERE name='unknown8bit'`);
            assert.equal(definitions.length,1);
            await admin.query(`INSERT INTO ${table(c,"logprop2")} (journalid,jitemid,propid,value) VALUES (900001,1,?,'1')`,[definitions[0].propid]);
            const [formatDefinitions]=await admin.query<any[]>(`SELECT propid,name FROM ${table(g,"logproplist")}
                WHERE name IN ('editor','opt_preformatted','import_source')`);
            assert.equal(formatDefinitions.length,3);
            for(const definition of formatDefinitions)await admin.query(`INSERT INTO ${table(c,"logprop2")}
                (journalid,jitemid,propid,value) VALUES (900001,1,?,?)
                ON DUPLICATE KEY UPDATE value=VALUES(value)`,
                [definition.propid,definition.name==='editor'?'rte0':'0']);
            await admin.query(`UPDATE ${table(c,"logtext2")} SET event=CONVERT(? USING latin1) WHERE journalid=900001 AND jitemid=1`,[Buffer.from([255,0,97])]);
            await admin.query(`INSERT INTO ${table(c,"links")} (journalid,ordernum,parentnum,title,url,hover)
                VALUES (900001,2,0,'-',CONVERT(? USING latin1),'<hover>')`,[Buffer.from([47,255,38,97])]);
            await admin.query(`INSERT INTO ${table(c,"links")} (journalid,ordernum,parentnum,title,url,hover)
                VALUES (900001,1,0,'first','/first','')`);
            await admin.query(`UPDATE ${table(g,"user")} SET name=CONVERT(? USING latin1) WHERE userid=900001`,[Buffer.from([255,60,110,62])]);
            const snapshot=await store.loadNativeSelectedSnapshot(request("ordinary6",{kind:"entry",ditemid:257}));
            assert.ok(snapshot);
            const codes=new MysqlPublicEncodings(startup.database);
            try {
                const unused={async snapshot():Promise<never>{throw Error("Unreached public helper");},async revalidate(){return true;}};
                const session=new GeneralPublicSession(unused,unused,scalar,25,codes);
                const converter=new GeneralTextEncoding(session,profile,snapshot.oldEncoding,{maxInputBytes:1048576,maxOutputBytes:1048576});
                const text=await GeneralSelectedText.prepare(snapshot,converter);
                const pageText=text.pageText();assert.equal(pageText.ownerName!.bytes().toString("hex"),"ff3c6e3e");
                assert.equal(pageText.customtext.content,undefined);
                assert.equal(text.ownerPicture(0),undefined);
                const picture=text.ownerPicture(8101)!;
                assert.equal(picture.userid,900001);assert.equal(picture.width,101);assert.equal(picture.height,99);
                assert.equal(picture.description!.bytes().toString("hex"),"ff263c");
                assert.equal(picture.description!.flagged(),false);
                assert.equal(Object.hasOwn(picture,"state"),false);
                assert.deepEqual(text.ownerPicture(8102),{userid:900001,picid:8102,width:undefined,
                    height:undefined,description:undefined});
                // X is excluded from keyword lookup, but not a direct picture
                // skeleton/get. The account itself remains ordinary and visible.
                assert.equal(text.pictureId(900001,NativeString.hostUtf8Bytes("pic#8101")),0);
                assert.equal(text.resolvedPictureImage(900001,8101,
                    NativeString.hostUtf8Bytes("https://pics.invalid"))._width,101);
                const links=text.publicLinks();assert.equal(links.length,2);
                assert.equal(links[0]!.title!.bytes().toString(),"first");
                assert.equal(links[1]!.title!.bytes().toString("hex"),"2d");
                assert.equal(links[1]!.url!.bytes().toString("hex"),"2fff2661");
                assert.equal(links[1]!.url!.flagged(),false);
                assert.equal(links[1]!.hover!.bytes().toString(),"<hover>");
                const entry=snapshot.facts.entries[0]!;
                const formatting=text.entryFormatting(entry);
                assert.deepEqual(Object.keys(formatting).sort(),["editor","event","importSourceDefined","logtimeMysql","preformatted","subject"].sort());
                assert.equal(formatting.editor!.bytes().toString(),"rte0");
                assert.equal((formatting.preformatted as NativeString).bytes().toString(),"0");
                assert.equal(formatting.importSourceDefined,true);
                assert.equal(formatting.logtimeMysql.bytes().toString(),entry.logtime);
                const contentOptions={suspendMessage:0,noEntryBody:0,noHtml:0,
                    cutUrl:NativeString.hostUtf8Bytes("/257.html"),cutDisable:0,
                    props:{useragent:"must remain parent-only"},xpostOpaque:"must remain parent-only"};
                const projected=text.entrySource(entry,{
                    permalinkUrl:NativeString.hostUtf8Bytes("/257.html"),adultContentLevel:NativeString.hostUtf8Bytes("none"),
                    content:contentOptions});
                assert.equal(projected.content.ditemid,257);
                assert.equal(projected.content.jitemid,1);
                assert.equal(projected.posterId,entry.posterid);
                assert.equal(projected.content.journalName.bytes().toString(),"ordinary6");
                assert.deepEqual(projected.content.event!.bytes(),formatting.event!.bytes());
                assert.equal(Object.hasOwn(projected,"props"),false);
                assert.equal(Object.hasOwn(projected.content,"props"),false);
                assert.equal(Object.hasOwn(projected.content,"xpostOpaque"),false);
                const direct=text.entryPageSource(entry,{permalinkUrl:projected.permalinkUrl,
                    adultContentLevel:projected.adultContentLevel,mode:NativeString.hostUtf8Bytes("reply"),
                    suspendMessage:0,noHtml:0});
                assert.equal((direct.mode as NativeString).bytes().toString(),"reply");
                assert.deepEqual(direct.content.event!.bytes(),projected.content.event!.bytes());
                for(const key of ["noEntryBody","cutUrl","cutDisable","props"])
                    assert.equal(Object.hasOwn(direct.content,key),false);
                assert.equal(Object.hasOwn(direct,"forceMoodtheme"),false);
                assert.throws(()=>text.entrySource({...entry},{permalinkUrl:projected.permalinkUrl,
                    adultContentLevel:projected.adultContentLevel,content:projected.content}));
                const oracle=JSON.parse(execFileSync("perl",["tools/general-selected-encoding-native.pl",g,c],{encoding:"utf8",timeout:10000}));
                const frames=(value:NativeString|undefined)=>value===undefined?null:{base64:value.bytes().toString("base64"),utf8:value.flagged()?1:0};
                assert.deepEqual({subject:frames(text.entry(entry).subject),text:frames(text.entry(entry).text)},oracle);
                assert.equal(snapshot.sources.find(cell=>cell.key==="entry:1:event")!.value!.base64,"/wBh");
                assert.throws(()=>text.entry({...entry}));
                assert.equal(await store.revalidateNativeSelectedFingerprint(snapshot),true);
                await admin.query(`UPDATE ${table(g,"user")} SET oldenc=0 WHERE userid=900001`);
                assert.equal(await session.finish(()=>store.revalidateNativeSelectedFingerprint(snapshot)),false);
            }finally{await codes.close();}
        },false,false,true);
        rmSync(sandbox);
        assert.equal(profile.current(),false);
        assert.throws(()=>profile.convert(NativeString.hostUtf8Bytes("iso-8859-1"),pv([255]),{maxInputBytes:10,maxOutputBytes:10}),/changed/);
    }finally{rmSync(directory,{recursive:true,force:true});}
});

test("native selection gates suspended entry/author before body reads and retains window witnesses",async()=>{
    const native=JSON.parse(execFileSync("perl",["-e",`use lib '/workspaces/dreamwidth/cgi-bin';
        use JSON::PP;require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';require LJ::Entry;
        {package VisibilityUser;sub is_inactive{0};sub is_suspended{$_[0]->{status} eq 'S'};}
        {package VisibilityEntry;our @ISA=('LJ::Entry');sub valid{1};sub security{'public'};
        sub journal{bless {},'VisibilityUser'};sub poster{bless {status=>$_[0]->{poster}},'VisibilityUser'};
        sub prop{die 'Unexpected prop' unless $_[1] eq 'statusvis';$_[0]->{entry}};}
        my @out;for my $pair(['V','S'],['S','V'],['X','V'],['V','ordinary']){
        my $entry=bless {poster=>$pair->[0],entry=>$pair->[1]},'VisibilityEntry';
        push @out,$entry->visible_to(undef)?JSON::PP::true:JSON::PP::false;}
        print encode_json(\\@out);`],{encoding:"utf8",timeout:10000}));
    assert.deepEqual(native,[false,false,true,true]);
    await withSelectedFixture(async({admin,store,g,c,table,request,logProp})=>{
        await admin.query(`INSERT INTO ${table(c,"logprop2")} (journalid,jitemid,propid,value)
            VALUES (900001,1,?,'S'),(900001,300,?,'S')`,[logProp("statusvis"),logProp("statusvis")]);
        await admin.query(`UPDATE ${table(c,"log2")} SET posterid=900002 WHERE journalid=900001 AND jitemid=299`);
        await admin.query(`UPDATE ${table(g,"user")} SET statusvis='S' WHERE userid=900002`);
        // Missing text is a read sentinel: loadEntries would reject if any of
        // these hidden IDs reached its lengths/text queries.
        await admin.query(`DELETE FROM ${table(c,"logtext2")} WHERE journalid=900001 AND jitemid IN (1,299,300)`);
        assert.equal(await store.loadNativeSelectedSnapshot(request("ordinary6",{kind:"entry",ditemid:257})),null);
        const recent=await store.loadNativeSelectedSnapshot(request("ordinary6",{kind:"recent",skip:0,itemshow:3}));
        assert.ok(recent);
        assert.deepEqual(recent.facts.entries.map(entry=>entry.jitemid),[298]);
        assert.equal(recent.facts.selection.kind,"recent");
        if(recent.facts.selection.kind==="recent")
            assert.deepEqual(recent.facts.selection.window.slice(0,3).map(entry=>entry.jitemid),[298,299,300]);
        assert.equal(recent.sources.some(cell=>/^entry:(?:1|299|300):(?:subject|event)$/.test(cell.key)),false);
        assert.equal(await store.revalidateNativeSelectedFingerprint(recent),true);
        await admin.query(`UPDATE ${table(g,"user")} SET statusvis='V' WHERE userid=900002`);
        await admin.query(`INSERT INTO ${table(c,"logtext2")} (journalid,jitemid,subject,event)
            VALUES (900001,299,'Visible restored','Visible restored')`);
        assert.equal(await store.revalidateNativeSelectedFingerprint(recent),false);
        const recovery=await store.loadNativeSelectedSnapshot(request("ordinary6",{kind:"recent",skip:0,itemshow:3}));
        assert.ok(recovery);assert.deepEqual(recovery.facts.entries.map(entry=>entry.jitemid),[299,298]);
        await admin.query(`UPDATE ${table(g,"user")} SET statusvis='X',clusterid=0 WHERE userid=900002`);
        const noCluster=await store.loadNativeSelectedSnapshot(request("ordinary6",{kind:"recent",skip:0,itemshow:3}));
        assert.ok(noCluster);assert.deepEqual(noCluster.facts.entries.map(entry=>entry.jitemid),[299,298]);
        assert.equal(noCluster.facts.posters.find(poster=>poster.userid===900002)!.clusterid,0);
        const noConversion={async item():Promise<never>{throw Error("Unreached charset conversion");}} as unknown as GeneralTextEncoding;
        const emptyPictures=await GeneralSelectedText.prepare(noCluster,noConversion);
        const emptyImage=emptyPictures.resolvedPictureImage(900002,999,
            NativeString.hostUtf8Bytes("https://pics.invalid"));
        assert.equal(emptyImage._width,undefined);assert.equal(emptyImage._height,undefined);
        assert.equal((emptyImage._alttext as NativeString).bytes().toString(),"second6: (Default)");
    });
});

test("selected poster pictures retain source bytes, final witnesses and hidden-target no-read",async()=>{
    await withSelectedFixture(async({admin,store,g,c,other,table,request,logProp})=>{
        await admin.query(`UPDATE ${table(c,"log2")} SET posterid=900002 WHERE journalid=900001 AND jitemid=1`);
        await admin.query(`INSERT INTO ${table(other,"userpic2")} (userid,picid,width,height,state,description)
            VALUES (900002,9101,103,97,'N',CONVERT(? USING latin1))`,[Buffer.from([255,60,38])]);
        await admin.query(`UPDATE ${table(g,"user")} SET defaultpicid=9102 WHERE userid=900002`);
        await admin.query(`INSERT INTO ${table(other,"userkeywords")} (userid,kwid,keyword)
            VALUES (900002,1,CONVERT(? USING latin1))`,[Buffer.from([255,38])]);
        await admin.query(`INSERT INTO ${table(other,"userpicmap3")} (userid,mapid,kwid,picid)
            VALUES (900002,1,1,9101)`);
        await admin.query(`INSERT INTO ${table(other,"userpicmap3")} (userid,mapid,kwid,picid,redirect_mapid)
            VALUES (900002,2,NULL,NULL,1),(900002,3,NULL,NULL,4),(900002,4,NULL,NULL,3),
                (900002,5,NULL,9101,NULL)`);
        await admin.query(`INSERT INTO ${table(c,"logprop2")} (journalid,jitemid,propid,value)
            VALUES (900001,1,?,'2')`,[logProp("picture_mapid")]);
        const bound=request("ordinary6",{kind:"entry",ditemid:257});
        const snapshot=await store.loadNativeSelectedSnapshot(bound);assert.ok(snapshot);
        const unreachable={async item():Promise<never>{throw Error("Unreached charset conversion");}} as unknown as GeneralTextEncoding;
        const source=await GeneralSelectedText.prepare(snapshot,unreachable);
        const picture=source.pictureFields(900002,9101)!;
        assert.equal(picture.description!.bytes().toString("hex"),"ff3c26");assert.equal(picture.description!.flagged(),false);
        assert.equal(picture.width,103);assert.equal(picture.height,97);
        const root=NativeString.bytes(Buffer.from("https://pics.invalid"));
        const image=source.resolvedPictureImage(900002,9101,root,NativeString.bytes(Buffer.from("0")),0,50);
        assert.equal((image._url as NativeString).bytes().toString(),"https://pics.invalid/9101/900002");
        assert.equal(image._width,103);assert.equal(image._height,50);
        assert.equal((image._alttext as NativeString).bytes().toString("hex"),
            Buffer.from("second6: ").toString("hex")+"ff266c743b26616d703b"+Buffer.from(" (0)").toString("hex"));
        assert.equal(source.resolvedPictureImage(900002,0,root)[".isnull"],true);
        const keywords=[undefined,pv([255,38]),NativeString.hostUtf8Bytes("pic#9101"),
            NativeString.hostUtf8Bytes("pic#09101"),NativeString.hostUtf8Bytes("pic#9101\n"),
            NativeString.hostUtf8Bytes("pic#9101\n\n"),NativeString.hostUtf8Bytes("unknown"),
            NativeString.flagged(Buffer.from("pic#9101"))];
        const selectedIds=keywords.map(keyword=>source.pictureId(900002,keyword));
        const chosen=selectedIds.map(selected=>{
            return NativeString.is(selected)?selected.bytes().toString():selected;});
        const chosenFlags=selectedIds.map(selected=>NativeString.is(selected)&&selected.flagged()?1:0);
        const mapped=["1","2","3","5","01","999"].map(id=>
            source.pictureMapKeyword(900002,NativeString.hostUtf8Bytes(id))?.bytes().toString("base64")??null);
        const entryPicture=source.entryPicture(snapshot.facts.entries[0]!,root);
        assert.equal(entryPicture.keyword!.bytes().toString("hex"),"ff26");
        assert.equal((entryPicture.image._url as NativeString).bytes().toString(),"https://pics.invalid/9101/900002");
        const oracle=String.raw`use strict;use warnings;no warnings 'once';
use lib '/workspaces/dreamwidth/cgi-bin';use DBI;use JSON::PP;use MIME::Base64 qw(encode_base64);
require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';require LJ::Userpic;require LJ::S2;
my $schema=shift;die 'Isolated schema required' unless $schema=~/\As6_selected_[a-f0-9]{16}_nineteen\z/;
my $db=DBI->connect("DBI:mysql:database=$schema;mysql_socket=/var/run/mysqld/mysqld.sock",'root','',
 {RaiseError=>1,PrintError=>0,mysql_enable_utf8=>0});
$db->do('SET NAMES latin1');$db->do('SET SESSION TRANSACTION READ ONLY');$db->do('START TRANSACTION READ ONLY');
my $u=bless {userid=>900002,user=>'second6',journaltype=>'P',clusterid=>19,statusvis=>'V',defaultpicid=>9102,dversion=>10},'LJ::User';
no warnings 'redefine';local *LJ::load_userid=sub{die 'Unexpected user' unless $_[0]==900002;return $u};
local *DBI::connect=sub{die 'Unplanned DB connection'};local *DBI::connect_cached=sub{die 'Unplanned DB connection'};
local *LJ::Userpic::load_user_userpics=sub{return ()};
local *LJ::User::selectrow_hashref=sub{my($self,$query,@args)=@_;return $db->selectrow_hashref($query,@args)};
my $selected=$db->selectrow_hashref('SELECT picid FROM userpic2 WHERE userid=900002 AND picid=9101');
my $keyword=$db->selectrow_array('SELECT keyword FROM userkeywords WHERE userid=900002 AND kwid=1');
local *LJ::User::get_userpic_info=sub{return {pic=>{9101=>$selected},kw=>{$keyword=>$selected},
 map_redir=>{2=>1,3=>4,4=>3},mapkw=>{1=>$keyword,5=>'pic#9101'}}};
my @mapped=map{my $kw=$u->get_keyword_from_mapid($_);defined($kw)?encode_base64($kw,''):undef} ('1','2','3','5','01','999');
my $flagged='pic#9101';utf8::upgrade($flagged);
my @chosen=map {$u->get_picid_from_keyword($_)} (undef,$keyword,'pic#9101','pic#09101',"pic#9101\n","pic#9101\n\n",'unknown',$flagged);
my @chosen_flags=map {utf8::is_utf8($_)?1:0} @chosen;
my $pic=LJ::Userpic->new($u,9101);my $description=$pic->description;
local $LJ::USERPIC_ROOT='https://pics.invalid';my $image=LJ::S2::Image_userpic($u,9101,'0',0,50);
print encode_json({width=>$pic->width,height=>$pic->height,description=>encode_base64($description,''),
 utf8=>utf8::is_utf8($description)?1:0,chosen=>\@chosen,chosenFlags=>\@chosen_flags,mapped=>\@mapped,image=>{url=>$image->{url},width=>$image->{width},height=>$image->{height},
 alt=>encode_base64($image->{alttext},''),altUtf8=>utf8::is_utf8($image->{alttext})?1:0}});
$db->do('ROLLBACK');$db->disconnect;`;
        assert.deepEqual({width:picture.width,height:picture.height,
            description:picture.description!.bytes().toString("base64"),utf8:picture.description!.flagged()?1:0,
            chosen,chosenFlags,mapped,image:{url:(image._url as NativeString).bytes().toString(),width:image._width,height:image._height,
                alt:(image._alttext as NativeString).bytes().toString("base64"),
                altUtf8:(image._alttext as NativeString).flagged()?1:0}},
            JSON.parse(execFileSync("perl",["-e",oracle,other],{encoding:"utf8",timeout:10000})));
        assert.throws(()=>source.pictureFields(999999,1),/Unselected/);
        assert.equal(await store.revalidateNativeSelectedFingerprint(snapshot),true);
        await admin.query(`UPDATE ${table(other,"userkeywords")} SET keyword='changed' WHERE userid=900002 AND kwid=1`);
        assert.equal(await store.revalidateNativeSelectedFingerprint(snapshot),false);
        await admin.query(`UPDATE ${table(other,"userkeywords")} SET keyword=CONVERT(? USING latin1)
            WHERE userid=900002 AND kwid=1`,[Buffer.from([255,38])]);
        assert.equal(await store.revalidateNativeSelectedFingerprint(snapshot),true);
        await admin.query(`UPDATE ${table(other,"userpic2")} SET description='changed' WHERE userid=900002 AND picid=9101`);
        assert.equal(await store.revalidateNativeSelectedFingerprint(snapshot),false);
        // A missing peer table turns any attempted picture read/engine check into
        // a hard error. Both hidden targets must return before reaching it.
        await admin.query(`DROP TABLE ${table(other,"userpic2")}`);
        // The same author on a private target causes no selected picture source.
        await admin.query(`UPDATE ${table(c,"log2")} SET security='private' WHERE journalid=900001 AND jitemid=1`);
        assert.equal(await store.loadNativeSelectedSnapshot(bound),null);
        await admin.query(`UPDATE ${table(c,"log2")} SET security='public' WHERE journalid=900001 AND jitemid=1`);
        await admin.query(`UPDATE ${table(g,"user")} SET statusvis='S' WHERE userid=900002`);
        assert.equal(await store.loadNativeSelectedSnapshot(bound),null);
    });
});
