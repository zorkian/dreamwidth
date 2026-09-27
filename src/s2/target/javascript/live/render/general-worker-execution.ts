// general-worker-execution.ts
//
// One admitted Context from initialization through approved data and print.
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

import type {BuiltinFunction} from "../../runtime/s2runtime";
import type {PublicAppConfig} from "../contracts";
import {validateConfig} from "../policy/config";
import type {PrivateProgramTransfer} from "./program-coordinator";
import {GeneralProgramSession} from "./general-session";
import type {GeneralPropertyCleaner} from "./general-properties";
import {GeneralWorkerChannel} from "./general-worker-channel";
import {decodeGeneralModel} from "./general-model-wire";
import {preparationDiagnostic,renderDiagnostic} from "./general-diagnostics";
import type {NativeOutputOptions} from "./native-output";
import {PrivateTransportError} from "./private-transport";

export interface GeneralWorkerStart {
    readonly version:1;
    readonly transfer:PrivateProgramTransfer;
    readonly config:PublicAppConfig;
    readonly kind:"recent"|"entry";
}
function exact(value:unknown,names:readonly string[]):Record<string,unknown> {
    if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).length!==names.length||
        names.some(name=>!Object.hasOwn(value,name)))throw new PrivateTransportError();
    return value as Record<string,unknown>;
}
export function validateGeneralWorkerStart(input:unknown):GeneralWorkerStart {
    const row=exact(input,["version","transfer","config","kind"]);
    if(row.version!==1||!["recent","entry"].includes(row.kind as string))throw new PrivateTransportError();
    exact(row.transfer,["program","admission"]);
    validateConfig(row.config as PublicAppConfig);
    // Admission/code/profile identity is checked by GeneralProgramSession before
    // any persisted program initialization. Only the private parent sends this.
    return row as unknown as GeneralWorkerStart;
}
export interface GeneralInstalledOperations {
    builtins(start:GeneralWorkerStart,currentPage:()=>unknown,session:()=>GeneralProgramSession):Record<string,BuiltinFunction>;
    propertyCleaner(session:GeneralProgramSession,start:GeneralWorkerStart):GeneralPropertyCleaner;
    // The resume graph contains ONLY approved public source fields. Original
    // content cleaning and helper eval effects remain in the credential-free child.
    preparePage(session:GeneralProgramSession,start:GeneralWorkerStart,approved:unknown):unknown;
    // Native s2_run resets its resource cache after Page preparation. This
    // trusted coordinator hook retains already-prepared Image aliases.
    beginRendering(session:GeneralProgramSession,start:GeneralWorkerStart):void;
    output(start:GeneralWorkerStart):Omit<NativeOutputOptions,"checkDepth"|"initialization">;
}
/** Installed callbacks are code, never fields or module names supplied over IPC. */
export function executeGeneralWorker(channel:GeneralWorkerChannel,operations:GeneralInstalledOperations):void {
    const start=channel.start(validateGeneralWorkerStart);
    let page:unknown;
    const session:GeneralProgramSession=new GeneralProgramSession(start.transfer,start.config,
        operations.builtins(start,()=>page,()=>session),operations.output(start));
    const initialized=session.initialize(operations.propertyCleaner(session,start));
    if(initialized.kind==="program-error") {
        channel.preparationResult(preparationDiagnostic(initialized.error,initialized.signature).frame());
        return;
    }
    const approved=channel.resume(initialized.recentCount,value=>{
        const row=exact(value,["kind","page"]);
        if(row.kind!==start.kind)throw new PrivateTransportError();
        return decodeGeneralModel(row.page);
    });
    page=operations.preparePage(session,start,approved);
    if(!page||typeof page!=="object"||
        (page as Record<string,unknown>)[".type"]!==(start.kind==="recent"?"RecentPage":"EntryPage")) {
        throw new PrivateTransportError();
    }
    operations.beginRendering(session,start);
    session.beginRender();
    channel.result(session.completePage(page,start.kind,renderDiagnostic));
}
