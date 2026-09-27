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
import {ArtifactCompiler, CompilerFailure, type ActiveStyleSnapshot, type CompilationResult} from "./layer-artifact";

export class ArtifactCache {
    private readonly root:string;
    private readonly secret:Buffer;
    private readonly pending=new Map<string,Promise<CompilationResult>>();
    constructor(root:string,private readonly compiler:ArtifactCompiler) {
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
                (stat.mode&0o777)!==0o600||stat.size>max)throw new CompilerFailure();
            fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);
            const opened=fstatSync(fd);
            if(opened.ino!==stat.ino||opened.dev!==stat.dev||!opened.isFile()||opened.nlink!==1||
                opened.uid!==stat.uid||opened.mode!==stat.mode||opened.size>max)throw new CompilerFailure();
            return readFileSync(fd);
        }catch(error){
            if((error as NodeJS.ErrnoException).code==="ENOENT")throw error;
            throw new CompilerFailure();
        }finally{if(fd!==undefined)closeSync(fd);}
    }
    getOrCompile(snapshot:ActiveStyleSnapshot):Promise<CompilationResult> {
        // Copy buffers and scalar identities synchronously before callers can
        // mutate their captured DB records while the compiler is pending.
        const captured:ActiveStyleSnapshot={styleId:snapshot.styleId,systemUserId:snapshot.systemUserId,
            layers:snapshot.layers.map(layer=>({...layer,sourceBytes:layer.sourceBytes===null?null:Buffer.from(layer.sourceBytes),
                activeCompiledBytes:Buffer.from(layer.activeCompiledBytes)}))};
        const key=this.compiler.key(captured);
        const existing=this.pending.get(key);if(existing)return existing;
        const work=this.loadOrCompile(captured,key);
        this.pending.set(key,work);
        void work.finally(()=>this.pending.delete(key)).catch(()=>{});
        return work;
    }
    private async loadOrCompile(snapshot:ActiveStyleSnapshot,key:string):Promise<CompilationResult> {
        const file=path.join(this.root,key+".json");
        try{return {kind:"compiled",program:this.compiler.restore(snapshot,this.read(file,134217728).toString("utf8"),this.secret)};}
        catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw new CompilerFailure();}
        const result=await this.compiler.compile(snapshot);
        if(result.kind!=="compiled")return result;
        const temporary=mkdtempSync(path.join(this.root,".pending-"));
        try{
            const staging=path.join(temporary,"artifact.json");
            writeFileSync(staging,this.compiler.encode(result.program,this.secret),{mode:0o600,flag:"wx"});
            renameSync(staging,file);
        }finally{rmSync(temporary,{recursive:true,force:true});}
        return result;
    }
}
