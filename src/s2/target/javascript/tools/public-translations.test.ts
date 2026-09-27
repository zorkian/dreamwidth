// public-translations.test.ts
//
// Actual SELECT-only public language witnesses and MyISAM qualification.
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
import {mkdtempSync,writeFileSync,utimesSync,rmSync} from "node:fs";
import path from "node:path";
import {tmpdir} from "node:os";
import {sql} from "kysely";
import {withSelectedFixture} from "./selected-fixture";
import {MysqlPublicTranslations} from "../live/data/public-translations";
import {PrimaryDatabases} from "../live/data/primary";
import {NativeString} from "../runtime/native-string";
import {execFileSync} from "node:child_process";
import {GeneralMlRequestContext} from "../live/domain/public-translation";
import {GeneralPublicSession} from "../live/domain/general-public-session";
import {isNativeProgramError} from "../runtime/native-scalar";
import type {NativeProfile} from "../runtime/native-profile";

test("actual public language SELECT-only MyISAM, lazy files and touched reread",()=>withSelectedFixture(async fixture=>{
    const {admin,g,table,startup}=fixture;
    const directory=mkdtempSync(path.join(tmpdir(),"s2-public-language-db-"));
    const file=path.join(directory,"en.dat");
    const key="cleanhtml.error.template";
    const spec={defaultLang:"en",isDevServer:false,languageFiles:[file]};
    const production=new MysqlPublicTranslations(startup.database,spec);
    const dev=new MysqlPublicTranslations(startup.database,{...spec,isDevServer:true});
    const readonly=PrimaryDatabases.create(startup.database);
    const debug=new MysqlPublicTranslations(startup.database,{...spec,defaultLang:"debug"});
    try {
        const debugKeys=[undefined,NativeString.flagged(Buffer.from("é"))];
        const oracle=JSON.parse(execFileSync("perl",["-e",String.raw`
            use strict;use warnings;use JSON::PP;use MIME::Base64 qw(decode_base64 encode_base64);
            BEGIN{require DBI;no warnings 'redefine';*DBI::connect=sub{die 'DB forbidden'};}
            require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';require LJ::Lang;
            no warnings 'redefine';local *LJ::Lang::request_context=sub{{lang=>'debug'}};
            local $/;my $rows=decode_json(<STDIN>);my @out;for my $row(@$rows){
                my $key;if(defined $row){$key=decode_base64($row->{base64});utf8::decode($key) if $row->{utf8};}
                my $value=LJ::Lang::ml($key);if(defined $value){my $flag=utf8::is_utf8($value)?JSON::PP::true:JSON::PP::false;
                    utf8::encode($value) if utf8::is_utf8($value);push @out,{base64=>encode_base64($value,''),utf8=>$flag};}
                else{push @out,undef;}}
            print encode_json(\@out);`],{input:JSON.stringify(debugKeys.map(value=>value===undefined?null:
                {base64:value.bytes().toString("base64"),utf8:value.flagged()})),encoding:"utf8",timeout:10000}));
        const debugValues=[];
        for(const key of debugKeys){const witness=await debug.snapshotCode(key);debugValues.push(witness.value===undefined?null:
            {base64:witness.value.bytes().toString("base64"),utf8:witness.value.flagged()});assert.equal(await debug.revalidate(witness),true);}
        assert.deepEqual(debugValues,oracle);
        const [engine]=await admin.query<import("mysql2/promise").RowDataPacket[]>(
            "SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME='ml_text'",[g]);
        assert.equal(engine[0]!.ENGINE,"MyISAM");
        await admin.query(`INSERT INTO ${table(g,"ml_langs")} (lnid,lncode,lnname,parenttype,parentlnid) VALUES (1,'en','English','diff',0)`);
        await admin.query(`INSERT INTO ${table(g,"ml_items")} (dmid,itid,itcode,visible) VALUES (1,1,?,0)`,[key]);
        await admin.query(`INSERT INTO ${table(g,"ml_text")} (dmid,txtid,lnid,itid,text,userid) VALUES (1,1,1,1,'Database [[aopts]]',900001)`);
        await admin.query(`INSERT INTO ${table(g,"ml_latest")} (lnid,dmid,itid,txtid,chgtime) VALUES (1,1,1,1,'2020-09-13 12:26:40')`);
        writeFileSync(file,"malformed language file");utimesSync(file,1600000000,1600000000);
        const first=await production.snapshot("template");
        assert.equal(first.value.bytes().toString(),"Database [[aopts]]"); // Native production does not parse ignored files.
        // The descriptor comes from trusted setup, never a child-selected key.
        const descriptor=await production.snapshotCode(NativeString.bytes(Buffer.from(key)));
        assert.equal(descriptor.name,"standard-image");
        assert.deepEqual(descriptor.value?.frame(),first.value.frame());
        assert.equal(await production.revalidate(descriptor),true);
        assert.equal(await production.revalidate(first),true);
        assert.equal(await production.revalidate({...first}),false);
        await admin.query(`UPDATE ${table(g,"ml_text")} SET text='Changed' WHERE txtid=1`);
        assert.equal(await production.revalidate(first),false);
        assert.equal(await production.revalidate(descriptor),false);
        assert.equal((await production.snapshot("template")).value.bytes().toString(),"Changed");
        writeFileSync(file,key+"=File [[aopts]]\n");utimesSync(file,1700000000,1700000000);
        const fromFile=await dev.snapshot("template");
        assert.equal(fromFile.value.bytes().toString(),"File [[aopts]]");
        assert.equal(await dev.revalidate(fromFile),true);
        writeFileSync(file,key+"=Edited\n");utimesSync(file,1700000000,1700000000);
        assert.equal(await dev.revalidate(fromFile),false);
        // The native pre-init debug context returns the original key. S2's
        // later merge exposes DEFAULT_LANG='0' and preserves the scope.
        const root=path.resolve("../.."),profile=JSON.parse(execFileSync("perl",
            ["tools/compile-active.pl",root,path.join(root,"S2.pm")],{input:JSON.stringify({profileOnly:true}),
                encoding:"utf8",timeout:10000,maxBuffer:1048576})).profile as NativeProfile;
        const unused={async snapshot():Promise<never>{throw Error("Unreached user");},async revalidate(){return true;}};
        const context=()=>new GeneralMlRequestContext(NativeString.hostUtf8Bytes("0"),
            NativeString.hostUtf8Bytes("debug"),NativeString.hostUtf8Bytes("cleanhtml.error"));
        const phase=new GeneralPublicSession(unused,production,profile,25,undefined,context());
        assert.equal((await phase.imageTranslation(NativeString.hostUtf8Bytes(".template"))).value?.bytes().toString(),".template");
        phase.afterContextInitialization();
        await assert.rejects(phase.imageTranslation(NativeString.hostUtf8Bytes(".template")),isNativeProgramError);
        assert.equal(await phase.finish(async()=>true),true); // Known error retains a rereadable absence witness.
        const changedPhase=new GeneralPublicSession(unused,production,profile,25,undefined,context());
        changedPhase.afterContextInitialization();
        await assert.rejects(changedPhase.imageTranslation(NativeString.hostUtf8Bytes(".template")),isNativeProgramError);
        await admin.query(`INSERT INTO ${table(g,"ml_langs")} (lnid,lncode,lnname,parenttype,parentlnid) VALUES (2,'0','Zero','diff',0)`);
        assert.equal(await changedPhase.finish(async()=>{throw Error("Changed language must precede private authority");}),false);
        // Native tests compare DB mtime before opening/parsing the older file.
        writeFileSync(file,"malformed language file");utimesSync(file,1600000000,1600000000);
        await admin.query(`UPDATE ${table(g,"ml_latest")} SET chgtime='2030-01-01 00:00:00' WHERE itid=1`);
        assert.equal((await dev.snapshot("template")).value.bytes().toString(),"Changed");
        await assert.rejects(readonly.snapshot(undefined,[],async connection=>{
            await sql`UPDATE ml_items SET visible=1 WHERE itid=1`.execute(connection);
        }));
        const [items]=await admin.query<import("mysql2/promise").RowDataPacket[]>(`SELECT visible FROM ${table(g,"ml_items")} WHERE itid=1`);
        assert.equal(items[0]!.visible,0);
        await admin.query(`DROP TABLE ${table(g,"ml_text")}`);
        await assert.rejects(production.snapshot("template")); // Read error is terminal, not an invented label.
        writeFileSync(file,key+"=File without text table\n");utimesSync(file,2100000000,2100000000);
        assert.equal((await dev.snapshot("template")).value.bytes().toString(),"File without text table");
        // File-first success never reaches ml_text; later configured files are not parsed.
        const lazy=new MysqlPublicTranslations(startup.database,{...spec,isDevServer:true,
            languageFiles:[file,path.join(directory,"ignored.dat")]});
        try {
            writeFileSync(path.join(directory,"ignored.dat"),"malformed language file");
            assert.equal((await lazy.snapshot("template")).value.bytes().toString(),"File without text table");
        }finally{await lazy.close();}
    }finally{await production.close();await dev.close();await debug.close();await readonly.close();rmSync(directory,{recursive:true,force:true});}
},true));
