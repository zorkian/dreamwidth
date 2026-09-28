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
import {workerLoadUser} from "./general-user-client";
import type {NativeString} from "../../runtime/native-scalar";
import {generalUser} from "../domain/general-model-user";
import type {GeneralModel} from "../domain/general-model-primitives";
import {PrivateTransportError} from "./private-transport";
import {generalUserConstructor} from "./general-user-builtins";
import {GeneralStandardImageClient} from "./general-standard-images-client";
import {generalImageCallbacks,type GeneralImageCallbacks} from "./general-image-builtins";
import {generalScalarCallbacks} from "./general-builtins";
import {generalDateCallbacks,type GeneralDateOperations} from "./general-date-builtins";
import {generalModelCallbacks} from "./general-model-builtins";
import {generalCommentNavigation,type GeneralCommentNavigation} from "../domain/general-comment-navigation";
import {generalEscapeUrl} from "../domain/general-navigation-url";
import {generalRecentPageFromSource,generalEntryPageFromSource,
    type GeneralRecentPageSourceInput,type GeneralRecentPageOperations,
    type GeneralEntryPageSourceInput,type GeneralEntryPageOperations} from "../domain/general-page-assembly";
import {generalApprovedRecentInput,generalApprovedEntryInput} from "./general-approved-page-client";

export interface GeneralWorkerPublicBindings {
    readonly users:GeneralUserBindings;
    /** Creates the public model and binds its private account in this same factory. */
    loadUser(name:NativeString):unknown;
    prepareUser(lite:GeneralModel,defaultPic:GeneralModel,websiteUrl:unknown,
        websiteName:unknown):GeneralModel;
    readonly images:GeneralImageCallbacks;
    readonly navigation:GeneralCommentNavigation;
}
export interface GeneralWorkerFactoryServices {
    readonly propertyCleaner:GeneralInstalledOperations["propertyCleaner"];
    readonly output:GeneralInstalledOperations["output"];
    /** Native LJ::day_of_week result before wrapper +1; no guessed JS calendar. */
    readonly dates:GeneralDateOperations;
    seesControlStrip(start:GeneralWorkerStart):unknown;
    /** Validate named authorized source descriptors, never cast an arbitrary resume graph. */
    /** Fixed fixture adapters may override the installed approved descriptor path. */
    recentInput?(value:unknown,bindings:GeneralWorkerPublicBindings,session:GeneralProgramSession,
        start:GeneralWorkerStart):GeneralRecentPageSourceInput;
    entryInput?(value:unknown,bindings:GeneralWorkerPublicBindings,session:GeneralProgramSession,
        start:GeneralWorkerStart):GeneralEntryPageSourceInput;
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
    const dates=generalDateCallbacks(services.dates);
    const bindings:GeneralWorkerPublicBindings=Object.freeze({users,images,navigation,
        loadUser:(name:NativeString)=>workerLoadUser(channel,users,name),
        prepareUser(lite:GeneralModel,picture:GeneralModel,url:unknown,name:unknown){
            const account=users.account(lite);
            if(account===undefined)throw new PrivateTransportError();
            const user=generalUser(lite,picture,url,name);
            users.bind(user,account);
            return user;
        }});
    return {
        builtins(start,page){return {...generalScalarCallbacks({page,
            seesControlStrip:()=>services.seesControlStrip(start)}),
            ...generalUserConstructor(channel,users),...generalModelCallbacks(),
            ...images.callbacks,...navigation.callbacks,...dates};},
        propertyCleaner:services.propertyCleaner,output:services.output,
        preparePage(session,start,approved){
            // Native Page fallback reads the properties AFTER initialization and
            // declared-property escaping, before its own second property clean.
            const customtextDefaults={title:session.context.prop._text_module_customtext,
                url:session.context.prop._text_module_customtext_url,
                content:session.context.prop._text_module_customtext_content};
            if(start.kind==="recent") {
                const input=services.recentInput?services.recentInput(approved,bindings,session,start):
                    generalApprovedRecentInput(approved,bindings);
                const operations=services.recentOperations(session,start,bindings);
                return generalRecentPageFromSource(session.context,
                    {...input,page:{...input.page,customtextDefaults}},{...operations,
                        entry(source){
                            const entry=operations.entry(source);
                            return {...entry,picture(kind){
                                const picture=entry.picture(kind);
                                // Recent only assigns Image_userpic if native
                                // entry/default userpic exists. Direct Entry
                                // retains its separate picid-zero Null fallback.
                                return picture?.[".isnull"]===true?undefined:picture;
                            }};
                        }});
            }
            const input=services.entryInput?services.entryInput(approved,bindings,session,start):
                generalApprovedEntryInput(approved,bindings);
            return generalEntryPageFromSource(session.context,{...input,page:{...input.page,customtextDefaults}},{
                ...services.entryOperations(session,start,bindings),navigation});
        },
        beginRendering(session){images.beginRendering(session.context);},
    };
}
