// program-coordinator.ts
//
// Private source-correspondence and authoritative recovery coordination.
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
import {realpathSync} from "node:fs";
import path from "node:path";
import {spawn} from "node:child_process";
import {ArtifactCompiler,CompilerFailure,sha256,type ActiveStyleSnapshot,type CompilationResult,type DeterministicGap,type ProgramArtifact} from "./layer-artifact";
import {checkInstalled,pinInstalled,type InstalledFile} from "./installed-files";
import {ArtifactCache} from "./artifact-cache";
import {CompilerQueue,CompilerCancelled,type CompilerJobOptions} from "./compiler-queue";
import {programDigest,type ProgramAdmission} from "./program";
import type {RecoveryResult} from "./recovery";
import {ABI_VERSION} from "../../runtime/s2runtime";

export interface RecoveryJobConfiguration {readonly sandbox:string; readonly node?:string; readonly prlimit?:string;}
export interface PreparedProgram {readonly program:ProgramArtifact;}
export interface PrivateProgramTransfer {readonly program:ProgramArtifact;readonly admission:ProgramAdmission;}
export class RecoveryIncomplete extends Error {
    constructor(readonly layerId:number,readonly reason:string){super("Active program recovery unfinished");}
}
const prepared=new WeakSet<object>();
const artifacts=new WeakSet<object>();
const gaps=new WeakSet<object>();
export class ProgramCoordinator {
    readonly digest:string;
    readonly recoveryDigest:string;
    private readonly files:readonly InstalledFile[];
    private readonly entry:string;
    private readonly recoveryRoot:string;
    private readonly sandbox:string; private readonly node:string; private readonly prlimit:string;
    private readonly readable:readonly string[];
    private readonly queue=new CompilerQueue(2,120000);
    private readonly cache:ArtifactCache;
    constructor(private readonly compiler:ArtifactCompiler,cacheRoot:string,job:RecoveryJobConfiguration) {
        this.sandbox=realpathSync(job.sandbox);this.node=realpathSync(job.node??process.execPath);
        this.prlimit=realpathSync(job.prlimit??"/usr/bin/prlimit");
        this.recoveryRoot=realpathSync(path.join(__dirname,"recovery"));
        this.entry=realpathSync(path.join(__dirname,"recover-job.js"));
        const names=["ast.js","lexer.js","parser.js","execute.js","index.js"];
        const packageFile=realpathSync(path.join(__dirname,"../../../package.json"));
        this.readable=[...names.map(name=>realpathSync(path.join(this.recoveryRoot,name))),this.entry,packageFile];
        const files=[...this.readable,this.sandbox,this.node,this.prlimit,
            __filename,path.join(__dirname,"program.js"),path.join(__dirname,"layer-artifact.js"),path.join(__dirname,"installed-files.js"),
            path.join(__dirname,"artifact-cache.js"),path.join(__dirname,"compiler-queue.js")];
        this.files=files.map(pinInstalled);
        this.recoveryDigest=sha256(JSON.stringify(this.files.map(row=>[path.basename(row.file),row.digest])));
        this.digest=sha256(JSON.stringify([compiler.digest,this.recoveryDigest,ABI_VERSION]));
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
        if(result.kind==="gap")throw new RecoveryIncomplete(result.layerId,result.reason);
        if(result.kind!=="compiled")throw new CompilerFailure();
        const value=Object.freeze({program:result.program});prepared.add(value);return value;
    }
    transfer(value:PreparedProgram):PrivateProgramTransfer {
        if(!prepared.has(value)||!artifacts.has(value.program)||value.program.compilerDigest!==this.digest)throw new CompilerFailure();
        this.assertInstalled();
        return Object.freeze({program:value.program,admission:Object.freeze({abi:ABI_VERSION,
            compilerDigest:this.digest,dependenciesDigest:value.program.dependenciesDigest,
            recoveryDigest:this.recoveryDigest,programDigest:programDigest(value.program),
            profileDigest:programDigest(value.program.scalarProfile)})});
    }
    compile(snapshot:ActiveStyleSnapshot,options:CompilerJobOptions={}):Promise<CompilationResult> {
        // Compose the existing <=60s optional proof and <=60s recovery budgets.
        // Queue time counts, and an explicit caller deadline remains an upper bound.
        const serviceEnd=Math.min(Date.now()+120000,options.deadline??Infinity);
        return this.queue.run(async signal=>{
            this.assertInstalled(true);
            const dependenciesDigest=this.key(snapshot);
            let source:CompilationResult;
            let sourceOrigin:"returned"|"service-failure"="returned";
            const proof=new AbortController();let proofExpired=false;
            const cancelProof=()=>proof.abort();signal.addEventListener("abort",cancelProof,{once:true});
            if(signal.aborted)cancelProof();
            // Reserve remaining lifetime for authoritative recovery. This cancels
            // only the optional proof, never the caller/coordinator signal.
            const proofTimer=setTimeout(()=>{proofExpired=true;proof.abort();},
                Math.max(0,Math.min(60000,Math.floor((Math.min(serviceEnd,options.proofDeadline??Infinity)-Date.now())/2))));
            try{source=await this.compiler.compile(snapshot,{signal:proof.signal});}
            catch(error){
                if(signal.aborted)throw new CompilerCancelled();
                if(!(error instanceof CompilerFailure)&&!(proofExpired&&proof.signal.aborted))throw error;
                // An unavailable source-proof job is not active-program authority.
                // Identity/input checks must still pass before recovery is attempted.
                this.compiler.key(snapshot);this.assertInstalled();
                sourceOrigin="service-failure";
                source={kind:"recovery",layerId:snapshot.layers[0]?.id??0,reason:"source-prerequisites"};
            }finally{clearTimeout(proofTimer);signal.removeEventListener("abort",cancelProof);}
            if(signal.aborted)throw new CompilerCancelled();
            let program:ProgramArtifact;
            if(source.kind==="compiled")program={...source.program,compilerDigest:this.digest,
                dependenciesDigest,recoveryDigest:this.recoveryDigest,route:"source"};
            else {
                const results=await this.recover(snapshot,signal);
                // Validate the complete envelope before selecting a negative.
                // A deterministic gap alongside a transient failure is not cached.
                for(const [index,row] of results.entries()) {
                    const layer=snapshot.layers[index]!;
                    if(!row||row.id!==layer.id)throw new CompilerFailure();
                    if(row.kind==="gap") {
                        if(typeof row.reason!=="string"||(row as {deterministic?:unknown}).deterministic!==true)
                            throw new CompilerFailure();
                    }else if(row.kind!=="recovered"||row.abi!==ABI_VERSION||row.activeSha256!==sha256(layer.activeCompiledBytes)||
                        row.variable!=="recovered_layer"||typeof row.code!=="string")throw new CompilerFailure();
                }
                const missing=results.find(row=>row.kind==="gap");
                if(missing?.kind==="gap") {
                    this.assertInstalled(true);this.compiler.key(snapshot);
                    if(signal.aborted)throw new CompilerCancelled();
                    // Recovery syntax can be incomplete while an unhurried source
                    // proof is valid. A transient proof cannot authorize a negative.
                    if(sourceOrigin==="service-failure")throw new RecoveryIncomplete(missing.id,missing.reason);
                    const gap:DeterministicGap=Object.freeze({kind:"gap",deterministic:true,layerId:missing.id,
                        reason:missing.reason,compilerDigest:this.digest,recoveryDigest:this.recoveryDigest,dependenciesDigest});
                    gaps.add(gap);return gap;
                }
                const layers=snapshot.layers.map((layer,index)=>{
                    const row=results[index];
                    if(!row||row.id!==layer.id||row.kind!=="recovered")
                        throw new RecoveryIncomplete(layer.id,row?.kind==="gap"?row.reason:"Missing recovery result");
                    if(row.abi!==ABI_VERSION||row.activeSha256!==sha256(layer.activeCompiledBytes)||row.variable!=="recovered_layer"||typeof row.code!=="string")throw new CompilerFailure();
                    return {id:layer.id,ownerId:layer.ownerId,parentId:layer.parentId,type:layer.type,
                        compiledTime:layer.compiledTime,untrusted:layer.ownerId!==snapshot.systemUserId,
                        sourceSha256:layer.sourceBytes===null?null:sha256(layer.sourceBytes),activeSha256:row.activeSha256,
                        variable:row.variable,code:row.code,codeSha256:sha256(row.code)};
                });
                program={schema:1,abi:ABI_VERSION,compilerDigest:this.digest,dependenciesDigest,
                    recoveryDigest:this.recoveryDigest,route:"recovery",scalarProfile:this.compiler.scalarProfile,layers};
            }
            this.assertInstalled(true);if(signal.aborted)throw new CompilerCancelled();
            for(const layer of program.layers)Object.freeze(layer);
            Object.freeze(program.layers);Object.freeze(program);artifacts.add(program);
            return {kind:"compiled",program};
        },options);
    }
    encode(program:ProgramArtifact,secret:Buffer):string {
        this.assertInstalled(true);
        if(!artifacts.has(program)||program.compilerDigest!==this.digest)throw new CompilerFailure();
        const payload=JSON.stringify(program);
        return JSON.stringify({payload,mac:createHmac("sha256",secret).update(payload).digest("hex")});
    }
    encodeGap(value:DeterministicGap,secret:Buffer):string {
        this.assertInstalled(true);
        if(!gaps.has(value)||value.compilerDigest!==this.digest)throw new CompilerFailure();
        const payload=JSON.stringify(value);
        return JSON.stringify({payload,mac:createHmac("sha256",secret).update(payload).digest("hex")});
    }
    restoreGap(snapshot:ActiveStyleSnapshot,bytes:string,secret:Buffer):DeterministicGap {
        try {
            this.assertInstalled();const envelope=JSON.parse(bytes);
            if(typeof envelope.payload!=="string"||! /^[a-f0-9]{64}$/.test(envelope.mac))throw new CompilerFailure();
            const mac=createHmac("sha256",secret).update(envelope.payload).digest();
            if(!timingSafeEqual(mac,Buffer.from(envelope.mac,"hex")))throw new CompilerFailure();
            const value:DeterministicGap=JSON.parse(envelope.payload);
            if(value.kind!=="gap"||value.deterministic!==true||value.compilerDigest!==this.digest||
                value.recoveryDigest!==this.recoveryDigest||value.dependenciesDigest!==this.key(snapshot)||
                !snapshot.layers.some(layer=>layer.id===value.layerId)||typeof value.reason!=="string")throw new CompilerFailure();
            Object.freeze(value);gaps.add(value);return value;
        }catch{throw new CompilerFailure();}
    }
    restore(snapshot:ActiveStyleSnapshot,bytes:string,secret:Buffer):ProgramArtifact {
        try {
            this.assertInstalled();const envelope=JSON.parse(bytes);
            if(typeof envelope.payload!=="string"||! /^[a-f0-9]{64}$/.test(envelope.mac))throw new CompilerFailure();
            const expected=createHmac("sha256",secret).update(envelope.payload).digest();
            if(!timingSafeEqual(expected,Buffer.from(envelope.mac,"hex")))throw new CompilerFailure();
            const program:ProgramArtifact=JSON.parse(envelope.payload);
            if(program.schema!==1||program.abi!==ABI_VERSION||program.compilerDigest!==this.digest||
                program.recoveryDigest!==this.recoveryDigest||program.dependenciesDigest!==this.key(snapshot)||
                programDigest(program.scalarProfile)!==programDigest(this.compiler.scalarProfile)||
                !["source","recovery"].includes(program.route??"")||!Array.isArray(program.layers)||program.layers.length!==snapshot.layers.length)throw new CompilerFailure();
            for(const [index,row] of program.layers.entries()) {
                const layer=snapshot.layers[index]!;
                if(row.id!==layer.id||row.ownerId!==layer.ownerId||row.parentId!==layer.parentId||row.type!==layer.type||
                    row.compiledTime!==layer.compiledTime||row.untrusted!==(layer.ownerId!==snapshot.systemUserId)||
                    row.sourceSha256!==(layer.sourceBytes===null?null:sha256(layer.sourceBytes))||
                    row.activeSha256!==sha256(layer.activeCompiledBytes)||typeof row.code!=="string"||sha256(row.code)!==row.codeSha256||
                    !/^(?:layer_[0-9]+|recovered_layer)$/.test(row.variable))throw new CompilerFailure();
                Object.freeze(row);
            }
            const freeze=(value:any):void=>{if(value&&typeof value==="object"&&!Object.isFrozen(value)){
                for(const child of Object.values(value))freeze(child);Object.freeze(value);
            }};
            freeze(program);artifacts.add(program);return program;
        }catch{throw new CompilerFailure();}
    }
    private recover(snapshot:ActiveStyleSnapshot,signal:AbortSignal):Promise<RecoveryResult[]> {
        // Parsing/lowering only. No active Perl or emitted JS executes here.
        return new Promise((resolve,reject)=>{
            const child=spawn(this.prlimit,["--cpu=60","--",this.sandbox,this.node,
                "--permission","--no-addons","--disable-proto=throw",
                "--max-old-space-size=512",...this.readable.map(file=>"--allow-fs-read="+file),this.entry],{shell:false,cwd:"/",env:{LANG:"C",TZ:"UTC"},stdio:["pipe","pipe","ignore"]});
            let done=false;let failed=false;let size=0;const chunks:Buffer[]=[];
            const fail=()=>{if(!done){failed=true;child.kill("SIGKILL");}};
            signal.addEventListener("abort",fail,{once:true});if(signal.aborted)fail();
            const timer=setTimeout(fail,60000);
            child.once("error",fail);child.stdin.once("error",fail);
            child.stdout.on("data",(chunk:Buffer)=>{if(failed)return;size+=chunk.length;if(size>134217728)fail();else chunks.push(chunk);});
            child.once("close",code=>{
                clearTimeout(timer);signal.removeEventListener("abort",fail);if(done)return;done=true;
                if(failed||code!==0){reject(signal.aborted?new CompilerCancelled():new CompilerFailure());return;}
                try{const result=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks)));
                    if(!Array.isArray(result)||result.length!==snapshot.layers.length)throw new CompilerFailure();resolve(result);
                }catch{reject(new CompilerFailure());}
            });
            child.stdin.end(JSON.stringify({abi:ABI_VERSION,layers:snapshot.layers.map(layer=>({
                id:layer.id,ownerId:layer.ownerId,systemUserId:snapshot.systemUserId,parentId:layer.parentId,type:layer.type,
                activeBase64:Buffer.from(layer.activeCompiledBytes).toString("base64")}))}));
        });
    }
}
