// general-encoding-profile.ts
//
// Trusted setup issuance and source identity for installed native charset data.
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

import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {lstatSync,realpathSync,readFileSync} from "node:fs";
import path from "node:path";
import type {NativeProfile} from "../../runtime/native-profile";
import {NativeString} from "../../runtime/native-string";
import {loadNativeEncodingProfile,verifyNativeEncodingSources,convertNativeToUtf8,
    type NativeEncodingLimits,type NativeEncodingResult,type NativeEncodingProfile} from "./native-encoding";

interface FileIdentity {path:string;signature:string;sha256:string;}
function hash(bytes:Uint8Array|string):string {return createHash("sha256").update(bytes).digest("hex");}
function signature(file:string):string {
    if(realpathSync(file)!==file)throw Error("Encoding dependency path changed");
    const stat=lstatSync(file,{bigint:true});
    if(!stat.isFile())throw Error("Encoding dependency is not a regular file");
    return [stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].join(":");
}
function fileIdentity(file:string):FileIdentity {
    const canonical=realpathSync(file),before=signature(canonical),sha256=hash(readFileSync(canonical));
    if(signature(canonical)!==before)throw Error("Encoding dependency changed during setup");
    return {path:canonical,signature:before,sha256};
}
export interface NativeEncodingSetup {
    readonly perl:string;
    readonly sandbox:string;
    readonly prlimit:string;
    readonly perlLibrary:string;
}
/** No caller-supplied mapping data becomes a trusted serving profile. */
export class GeneralEncodingProfile {
    readonly identity:string;
    private constructor(private readonly profile:NativeEncodingProfile,
        private readonly files:readonly FileIdentity[],identity:string) {this.identity=identity;}
    static create(options:NativeEncodingSetup,scalar:NativeProfile):GeneralEncodingProfile {
        const producer=fileIdentity(path.resolve(__dirname,"../../../tools/native-encoding-profile.pl"));
        const adapter=fileIdentity(path.join(__dirname,"native-encoding.js"));
        const perl=fileIdentity(options.perl),sandbox=fileIdentity(options.sandbox),prlimit=fileIdentity(options.prlimit);
        const library=realpathSync(options.perlLibrary);
        // The unchanged launcher denies network and closes inherited descriptors.
        // This trusted setup script executes installed extraction code only,
        // with its own sticky DBI tripwire; it receives no stored S2 program.
        const output=execFileSync(prlimit.path,["--cpu=20:20","--as=536870912:536870912",
            "--",sandbox.path,perl.path,producer.path],{
            env:{LANG:"C",LC_ALL:"C",TZ:"UTC",PERL5LIB:library},
            timeout:30000,maxBuffer:16*1024*1024,stdio:["ignore","pipe","ignore"]});
        const raw=JSON.parse(output.toString("utf8"));
        const profile=loadNativeEncodingProfile(raw,scalar);
        const files:FileIdentity[]=[producer,adapter,perl,sandbox,prlimit,fileIdentity(__filename),
            ...["native-string.js","native-scalar.js","native-number.js","native-profile.js"].map(name=>
                fileIdentity(path.resolve(__dirname,"../../runtime",name)))];
        verifyNativeEncodingSources(profile,file=>{
            const identity=fileIdentity(file);
            files.push(identity);
            return readFileSync(identity.path);
        });
        for(const file of files)if(signature(file.path)!==file.signature)throw Error("Encoding dependency changed during setup");
        const identity=hash(JSON.stringify({schema:1,profile:hash(output),scalar:hash(JSON.stringify(scalar)),
            files:files.map(file=>[file.path,file.sha256])}));
        return new GeneralEncodingProfile(profile,Object.freeze(files),identity);
    }
    /** Immutable source identity is checked before conversion and final publication. */
    current():boolean {
        try {return this.files.every(file=>signature(file.path)===file.signature);}
        catch {return false;}
    }
    convert(name:NativeString|undefined,input:NativeString|undefined,
        limits:NativeEncodingLimits):NativeEncodingResult {
        if(!this.current())throw Error("Installed encoding dependencies changed; regenerate setup profile");
        return convertNativeToUtf8(this.profile,name,input,limits);
    }
}
