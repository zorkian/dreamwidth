// program-coordinator.ts
//
// Private source compilation and authenticated artifact coordination.
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

import {createHmac,timingSafeEqual} from "node:crypto";
import path from "node:path";
import {ArtifactCompiler,CompilerFailure,sha256,type ActiveStyleSnapshot,
    type CompilationResult,type ProgramArtifact} from "./layer-artifact";
import {checkInstalled,pinInstalled,type InstalledFile} from "./installed-files";
import {ArtifactCache} from "./artifact-cache";
import type {CompilerJobOptions} from "./compiler-queue";
import {programDigest,type ProgramAdmission} from "./program";
import {ABI_VERSION} from "../../runtime/s2runtime";

export interface PreparedProgram {readonly program:ProgramArtifact;}
export interface PrivateProgramTransfer {readonly program:ProgramArtifact;readonly admission:ProgramAdmission;}
const prepared=new WeakSet<object>();
const artifacts=new WeakSet<object>();
export class ProgramCoordinator {
    readonly digest:string;
    private readonly files:readonly InstalledFile[];
    private readonly cache:ArtifactCache;
    constructor(private readonly compiler:ArtifactCompiler,cacheRoot:string) {
        const files=[__filename,path.join(__dirname,"program.js"),
            path.join(__dirname,"layer-artifact.js"),path.join(__dirname,"installed-files.js"),
            path.join(__dirname,"artifact-cache.js"),path.join(__dirname,"compiler-queue.js")];
        this.files=files.map(pinInstalled);
        this.digest=sha256(JSON.stringify([compiler.digest,ABI_VERSION,
            this.files.map(row=>[path.basename(row.file),row.digest])]));
        this.cache=new ArtifactCache(cacheRoot,this);
    }
    private assertInstalled(full=false):void {
        try{checkInstalled(this.files,full);}catch{throw new CompilerFailure();}
    }
    key(snapshot:ActiveStyleSnapshot):string {
        this.assertInstalled();return sha256(JSON.stringify([this.compiler.key(snapshot),this.digest]));
    }
    async prepare(snapshot:ActiveStyleSnapshot,options:CompilerJobOptions={}):Promise<PreparedProgram> {
        const result=await this.cache.getOrCompile(snapshot,options);
        const value=Object.freeze({program:result.program});prepared.add(value);return value;
    }
    transfer(value:PreparedProgram):PrivateProgramTransfer {
        if(!prepared.has(value)||!artifacts.has(value.program)||value.program.compilerDigest!==this.digest)
            throw new CompilerFailure();
        this.assertInstalled();
        return Object.freeze({program:value.program,admission:Object.freeze({abi:ABI_VERSION,
            compilerDigest:this.digest,dependenciesDigest:value.program.dependenciesDigest,
            programDigest:programDigest(value.program),profileDigest:programDigest(value.program.scalarProfile)})});
    }
    async compile(snapshot:ActiveStyleSnapshot,options:CompilerJobOptions={}):Promise<CompilationResult> {
        this.assertInstalled(true);
        const dependenciesDigest=this.key(snapshot);
        const result=await this.compiler.compile(snapshot,options);
        this.assertInstalled(true);
        if(result.kind!=="compiled")throw new CompilerFailure();
        const program:ProgramArtifact={...result.program,compilerDigest:this.digest,dependenciesDigest};
        for(const layer of program.layers)Object.freeze(layer);
        Object.freeze(program.layers);Object.freeze(program);artifacts.add(program);
        return {kind:"compiled",program};
    }
    encode(program:ProgramArtifact,secret:Buffer):string {
        this.assertInstalled(true);
        if(!artifacts.has(program)||program.compilerDigest!==this.digest)throw new CompilerFailure();
        const payload=JSON.stringify(program);
        return JSON.stringify({payload,mac:createHmac("sha256",secret).update(payload).digest("hex")});
    }
    restore(snapshot:ActiveStyleSnapshot,bytes:string,secret:Buffer):ProgramArtifact {
        try {
            this.assertInstalled();const envelope=JSON.parse(bytes);
            if(typeof envelope.payload!=="string"||! /^[a-f0-9]{64}$/.test(envelope.mac))throw new CompilerFailure();
            const expected=createHmac("sha256",secret).update(envelope.payload).digest();
            if(!timingSafeEqual(expected,Buffer.from(envelope.mac,"hex")))throw new CompilerFailure();
            const program:ProgramArtifact=JSON.parse(envelope.payload);
            if(program.schema!==1||program.abi!==ABI_VERSION||program.compilerDigest!==this.digest||
                program.dependenciesDigest!==this.key(snapshot)||
                programDigest(program.scalarProfile)!==programDigest(this.compiler.scalarProfile)||
                !Array.isArray(program.layers)||program.layers.length!==snapshot.layers.length)throw new CompilerFailure();
            for(const [index,row] of program.layers.entries()) {
                const layer=snapshot.layers[index]!;
                if(row.id!==layer.id||row.ownerId!==layer.ownerId||row.parentId!==layer.parentId||
                    row.type!==layer.type||row.untrusted!==(layer.ownerId!==snapshot.systemUserId)||
                    layer.sourceBytes===null||row.sourceSha256!==sha256(layer.sourceBytes)||typeof row.code!=="string"||
                    sha256(row.code)!==row.codeSha256||row.variable!==`layer_${index}`)throw new CompilerFailure();
                Object.freeze(row);
            }
            const freeze=(value:any):void=>{if(value&&typeof value==="object"&&!Object.isFrozen(value)){
                for(const child of Object.values(value))freeze(child);Object.freeze(value);
            }};
            freeze(program);artifacts.add(program);return program;
        }catch{throw new CompilerFailure();}
    }
}
