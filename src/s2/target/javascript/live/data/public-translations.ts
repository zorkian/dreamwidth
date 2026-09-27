// public-translations.ts
//
// SELECT-only public cleaner translations and touched dependency witnesses.
//
// Portions adapted from LJ/S2.pm and LJ/User/Account.pm, forked from the
// LiveJournal project owned and operated by Live Journal, Inc., and modified
// and expanded by Dreamwidth Studios, LLC. The original license is available at:
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
// In accordance with that license, this code and its modifications are provided
// under the GNU General Public License. See LICENSE in this distribution.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.
// The inherited notice above applies to adapted LiveJournal portions.
//

import {createHash} from "node:crypto";
import {openSync,closeSync,fstatSync,statSync,readSync,constants} from "node:fs";
import {sql} from "kysely";
import {PrimaryDatabases,type SqlRow} from "./primary";
import {SnapshotError} from "./errors";
import {decodeLegacyBytes} from "./legacy-text";
import type {ConfiguredDatabase} from "../startup-types";
import type {PlaceholderResolutionSpec} from "../contracts";
import {placeholderFileValue} from "../domain/placeholder";
import {SUBJECT_TRANSLATION_KEYS,selectPublicTranslation,type SubjectTranslationName,type PublicTranslationFile} from "../domain/public-translation";
import {NativeString} from "../../runtime/native-string";
import {nativeProgramError} from "../../runtime/native-scalar";

type TranslationConfiguration=Pick<PlaceholderResolutionSpec,"defaultLang"|"isDevServer"|"languageFiles">;
export interface PublicTranslationSnapshot {
    readonly name:SubjectTranslationName;
    readonly language:string;
    readonly value:NativeString;
    readonly fingerprint:string;
}
const sha=(value:Uint8Array|string)=>createHash("sha256").update(value).digest("hex");
const maxLanguageFileBytes=16*1024*1024;
function changedSeconds(value:unknown):number {
    if(value===null || value===undefined || value==="0000-00-00 00:00:00")return 0;
    if(typeof value!=="string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value))throw new SnapshotError("unavailable");
    const parts=value.match(/\d+/g)!.map(Number);
    // LJ::mysqldate_to_time defaults timelocal, including the native host TZ.
    const time=new Date(parts[0]!,parts[1]!-1,parts[2]!,parts[3]!,parts[4]!,parts[5]!);
    if(time.getFullYear()!==parts[0] || time.getMonth()!==parts[1]!-1 || time.getDate()!==parts[2] ||
        time.getHours()!==parts[3] || time.getMinutes()!==parts[4] || time.getSeconds()!==parts[5])throw new SnapshotError("unavailable");
    return time.getTime()/1000;
}
function languageFile(filename:string,code:string,changed:number):{value:PublicTranslationFile;witness:unknown}|undefined {
    // Native compares mtime before constructing LangDatFile. An older malformed
    // or unreadable file must not prevent the authoritative DB value rendering.
    let info;
    try {info=statSync(filename,{bigint:true});}
    catch(error) {if((error as NodeJS.ErrnoException).code==="ENOENT")return undefined;throw new SnapshotError("unavailable");}
    const modifiedSeconds=Number(info.mtimeNs/1000000000n);
    const identity={filename,dev:String(info.dev),ino:String(info.ino),size:String(info.size),
        mtimeNs:String(info.mtimeNs),ctimeNs:String(info.ctimeNs)};
    if(!modifiedSeconds || changed>modifiedSeconds)return {value:{modifiedSeconds,value:undefined},witness:identity};
    let fd:number;
    try {fd=openSync(filename,constants.O_RDONLY|constants.O_NONBLOCK);}
    catch(error) {if((error as NodeJS.ErrnoException).code==="ENOENT")return undefined;throw new SnapshotError("unavailable");}
    try {
        const before=fstatSync(fd,{bigint:true});
        if(before.dev!==info.dev || before.ino!==info.ino || before.size!==info.size ||
            before.mtimeNs!==info.mtimeNs || before.ctimeNs!==info.ctimeNs)throw new SnapshotError("unavailable");
        if(!before.isFile() || before.size>BigInt(maxLanguageFileBytes))throw new SnapshotError("unavailable");
        const buffer=Buffer.alloc(maxLanguageFileBytes+1);
        let size=0;
        while(size<buffer.length) {
            const count=readSync(fd,buffer,size,buffer.length-size,null);
            if(!count)break;
            size+=count;
        }
        const bytes=buffer.subarray(0,size);
        const after=fstatSync(fd,{bigint:true});
        if(bytes.length>maxLanguageFileBytes || before.dev!==after.dev || before.ino!==after.ino ||
            before.size!==after.size || before.mtimeNs!==after.mtimeNs || before.ctimeNs!==after.ctimeNs ||
            BigInt(bytes.length)!==after.size)throw new SnapshotError("unavailable");
        // LangDatFile opens raw bytes. Latin1 is solely a reversible parser
        // view here; output is reconstructed as octets, never UTF8 reencoded.
        const raw=placeholderFileValue(bytes.toString("latin1"),code);
        return {value:{modifiedSeconds,value:raw===null?undefined:NativeString.bytes(Buffer.from(raw,"latin1"))},
            witness:{...identity,sha256:sha(bytes)}};
    }finally{closeSync(fd);}
}

/** Only these public language tables use the reviewed nontransactional seam. */
export class MysqlPublicTranslations {
    private readonly issued = new WeakSet<object>();
    private readonly databases:PrimaryDatabases;
    private readonly configuration:TranslationConfiguration;
    constructor(database:ConfiguredDatabase,configuration:TranslationConfiguration) {
        this.databases=PrimaryDatabases.create(database);
        this.configuration=structuredClone(configuration);
    }
    async close():Promise<void> {await this.databases.close();}
    async snapshot(name:SubjectTranslationName):Promise<PublicTranslationSnapshot> {
        if(!Object.hasOwn(SUBJECT_TRANSLATION_KEYS,name))throw new SnapshotError("unavailable");
        const code=SUBJECT_TRANSLATION_KEYS[name],spec=this.configuration;
        if(spec.defaultLang==="debug") {
            const value=Object.freeze({name,language:spec.defaultLang,value:NativeString.hostUtf8Bytes(code),
                fingerprint:sha(JSON.stringify({spec,name}))});this.issued.add(value);return value;
        }
        // MyISAM is native for ml_* public data. This is session READ ONLY;
        // no authorization/identity/content table exemption or writes occur.
        const data=await this.databases.snapshot(undefined,[],async connection=>{
            const languages=(await sql<SqlRow>`SELECT lnid,lncode FROM ml_langs
                WHERE BINARY lncode=BINARY ${spec.defaultLang} LIMIT 2`.execute(connection)).rows;
            if(languages.length>1)throw new SnapshotError("unavailable");
            const lnid=languages[0]?.lnid;
            if(lnid!==undefined && (typeof lnid!=="number" || !Number.isSafeInteger(lnid) || lnid<1))throw new SnapshotError("unavailable");
            const rows=lnid===undefined?[]:(await sql<SqlRow>`SELECT i.itid,i.itcode,i.visible,l.txtid,
                CAST(l.chgtime AS CHAR) AS chgtime
                FROM ml_items i LEFT JOIN ml_latest l ON l.dmid=1 AND l.itid=i.itid AND l.lnid=${lnid}
                WHERE i.dmid=1 AND i.itcode=${code} LIMIT 2`.execute(connection)).rows;
            if(rows.length>1)throw new SnapshotError("unavailable");
            const fileWitnesses:unknown[]=[];
            function* files():Generator<PublicTranslationFile> {
                for(const filename of spec.languageFiles) {
                    const file=languageFile(filename,code,changedSeconds(rows[0]?.chgtime));
                    fileWitnesses.push(file?.witness??{filename,absent:true});
                    if(file)yield file.value;
                }
            }
            let databaseRows:readonly SqlRow[]|undefined;
            const fromDatabase=async():Promise<NativeString>=>{
                if(lnid===undefined)throw nativeProgramError("Unable to load language code: "+spec.defaultLang);
                databaseRows=(await sql<SqlRow>`SELECT i.itid,l.txtid,
                    HEX(t.text) AS stored_hex,HEX(CONVERT(t.text USING latin1)) AS recovered_hex,
                    HEX(CONVERT(CONVERT(t.text USING latin1) USING utf8mb4)) AS roundtrip_hex
                    FROM ml_items i LEFT JOIN ml_latest l ON l.dmid=1 AND l.itid=i.itid AND l.lnid=${lnid}
                    LEFT JOIN ml_text t ON t.dmid=1 AND t.txtid=l.txtid
                    WHERE i.dmid=1 AND i.itcode=${code} LIMIT 2`.execute(connection)).rows;
                if(databaseRows.length>1)throw new SnapshotError("unavailable");
                const row=databaseRows[0];
                return row?.stored_hex===null || row?.stored_hex===undefined?NativeString.bytes(Buffer.alloc(0)):
                    NativeString.bytes(decodeLegacyBytes(row.stored_hex,row.recovered_hex,row.roundtrip_hex,262144,65536).originalBytes);
            };
            const value=await selectPublicTranslation({language:spec.defaultLang,defaultLanguage:spec.defaultLang,
                isDevServer:spec.isDevServer,changedSeconds:changedSeconds(rows[0]?.chgtime),files:files(),fromDatabase},code);
            return {value,languages,rows,databaseRows,fileWitnesses};
        });
        const result=Object.freeze({name,language:spec.defaultLang,value:data.value,
            fingerprint:sha(JSON.stringify({spec,name,languages:data.languages,rows:data.rows,
                databaseRows:data.databaseRows,files:data.fileWitnesses}))});
        this.issued.add(result);return result;
    }
    async revalidate(snapshot:PublicTranslationSnapshot):Promise<boolean> {
        if(!this.issued.has(snapshot))return false;
        return (await this.snapshot(snapshot.name)).fingerprint===snapshot.fingerprint;
    }
}
