// selected-fixture.ts
//
// Real configured-schema qualification for bounded public page snapshots.
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
import {randomBytes} from "node:crypto";
import mysql from "mysql2/promise";
import {MysqlLiveStore} from "../live/data/mysql";
import {SOURCE_HASHES} from "../live/policy/cohort";
import {capabilities} from "../live/tests/fixtures";
import type {RawPageRequest} from "../live/contracts";
import type {LiveStoreConfig} from "../live/startup-types";

export interface SelectedFixture {
    readonly store: MysqlLiveStore;
    readonly admin: mysql.Connection;
    readonly g: string;
    readonly c: string;
    readonly other: string;
    readonly table: (schema: string,name: string) => string;
    readonly request: (username?: string,page?: RawPageRequest["page"]) => RawPageRequest;
    readonly logProp: (name: string) => number;
    readonly prop: (name: string) => number;
    readonly startup: LiveStoreConfig;
}

const globalTables = ["user","useridmap","userprop","userproplist","s2styles","s2layers",
    "s2compiled","s2source_inno","s2info","logproplist","sysban","secrets"];
const clusterTables = ["userproplite2","userpropblob","s2stylelayers2","log2","logtext2","logprop2",
    "usertags","userkeywords","logtags","logtagsrecent","logkwsum","links","userpic2","talk2"];

export async function withSelectedFixture(run: (fixture: SelectedFixture) => Promise<void>): Promise<void> {
    assert.equal(process.env.LJHOME,"/workspaces/dreamwidth");
    const prefix = "s6_selected_" + randomBytes(8).toString("hex");
    const schemas = [prefix+"_g",prefix+"_seven",prefix+"_nineteen"];
    const created: string[] = [];
    const admin = await mysql.createConnection({socketPath:"/var/run/mysqld/mysqld.sock",user:"root"});
    let store: MysqlLiveStore | undefined;
    const table = (schema: string,name: string) => {
        assert.ok(schemas.includes(schema));
        assert.ok((schema === schemas[0] ? globalTables : clusterTables).includes(name));
        return `\`${schema}\`.\`${name}\``;
    };
    try {
        for (const [index,schema] of schemas.entries()) {
            assert.match(schema,/^s6_selected_[a-f0-9]{16}_(g|seven|nineteen)$/);
            await admin.query(`CREATE DATABASE \`${schema}\``); created.push(schema);
            for (const name of index ? clusterTables : globalTables) {
                const original = index ? "dw_cluster01" : "dw_global";
                await admin.query(`CREATE TABLE ${table(schema,name)} LIKE \`${original}\`.\`${name}\``);
            }
        }
        const g = schemas[0]!, c = schemas[1]!, other = schemas[2]!;
        for (const name of ["userproplist","logproplist"]) {
            await admin.query(`INSERT INTO ${table(g,name)} SELECT * FROM \`dw_global\`.\`${name}\``);
        }
        const [layers] = await admin.query<mysql.RowDataPacket[]>(
            "SELECT s2lid FROM dw_global.s2source_inno WHERE SHA2(s2code,256) IN (?,?)",[...SOURCE_HASHES]);
        assert.equal(layers.length,2);
        const layerIds = layers.map(row => Number(row.s2lid));
        const ids = layerIds.join(",");
        const [system] = await admin.query<mysql.RowDataPacket[]>(
            "SELECT userid FROM dw_global.user WHERE BINARY user=BINARY 'system'");
        assert.equal(system.length,1);
        await admin.query(`INSERT INTO ${table(g,"user")} (userid,user,clusterid,status,statusvis,journaltype,name,
            opt_showtalklinks,opt_whocanreply,opt_forcemoodtheme,moodthemeid,defaultpicid,dversion,caps)
            VALUES (?, 'system',7,'A','V','P','System','Y','all','N',1,NULL,10,2),
                (900001,'ordinary6',7,'A','V','P','Unmarked ordinary','Y','all','N',1,NULL,10,2),
                (900002,'second6',19,'A','V','P','Another ordinary','Y','all','N',1,NULL,10,2)`,[system[0]!.userid]);
        await admin.query(`INSERT INTO ${table(g,"useridmap")} (userid,user) VALUES
            (900001,'ordinary6'),(900002,'second6'),(?,'system')`,[system[0]!.userid]);
        for (const name of ["s2layers","s2source_inno","s2info"]) {
            await admin.query(`INSERT INTO ${table(g,name)} SELECT * FROM \`dw_global\`.\`${name}\` WHERE s2lid IN (${ids})`);
        }
        await admin.query(`INSERT INTO ${table(g,"s2compiled")} (s2lid,comptime)
            SELECT s2lid,comptime FROM dw_global.s2compiled WHERE s2lid IN (${ids})`);
        const [defs] = await admin.query<mysql.RowDataPacket[]>(`SELECT upropid,name FROM ${table(g,"userproplist")}
            WHERE name IN ('stylesys','s2_style','journaltitle')`);
        const prop = (name:string) => Number(defs.find(row => row.name===name)!.upropid);
        await admin.query(`INSERT INTO ${table(g,"s2styles")} (styleid,userid,name,modtime)
            VALUES (44,900001,'Ordinary style without a fixture name',1)`);
        await admin.query(`INSERT INTO ${table(c,"userproplite2")} (userid,upropid,value) VALUES
            (900001,?,'2'),(900001,?,'44')`,[prop("stylesys"),prop("s2_style")]);
        const [layerTypes] = await admin.query<mysql.RowDataPacket[]>(`SELECT s2lid,type FROM ${table(g,"s2layers")} ORDER BY type`);
        for (const row of layerTypes) {
            await admin.query(`INSERT INTO ${table(c,"s2stylelayers2")} (userid,styleid,type,s2lid)
                VALUES (900001,44,?,?)`,[row.type,row.s2lid]);
        }
        const [logDefinitions] = await admin.query<mysql.RowDataPacket[]>(`SELECT propid,name FROM ${table(g,"logproplist")}
            WHERE name IN ('editor','statusvis')`);
        const logProp = (name:string) => Number(logDefinitions.find(row => row.name===name)!.propid);
        const insertEntry = async (schema:string,journal:number,id:number,security:string,eventTime:string,
            event:string|Buffer) => {
            const date = new Date(eventTime.replace(" ","T")+"Z");
            const reverse = 2147483647-Math.floor(date.getTime()/1000);
            await admin.query(`INSERT INTO ${table(schema,"log2")}
                (journalid,jitemid,posterid,eventtime,logtime,compressed,anum,security,allowmask,replycount,
                    year,month,day,rlogtime,revttime) VALUES (?,?,?, ?,?,'N',1,?,0,0,?,?,?,?,?)`,
                [journal,id,journal,eventTime,eventTime,security,date.getUTCFullYear(),date.getUTCMonth()+1,
                    date.getUTCDate(),reverse,reverse]);
            await admin.query(`INSERT INTO ${table(schema,"logtext2")} (journalid,jitemid,subject,event)
                VALUES (?,?,'Plain subject',CONVERT(? USING latin1))`,[journal,id,Buffer.isBuffer(event)?event:Buffer.from(event)]);
            await admin.query(`INSERT INTO ${table(schema,"logprop2")} (journalid,jitemid,propid,value)
                VALUES (?,?,?,'html_raw0')`,[journal,id,logProp("editor")]);
        };
        for (let id=1;id<=300;id++) {
            const seconds = id>=298 ? 300 : id;
            const civil = new Date(Date.UTC(2026,8,26,0,0,seconds)).toISOString().slice(0,19).replace("T"," ");
            await insertEntry(c,900001,id,"public",civil,"Public body "+id);
        }
        for (const [id,security] of [[301,"private"],[302,"usemask"]] as const) {
            await insertEntry(c,900001,id,security,"2026-09-26 00:06:00",Buffer.from([255]));
        }
        await insertEntry(other,900002,300,"public","2026-12-01 00:00:00","Foreign same ID");
        const source = (id:string,database:string,roles:Record<string,number>={}) => ({
            id,database,roles,host:null,port:null,socketPath:"/var/run/mysqld/mysqld.sock",user:"root",password:""});
        const startup: LiveStoreConfig = {database:{defaultDatabase:"livejournal",
            sources:[source("master",g),source("arbitrarySeven",c,{cluster7:3}),
                source("arbitraryActive",other,{cluster19b:1}),source("inactive",c,{cluster19a:100})],
            clusters:[7,19],clusterPairActive:{"19":"b"}},styles:{defaultStyle:{core:"core2",layout:"core2base/layout"},
                layerRemap:{}},maxScrollback:100,capabilities};
        store = await MysqlLiveStore.open(startup);
        const request = (username="ordinary6",page:RawPageRequest["page"]={kind:"recent",skip:0,itemshow:20}):RawPageRequest =>
            ({username,calendarNow:{year:2026,month:9},page});
        await admin.query(`INSERT INTO ${table(g,"secrets")} (stime,secret) VALUES (?,?)`,
            [Math.floor(Date.now()/3600000)*3600,"A".repeat(32)]);
        await run({store,admin,g,c,other,table,request,logProp,prop,startup});
    } finally {
        await store?.close();
        for (const schema of created.reverse()) await admin.query(`DROP DATABASE \`${schema}\``);
        await admin.end();
    }
}

