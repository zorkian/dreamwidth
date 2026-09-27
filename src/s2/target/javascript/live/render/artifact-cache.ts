// artifact-cache.ts
//
// Private, authenticated local cache of general compiled S2 programs.
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
import {randomBytes} from "node:crypto";
import {constants, lstatSync, fstatSync, mkdirSync, mkdtempSync, openSync, readFileSync,
    closeSync, writeFileSync, renameSync, rmSync, realpathSync} from "node:fs";
import path from "node:path";
import {CompilerFailure, type ActiveStyleSnapshot, type CompilationResult,type DeterministicGap, type ProgramArtifact} from "./layer-artifact";
import {CompilerCancelled,type CompilerJobOptions} from "./compiler-queue";

export interface ArtifactProducer {
    key(snapshot:ActiveStyleSnapshot):string;
    compile(snapshot:ActiveStyleSnapshot,options?:CompilerJobOptions):Promise<CompilationResult>;
    encode(program:ProgramArtifact,secret:Buffer):string;
    restore(snapshot:ActiveStyleSnapshot,bytes:string,secret:Buffer):ProgramArtifact;
    encodeGap?(result:DeterministicGap,secret:Buffer):string;
    restoreGap?(snapshot:ActiveStyleSnapshot,bytes:string,secret:Buffer):DeterministicGap;
}
interface Pending {promise:Promise<CompilationResult>;controller:AbortController;waiters:number;}
class CacheSizeMiss extends Error {}

export class ArtifactCache {
    private readonly root:string;
    private readonly secret:Buffer;
    private readonly pending=new Map<string,Pending>();
    constructor(root:string,private readonly compiler:ArtifactProducer) {
        if(!path.isAbsolute(root))throw new CompilerFailure();
        try{mkdirSync(root,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST")throw new CompilerFailure();}
        const stat=lstatSync(root);
        if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o777)!==0o700||stat.uid!==process.getuid?.())throw new CompilerFailure();
        this.root=realpathSync(root);
        const key=path.join(this.root,"producer-key");
        try{writeFileSync(key,randomBytes(32),{mode:0o600,flag:"wx"});}
        catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST")throw new CompilerFailure();}
        this.secret=this.read(key,32);
        if(this.secret.length!==32)throw new CompilerFailure();
    }
    private read(file:string,max:number):Buffer {
        let fd:number|undefined;
        try{
            const stat=lstatSync(file);
            if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.uid!==process.getuid?.()||
                (stat.mode&0o777)!==0o600)throw new CompilerFailure();
            fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);
            const opened=fstatSync(fd);
            if(opened.ino!==stat.ino||opened.dev!==stat.dev||!opened.isFile()||opened.nlink!==1||
                opened.uid!==stat.uid||opened.mode!==stat.mode)throw new CompilerFailure();
            if(opened.size>max)throw new CacheSizeMiss();
            return readFileSync(fd);
        }catch(error){
            if(error instanceof CacheSizeMiss||(error as NodeJS.ErrnoException).code==="ENOENT")throw error;
            throw new CompilerFailure();
        }finally{if(fd!==undefined)closeSync(fd);}
    }
    getOrCompile(snapshot:ActiveStyleSnapshot,options:CompilerJobOptions={}):Promise<CompilationResult> {
        if(options.signal?.aborted||options.deadline!==undefined&&options.deadline<=Date.now())
            return Promise.reject(new CompilerCancelled());
        const captured:ActiveStyleSnapshot={styleId:snapshot.styleId,systemUserId:snapshot.systemUserId,
            layers:snapshot.layers.map(layer=>({...layer,sourceBytes:layer.sourceBytes===null?null:Buffer.from(layer.sourceBytes),
                activeCompiledBytes:Buffer.from(layer.activeCompiledBytes)}))};
        const key=this.compiler.key(captured);
        let pending=this.pending.get(key);
        if(!pending){
            const controller=new AbortController();
            // The first waiter's deadline can shorten optional source proof.
            // Its cancellation cannot expire a surviving coalesced waiter.
            pending={controller,waiters:0,promise:this.loadOrCompile(captured,key,controller.signal,options.deadline)};
            this.pending.set(key,pending);
            const item=pending;
            void item.promise.finally(()=>{if(this.pending.get(key)===item)this.pending.delete(key);}).catch(()=>{});
        }
        const item=pending;item.waiters++;
        return new Promise((resolve,reject)=>{
            let done=false;let timer:ReturnType<typeof setTimeout>|undefined;
            const cleanup=()=>{
                if(timer)clearTimeout(timer);options.signal?.removeEventListener("abort",cancel);
                item.waiters--;if(!item.waiters&&this.pending.get(key)===item){
                    this.pending.delete(key);item.controller.abort();
                }
            };
            const cancel=()=>{if(!done){done=true;cleanup();reject(new CompilerCancelled());}};
            options.signal?.addEventListener("abort",cancel,{once:true});
            if(options.deadline!==undefined)timer=setTimeout(cancel,Math.max(0,options.deadline-Date.now()));
            item.promise.then(value=>{if(!done){done=true;cleanup();resolve(value);}},
                error=>{if(!done){done=true;cleanup();reject(error);}});
        });
    }
    private async loadOrCompile(snapshot:ActiveStyleSnapshot,key:string,signal:AbortSignal,proofDeadline?:number):Promise<CompilationResult> {
        const file=path.join(this.root,key+".json");
        let bytes:Buffer|undefined;
        try{bytes=this.read(file,134217728);}
        catch(error){if(!(error instanceof CacheSizeMiss)&&(error as NodeJS.ErrnoException).code!=="ENOENT")throw new CompilerFailure();}
        if(bytes){
            try{return {kind:"compiled",program:this.compiler.restore(snapshot,bytes.toString("utf8"),this.secret)};}
            catch{/* Authenticated format/producer mismatch is a cache miss, not poisoned content. */}
            if(this.compiler.restoreGap){try{return this.compiler.restoreGap(snapshot,bytes.toString("utf8"),this.secret);}catch{}}
        }
        const result=await this.compiler.compile(snapshot,{signal,proofDeadline});
        if(signal.aborted)throw new CompilerCancelled();
        if(result.kind!=="compiled"&&(result.kind!=="gap"||!this.compiler.encodeGap))return result;
        const temporary=mkdtempSync(path.join(this.root,".pending-"));
        try{
            const staging=path.join(temporary,"artifact.json");
            writeFileSync(staging,result.kind==="compiled"?this.compiler.encode(result.program,this.secret):this.compiler.encodeGap!(result as DeterministicGap,this.secret),{mode:0o600,flag:"wx"});
            renameSync(staging,file);
        }finally{rmSync(temporary,{recursive:true,force:true});}
        return result;
    }
}
