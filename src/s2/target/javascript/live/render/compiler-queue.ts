// compiler-queue.ts
//
// Bounded compiler service scheduling with cancellation and deadlines.
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

export interface CompilerJobOptions {readonly signal?:AbortSignal; readonly deadline?:number;}
export class CompilerCancelled extends Error {constructor(){super("S2 compiler job cancelled");}}
interface Waiting {start:()=>void;reject:(error:Error)=>void;controller:AbortController;timer?:ReturnType<typeof setTimeout>;detach:()=>void;started:boolean;}
export class CompilerQueue {
    private active=0;
    private readonly waiting:Waiting[]=[];
    constructor(private readonly slots=2,private readonly lifetimeMs=60000){}
    run<T>(task:(signal:AbortSignal)=>Promise<T>,options:CompilerJobOptions={}):Promise<T> {
        if(options.signal?.aborted)return Promise.reject(new CompilerCancelled());
        return new Promise<T>((resolve,reject)=>{
            const controller=new AbortController();
            const cancel=()=>{controller.abort();if(!job.started){
                const index=this.waiting.indexOf(job);if(index>=0)this.waiting.splice(index,1);
                cleanup();reject(new CompilerCancelled());
            }};
            const cleanup=()=>{if(job.timer)clearTimeout(job.timer);job.detach();};
            const job:Waiting={controller,reject,started:false,detach:()=>options.signal?.removeEventListener("abort",cancel),
                start:()=>{job.started=true;this.active++;
                    Promise.resolve().then(()=>{if(controller.signal.aborted)throw new CompilerCancelled();return task(controller.signal);})
                    .then(value=>{if(controller.signal.aborted)reject(new CompilerCancelled());else resolve(value);},reject)
                    .finally(()=>{cleanup();this.active--;this.advance();});
                }};
            options.signal?.addEventListener("abort",cancel,{once:true});
            const remaining=Math.min(this.lifetimeMs,(options.deadline??Infinity)-Date.now());
            job.timer=setTimeout(cancel,Math.max(0,remaining));
            this.waiting.push(job);this.advance();
        });
    }
    private advance():void {while(this.active<this.slots&&this.waiting.length)this.waiting.shift()!.start();}
}
