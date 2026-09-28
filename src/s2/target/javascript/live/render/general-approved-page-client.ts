// general-approved-page-client.ts
//
// Worker-local journal User binding for a parent-approved Page descriptor.
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

import {NativeString} from "../../runtime/native-string";
import type {GeneralPageInput} from "../domain/general-page-model";
import type {GeneralApprovedPageHeader} from "../domain/general-approved-page-source";
import type {GeneralRecentPageSourceInput,GeneralEntryPageSourceInput} from "../domain/general-page-assembly";
import type {GeneralWorkerPublicBindings} from "./general-worker-factory";
import {PrivateTransportError} from "./private-transport";

const fieldNames=["styleId","styleModtime","baseUrl","journalType","ownerName","journalTitle",
    "journalSubtitle","layoutName","themeName","layoutUrl","getargs","viewingStyleOptions",
    "viewUrls","links","customtext","customtextDefaults","showControlStrip","isCanary",
    "noMobileCookie","sessionMessages","headContent","canUseNetwork","activeEntries"] as const;

/** Only a fresh worker UserLite lookup can issue the journal's private handle. */
export function generalApprovedPageInput(value:unknown,
    bindings:Pick<GeneralWorkerPublicBindings,"loadUser"|"prepareUser">):GeneralPageInput {
    if(!value||typeof value!=="object"||Array.isArray(value)||
        Object.keys(value).length!==5||
        ["fields","journalName","defaultPicture","websiteUrl","websiteName"].some(key=>
            !Object.hasOwn(value,key)))throw new PrivateTransportError();
    const header=value as GeneralApprovedPageHeader,fields=header.fields;
    if(!fields||typeof fields!=="object"||Array.isArray(fields)||
        Object.keys(fields).length!==fieldNames.length||fieldNames.some(key=>!Object.hasOwn(fields,key))||
        !NativeString.is(header.journalName)||
        !header.defaultPicture||header.defaultPicture[".type"]!=="Image"||
        header.websiteUrl!==undefined&&!NativeString.is(header.websiteUrl)||
        header.websiteName!==undefined&&!NativeString.is(header.websiteName))throw new PrivateTransportError();
    const lite=bindings.loadUser(header.journalName);
    return {...fields,journal:bindings.prepareUser(lite as Record<string,unknown>,
        header.defaultPicture,header.websiteUrl,header.websiteName)};
}

function selectedPage(value:unknown,kind:"recent"|"entry",keys:readonly string[]):Record<string,unknown> {
    if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).length!==2||
        (value as Record<string,unknown>).kind!==kind||!Object.hasOwn(value,"page"))
        throw new PrivateTransportError();
    const page=(value as Record<string,unknown>).page;
    if(!page||typeof page!=="object"||Array.isArray(page)||Object.keys(page).length!==keys.length||
        keys.some(key=>!Object.hasOwn(page,key)))throw new PrivateTransportError();
    return page as Record<string,unknown>;
}
export function generalApprovedRecentInput(value:unknown,
    bindings:Pick<GeneralWorkerPublicBindings,"loadUser"|"prepareUser">):GeneralRecentPageSourceInput {
    const selected=selectedPage(value,"recent",["page","selection","navigation"]);
    return {page:generalApprovedPageInput(selected.page,bindings),
        selection:selected.selection as GeneralRecentPageSourceInput["selection"],
        navigation:selected.navigation as GeneralRecentPageSourceInput["navigation"]};
}
export function generalApprovedEntryInput(value:unknown,
    bindings:Pick<GeneralWorkerPublicBindings,"loadUser"|"prepareUser">):GeneralEntryPageSourceInput {
    const selected=selectedPage(value,"entry",["page","entry","thread"]);
    return {page:generalApprovedPageInput(selected.page,bindings),
        entry:selected.entry as GeneralEntryPageSourceInput["entry"],thread:selected.thread};
}
