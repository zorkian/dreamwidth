// layer-artifact.ts
//
// General source-proven S2 programs and credential-free compiler jobs.
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
import {createHash, createHmac, timingSafeEqual} from "node:crypto";
import {spawn} from "node:child_process";
import {readFileSync, readdirSync, lstatSync, realpathSync} from "node:fs";
import path from "node:path";
import {ABI_VERSION, Layer, s2} from "../../runtime/s2runtime";

export type LayerType = "core" | "i18nc" | "layout" | "i18n" | "theme" | "user";
export interface ActiveLayerInput {
    readonly id:number; readonly ownerId:number; readonly parentId:number; readonly type:LayerType;
    readonly sourceBytes:Uint8Array|null;
    // Exactly decoded/decompressed authoritative compdata, not its SQL encoding.
    readonly activeCompiledBytes:Uint8Array; readonly compiledTime:number;
}
export interface ActiveStyleSnapshot {
    readonly styleId:number; readonly systemUserId:number; readonly layers:readonly ActiveLayerInput[];
}
export interface LayerIdentity {
    readonly id:number; readonly ownerId:number; readonly parentId:number; readonly type:LayerType;
    readonly compiledTime:number; readonly untrusted:boolean;
    readonly sourceSha256:string|null; readonly activeSha256:string;
}
export interface CompiledLayer extends LayerIdentity {
    readonly variable:string; readonly code:string; readonly codeSha256:string;
}
export interface ProgramArtifact {
    readonly schema:1; readonly abi:number; readonly compilerDigest:string;
    readonly dependenciesDigest:string; readonly layers:readonly CompiledLayer[];
}
export interface RecoveryDependency {
    readonly kind:"recovery"; readonly layerId:number;
    readonly reason:"missing-source"|"active-source-correspondence";
}
export type CompilationResult = {readonly kind:"compiled";readonly program:ProgramArtifact}|RecoveryDependency;
export interface CompilerConfig {
    readonly s2Root:string; readonly perl:string; readonly isolationExecutable:string;
    readonly timeoutMs?:number; readonly maxOutputBytes?:number;
}
interface WireLayer extends LayerIdentity {sourceBase64:string|null;activeBase64:string}
interface Capture {styleId:number;systemUserId:number;layers:WireLayer[]}
interface JobResult {kind:string;layerId?:number;reason?:string;layers?:{id:number;variable:string;code:string}[]}
const issued = new WeakSet<object>();
export const sha256 = (bytes:Uint8Array|string):string => createHash("sha256").update(bytes).digest("hex");
export class CompilerFailure extends Error {
    constructor() {super("S2 compiler unavailable");}
}
function integer(value:number,min=0):boolean {return Number.isSafeInteger(value)&&value>=min&&value<=4294967295;}
function capture(snapshot:ActiveStyleSnapshot):Capture {
    if (!integer(snapshot.styleId)||!integer(snapshot.systemUserId,1)||!snapshot.layers.length) throw new CompilerFailure();
    let total=0;
    const ids=new Set<number>();
    const types=new Set<LayerType>();
    const order:LayerType[]=["core","i18nc","layout","i18n","theme","user"];
    let previous=-1;
    const layers=snapshot.layers.map(layer=> {
        const rank=order.indexOf(layer.type);
        if(!integer(layer.id,1)||!integer(layer.ownerId,1)||!integer(layer.parentId)||
            !integer(layer.compiledTime)||rank<=previous||ids.has(layer.id)||types.has(layer.type)) throw new CompilerFailure();
        if(layer.type==="core" ? layer.parentId!==0 : !ids.has(layer.parentId)) throw new CompilerFailure();
        previous=rank;ids.add(layer.id);types.add(layer.type);
        const source=layer.sourceBytes===null?null:Buffer.from(layer.sourceBytes);
        const active=Buffer.from(layer.activeCompiledBytes);
        // MEDIUMBLOB capacity, plus a separate cumulative compiler-job budget.
        if((source?.length??0)>16777215||active.length>16777215||!active.length) throw new CompilerFailure();
        total+=(source?.length??0)+active.length;
        if(total>67108864)throw new CompilerFailure();
        return {id:layer.id,ownerId:layer.ownerId,parentId:layer.parentId,type:layer.type,
            compiledTime:layer.compiledTime,untrusted:layer.ownerId!==snapshot.systemUserId,
            sourceSha256:source===null?null:sha256(source),activeSha256:sha256(active),
            sourceBase64:source===null?null:source.toString("base64"),activeBase64:active.toString("base64")};
    });
    if(layers[0]?.type!=="core")throw new CompilerFailure();
    return {styleId:snapshot.styleId,systemUserId:snapshot.systemUserId,layers};
}
function freezeProgram(program:ProgramArtifact):ProgramArtifact {
    for(const layer of program.layers)Object.freeze(layer);
    Object.freeze(program.layers);Object.freeze(program);issued.add(program);return program;
}
export function instantiateProgram(program:ProgramArtifact):Layer[] {
    if(!issued.has(program))throw new CompilerFailure();
    // Only locally compiled/recovered and authenticated programs reach this point.
    // Instantiation belongs in the credential-free renderer, not the DB parent.
    return program.layers.map(item=> {
        const layer=new Function("s2",`"use strict";\n${item.code}\nreturn ${item.variable};`)(s2);
        if(!(layer instanceof Layer))throw new CompilerFailure();
        layer.source=`active-layer:${item.id}`;return layer;
    });
}
export class ArtifactCompiler {
    readonly digest:string;
    private readonly script:string;
    private readonly root:string;
    private readonly perl:string;
    private readonly isolation:string;
    private readonly dependencies:readonly {file:string;digest:string}[];
    private running = 0;
    constructor(private readonly config:CompilerConfig) {
        this.root=realpathSync(config.s2Root);
        this.script=path.join(this.root,"target/javascript/tools/compile-active.pl");
        this.perl=realpathSync(config.perl);this.isolation=realpathSync(config.isolationExecutable);
        const files:string[]=[];
        const walk=(directory:string):void=> {
            for(const name of readdirSync(directory).sort()) {
                const file=path.join(directory,name);const stat=lstatSync(file);
                if(stat.isSymbolicLink())throw new CompilerFailure();
                if(stat.isDirectory())walk(file);else if(stat.isFile()&&name.endsWith(".pm"))files.push(file);
            }
        };
        walk(path.join(this.root,"S2"));
        files.push(path.join(this.root,"S2.pm"),this.script,
            path.join(this.root,"target/javascript/runtime/s2runtime.ts"),this.perl,this.isolation);
        this.dependencies=files.map(file=>({file,digest:sha256(readFileSync(file))}));
        this.digest=sha256(JSON.stringify({abi:ABI_VERSION,files:this.dependencies.map(({file,digest})=>[
            file.startsWith(this.root+path.sep)?path.relative(this.root,file):path.basename(file),digest])}));
    }
    private assertDependencies():void {
        for(const dependency of this.dependencies) {
            if(sha256(readFileSync(dependency.file))!==dependency.digest)throw new CompilerFailure();
        }
    }
    key(snapshot:ActiveStyleSnapshot):string {this.assertDependencies();return this.keyFor(capture(snapshot));}
    private keyFor(input:Capture):string {
        const {layers,...rest}=input;
        return sha256(JSON.stringify({schema:1,abi:ABI_VERSION,compiler:this.digest,...rest,
            layers:layers.map(({sourceBase64,activeBase64,...identity})=>identity)}));
    }
    async compile(snapshot:ActiveStyleSnapshot):Promise<CompilationResult> {
        this.assertDependencies();
        const input=capture(snapshot);const key=this.keyFor(input);
        const missing=input.layers.find(layer=>layer.sourceBase64===null);
        if(missing)return {kind:"recovery",layerId:missing.id,reason:"missing-source"};
        const result=await this.job(input);
        this.assertDependencies();
        if(result.kind==="recovery") {
            if(typeof result.layerId!=="number"||!input.layers.some(layer=>layer.id===result.layerId)||result.reason!=="active-source-correspondence")throw new CompilerFailure();
            return {kind:"recovery",layerId:result.layerId,reason:result.reason};
        }
        if(result.kind!=="compiled"||!Array.isArray(result.layers)||result.layers.length!==input.layers.length)throw new CompilerFailure();
        const layers=input.layers.map(({sourceBase64,activeBase64,...identity},index)=> {
                const emitted=result.layers![index];
            if(!emitted||emitted.id!==identity.id||emitted.variable!==`layer_${index}`||typeof emitted.code!=="string"||!emitted.code)throw new CompilerFailure();
            return {...identity,variable:emitted.variable,code:emitted.code,codeSha256:sha256(emitted.code)};
        });
        return {kind:"compiled",program:freezeProgram({schema:1,abi:ABI_VERSION,compilerDigest:this.digest,
            dependenciesDigest:key,layers})};
    }
    // Cache authentication is issued by the private local producer root. A caller
    // cannot import a plain artifact or bless it with its own code/source hashes.
    encode(program:ProgramArtifact,secret:Buffer):string {
        if(!issued.has(program)||program.compilerDigest!==this.digest)throw new CompilerFailure();
        const payload=JSON.stringify(program);
        return JSON.stringify({payload,mac:createHmac("sha256",secret).update(payload).digest("hex")});
    }
    restore(snapshot:ActiveStyleSnapshot,bytes:string,secret:Buffer):ProgramArtifact {
        try {
            const envelope=JSON.parse(bytes);
            if(typeof envelope.payload!=="string"||! /^[0-9a-f]{64}$/.test(envelope.mac))throw new CompilerFailure();
            const expected=createHmac("sha256",secret).update(envelope.payload).digest();
            if(!timingSafeEqual(expected,Buffer.from(envelope.mac,"hex")))throw new CompilerFailure();
            const program:ProgramArtifact=JSON.parse(envelope.payload);
            if(program.schema!==1||program.abi!==ABI_VERSION||program.compilerDigest!==this.digest||
                program.dependenciesDigest!==this.key(snapshot)||!Array.isArray(program.layers)||
                program.layers.length!==snapshot.layers.length)throw new CompilerFailure();
            for(const [index,layer] of program.layers.entries()) {
                if(layer.id!==snapshot.layers[index]!.id||typeof layer.code!=="string"||
                    layer.variable!==`layer_${index}`||sha256(layer.code)!==layer.codeSha256)throw new CompilerFailure();
            }
            return freezeProgram(program);
        }catch{throw new CompilerFailure();}
    }
    private job(input:Capture):Promise<JobResult> {
        // Compilation has a separate one-GiB per-job address-space budget. Two
        // simultaneous jobs bound aggregate allocation; busy is retryable, never
        // a permanent Unsupported classification of the selected S2 program.
        if (this.running >= 2) return Promise.reject(new CompilerFailure());
        this.running++;
        return new Promise((resolve,reject)=> {
            const child=spawn(this.isolation,[this.perl,this.script,path.join(this.root,"S2"),path.join(this.root,"S2.pm")],
                {cwd:"/",env:{LANG:"C",TZ:"UTC"},stdio:["pipe","pipe","ignore"]});
            let size=0;const chunks:Buffer[]=[];let done=false;
            const fail=():void=> {if(!done){done=true;reject(new CompilerFailure());}child.kill("SIGKILL");};
            const timer=setTimeout(fail,this.config.timeoutMs??60000);
            child.once("error",fail);child.stdin.once("error",fail);
            child.stdout.on("data",(chunk:Buffer)=> {size+=chunk.length;if(size>(this.config.maxOutputBytes??67108864))fail();else chunks.push(chunk);});
            child.once("close",code=> {
                this.running--;
                clearTimeout(timer);if(done)return;done=true;
                if(code!==0||!size){reject(new CompilerFailure());return;}
                try{resolve(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks))));}
                catch{reject(new CompilerFailure());}
            });
            child.stdin.end(JSON.stringify(input));
        });
    }
}
