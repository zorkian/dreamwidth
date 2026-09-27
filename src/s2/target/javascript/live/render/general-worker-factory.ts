// general-worker-factory.ts
//
// Installed public model and host assembly for one general worker request.
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

import type {GeneralInstalledOperations,GeneralWorkerStart} from "./general-worker-execution";
import type {GeneralWorkerChannel} from "./general-worker-channel";
import type {GeneralProgramSession} from "./general-session";
import {GeneralUserBindings} from "./general-user-bindings";
import {generalUserConstructor} from "./general-user-builtins";
import {GeneralStandardImageClient} from "./general-standard-images-client";
import {generalImageCallbacks,type GeneralImageCallbacks} from "./general-image-builtins";
import {generalScalarCallbacks} from "./general-builtins";
import {generalModelCallbacks} from "./general-model-builtins";
import {generalCommentNavigation,type GeneralCommentNavigation} from "../domain/general-comment-navigation";
import {generalEscapeUrl} from "../domain/general-navigation-url";
import {generalRecentPageFromSource,generalEntryPageFromSource,
    type GeneralRecentPageSourceInput,type GeneralRecentPageOperations,
    type GeneralEntryPageSourceInput,type GeneralEntryPageOperations} from "../domain/general-page-assembly";

export interface GeneralWorkerPublicBindings {
    readonly users:GeneralUserBindings;
    readonly images:GeneralImageCallbacks;
    readonly navigation:GeneralCommentNavigation;
}
export interface GeneralWorkerFactoryServices {
    readonly propertyCleaner:GeneralInstalledOperations["propertyCleaner"];
    readonly output:GeneralInstalledOperations["output"];
    seesControlStrip(start:GeneralWorkerStart):unknown;
    /** Validate named authorized source descriptors, never cast an arbitrary resume graph. */
    recentInput(value:unknown):GeneralRecentPageSourceInput;
    entryInput(value:unknown):GeneralEntryPageSourceInput;
    recentOperations(session:GeneralProgramSession,start:GeneralWorkerStart,
        bindings:GeneralWorkerPublicBindings):GeneralRecentPageOperations;
    entryOperations(session:GeneralProgramSession,start:GeneralWorkerStart,
        bindings:GeneralWorkerPublicBindings):Omit<GeneralEntryPageOperations,"navigation">;
}

/** All constructor/private callback authority is created once for this worker request. */
export function generalWorkerFactory(channel:GeneralWorkerChannel,
    services:GeneralWorkerFactoryServices):GeneralInstalledOperations {
    const users=new GeneralUserBindings(),source=new GeneralStandardImageClient(channel);
    const images=generalImageCallbacks({sourceFacts:()=>source.sourceFacts(),
        translate:key=>source.translate(key),escapeUrl:generalEscapeUrl});
    const navigation=generalCommentNavigation();
    const bindings:GeneralWorkerPublicBindings=Object.freeze({users,images,navigation});
    return {
        builtins(start,page){return {...generalScalarCallbacks({page,
            seesControlStrip:()=>services.seesControlStrip(start)}),
            ...generalUserConstructor(channel,users),...generalModelCallbacks(),
            ...images.callbacks,...navigation.callbacks};},
        propertyCleaner:services.propertyCleaner,output:services.output,
        preparePage(session,start,approved){
            if(start.kind==="recent")return generalRecentPageFromSource(session.context,
                services.recentInput(approved),services.recentOperations(session,start,bindings));
            return generalEntryPageFromSource(session.context,services.entryInput(approved),{
                ...services.entryOperations(session,start,bindings),navigation});
        },
        beginRendering(session){images.beginRendering(session.context);},
    };
}
