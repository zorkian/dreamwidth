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

test("actual public language SELECT-only MyISAM, lazy files and touched reread",()=>withSelectedFixture(async fixture=>{
    const {admin,g,table,startup}=fixture;
    const directory=mkdtempSync(path.join(tmpdir(),"s2-public-language-db-"));
    const file=path.join(directory,"en.dat");
    const key="cleanhtml.error.template";
    const spec={defaultLang:"en",isDevServer:false,languageFiles:[file]};
    const production=new MysqlPublicTranslations(startup.database,spec);
    const dev=new MysqlPublicTranslations(startup.database,{...spec,isDevServer:true});
    const readonly=PrimaryDatabases.create(startup.database);
    try {
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
        assert.equal(await production.revalidate(first),true);
        assert.equal(await production.revalidate({...first}),false);
        await admin.query(`UPDATE ${table(g,"ml_text")} SET text='Changed' WHERE txtid=1`);
        assert.equal(await production.revalidate(first),false);
        assert.equal((await production.snapshot("template")).value.bytes().toString(),"Changed");
        writeFileSync(file,key+"=File [[aopts]]\n");utimesSync(file,1700000000,1700000000);
        const fromFile=await dev.snapshot("template");
        assert.equal(fromFile.value.bytes().toString(),"File [[aopts]]");
        assert.equal(await dev.revalidate(fromFile),true);
        writeFileSync(file,key+"=Edited\n");utimesSync(file,1700000000,1700000000);
        assert.equal(await dev.revalidate(fromFile),false);
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
    }finally{await production.close();await dev.close();await readonly.close();rmSync(directory,{recursive:true,force:true});}
},true));
