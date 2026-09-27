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
import {SUBJECT_TRANSLATION_KEYS,selectPublicTranslation,type SubjectTranslationName,type PublicTranslationFile,type GeneralMlLookup} from "../domain/public-translation";
import {NativeString,hashKeyBytes,caseString} from "../../runtime/native-string";
import type {NativeProfile} from "../../runtime/native-profile";
import {nativeProgramError,isNativeProgramError,legacyText} from "../../runtime/native-scalar";

type TranslationConfiguration=Pick<PlaceholderResolutionSpec,"defaultLang"|"isDevServer"|"languageFiles">;
export interface PublicTranslationSnapshot {
    readonly name:SubjectTranslationName|"standard-image";
    readonly code?:NativeString;
    readonly context?:GeneralMlLookup;
    readonly error?:Error;
    readonly language:string;
    readonly value:NativeString|undefined;
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
        const raw=placeholderFileValue(bytes.toString("latin1"),code,value=>
            caseString(NativeString.bytes(Buffer.from(value,"latin1")),"lower").bytes().toString("latin1"));
        return {value:{modifiedSeconds,value:raw===null?undefined:NativeString.bytes(Buffer.from(raw,"latin1"))},
            witness:{...identity,sha256:sha(bytes)}};
    }finally{closeSync(fd);}
}

/** Only these public language tables use the reviewed nontransactional seam. */
export class MysqlPublicTranslations {
    private readonly issued = new WeakSet<object>();
    private readonly databases:PrimaryDatabases;
    private readonly configuration:TranslationConfiguration;
    private readonly profile:NativeProfile|undefined;
    private readonly profileIdentity:string|undefined;
    constructor(database:ConfiguredDatabase,configuration:TranslationConfiguration,profile?:NativeProfile) {
        this.databases=PrimaryDatabases.create(database);
        this.configuration=structuredClone(configuration);
        this.profile=profile===undefined?undefined:structuredClone(profile);
        this.profileIdentity=this.profile===undefined?undefined:sha(JSON.stringify(this.profile));
    }
    async close():Promise<void> {await this.databases.close();}
    async snapshot(name:SubjectTranslationName):Promise<PublicTranslationSnapshot & {readonly value:NativeString}> {
        if(!Object.hasOwn(SUBJECT_TRANSLATION_KEYS,name))throw new SnapshotError("unavailable");
        const result=await this.snapshotCode(NativeString.hostUtf8Bytes(SUBJECT_TRANSLATION_KEYS[name]),name);
        if(result.error)throw result.error;
        return result as PublicTranslationSnapshot & {readonly value:NativeString};
    }
    /** Parent-selected installed descriptor key, never a child-selected ML code. */
    async snapshotContext(context:GeneralMlLookup):Promise<PublicTranslationSnapshot> {
        return this.snapshotCode(context.kind==="debug"?context.value:context.code,"standard-image",context);
    }
    async snapshotCode(input:NativeString|undefined,name:SubjectTranslationName|"standard-image"="standard-image",
        request?:GeneralMlLookup):Promise<PublicTranslationSnapshot> {
        const code=input===undefined?NativeString.bytes(Buffer.alloc(0)):NativeString.fromFrame(input.frame());
        const originalCode=input===undefined?undefined:code;
        if(code.bytes().length>16384)throw new SnapshotError("unavailable");
        const context=request===undefined?undefined:Object.freeze(request.kind==="debug"?
            {kind:"debug" as const,value:request.value?.clone()}:
            {kind:"lookup" as const,language:request.language?.clone(),defaultLanguage:request.defaultLanguage?.clone(),code:request.code?.clone()});
        const spec=this.configuration,queryCode=code.bytes();
        const language=context?.kind==="lookup"?context.language??NativeString.bytes(Buffer.alloc(0)):NativeString.hostUtf8Bytes(spec.defaultLang);
        const defaultLanguage=context?.kind==="lookup"?context.defaultLanguage??NativeString.bytes(Buffer.alloc(0)):NativeString.hostUtf8Bytes(spec.defaultLang);
        const contextIdentity=context?.kind==="lookup"?{kind:context.kind,language:context.language?.frame()??null,
            defaultLanguage:context.defaultLanguage?.frame()??null}:context?.kind;
        const debug=context===undefined?spec.defaultLang==="debug":context.kind==="debug";
        if(debug) {
            const value=Object.freeze({name,code:originalCode,context,language:legacyText(language),value:originalCode,
                fingerprint:sha(JSON.stringify({spec,name,context:contextIdentity,code:originalCode?.frame()??null}))});this.issued.add(value);return value;
        }
        const lowerCode=caseString(code,"lower",this.profile),fileKey=hashKeyBytes(lowerCode);
        // LangDatFile loads raw-byte hash keys. A wide flagged lookup cannot
        // equal those keys; Latin1 here is only the reversible byte parser view.
        const fileCode=fileKey.utf8?undefined:fileKey.bytes.toString("latin1");
        // MyISAM is native for ml_* public data. This is session READ ONLY;
        // no authorization/identity/content table exemption or writes occur.
        const data=await this.databases.snapshot(undefined,[],async connection=>{
            const languageKey=hashKeyBytes(language);
            const languages=languageKey.utf8?[]:(await sql<SqlRow>`SELECT lnid,lncode FROM ml_langs
                WHERE BINARY lncode=BINARY ${languageKey.bytes} LIMIT 2`.execute(connection)).rows;
            if(languages.length>1)throw new SnapshotError("unavailable");
            const lnid=languages[0]?.lnid;
            if(lnid!==undefined && (typeof lnid!=="number" || !Number.isSafeInteger(lnid) || lnid<1))throw new SnapshotError("unavailable");
            const rows=lnid===undefined?[]:(await sql<SqlRow>`SELECT i.itid,i.itcode,i.visible,l.txtid,
                CAST(l.chgtime AS CHAR) AS chgtime
                FROM ml_items i LEFT JOIN ml_latest l ON l.dmid=1 AND l.itid=i.itid AND l.lnid=${lnid}
                WHERE i.dmid=1 AND i.itcode=${queryCode} LIMIT 2`.execute(connection)).rows;
            if(rows.length>1)throw new SnapshotError("unavailable");
            const fileWitnesses:unknown[]=[];
            function* files():Generator<PublicTranslationFile> {
                for(const filename of spec.languageFiles) {
                    const file=languageFile(filename,fileCode??"",changedSeconds(rows[0]?.chgtime));
                    fileWitnesses.push(file?.witness??{filename,absent:true});
                    if(file)yield fileCode===undefined?{...file.value,value:undefined}:file.value;
                }
            }
            let databaseRows:readonly SqlRow[]|undefined;
            const fromDatabase=async():Promise<NativeString>=>{
                if(lnid===undefined)throw nativeProgramError("Unable to load language code: "+legacyText(language));
                databaseRows=(await sql<SqlRow>`SELECT i.itid,l.txtid,
                    HEX(t.text) AS stored_hex,HEX(CONVERT(t.text USING latin1)) AS recovered_hex,
                    HEX(CONVERT(CONVERT(t.text USING latin1) USING utf8mb4)) AS roundtrip_hex
                    FROM ml_items i LEFT JOIN ml_latest l ON l.dmid=1 AND l.itid=i.itid AND l.lnid=${lnid}
                    LEFT JOIN ml_text t ON t.dmid=1 AND t.txtid=l.txtid
                    WHERE i.dmid=1 AND i.itcode=${lowerCode.bytes()} LIMIT 2`.execute(connection)).rows;
                if(databaseRows.length>1)throw new SnapshotError("unavailable");
                const row=databaseRows[0];
                return row?.stored_hex===null || row?.stored_hex===undefined?NativeString.bytes(Buffer.alloc(0)):
                    NativeString.bytes(decodeLegacyBytes(row.stored_hex,row.recovered_hex,row.roundtrip_hex,262144,65536).originalBytes);
            };
            try {
                const value=await selectPublicTranslation({language,defaultLanguage,mlDebug:false,
                    isDevServer:spec.isDevServer,changedSeconds:changedSeconds(rows[0]?.chgtime),files:files(),fromDatabase},code);
                return {value,error:undefined,languages,rows,databaseRows,fileWitnesses};
            }catch(error) {
                if(!isNativeProgramError(error))throw error;
                // A source semantic failure still depends on the observed
                // public language absence. Retain it for the final reread.
                return {value:undefined,error,languages,rows,databaseRows,fileWitnesses};
            }
        });
        const result=Object.freeze({name,code:originalCode,context,language:legacyText(language),value:data.value,error:data.error,
            fingerprint:sha(JSON.stringify({spec,name,context:contextIdentity,profile:this.profileIdentity,code:originalCode?.frame()??null,languages:data.languages,rows:data.rows,
                databaseRows:data.databaseRows,files:data.fileWitnesses,error:data.error?.message}))});
        this.issued.add(result);return result;
    }
    async revalidate(snapshot:PublicTranslationSnapshot):Promise<boolean> {
        if(!this.issued.has(snapshot))return false;
        return (await this.snapshotCode(snapshot.code,snapshot.name,snapshot.context)).fingerprint===snapshot.fingerprint;
    }
}
