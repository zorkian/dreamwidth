// general-approved-page-source.ts
//
// Named worker Page descriptors from the parent selected public source.
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

import type {NativeSelectedSnapshot,RawEntry} from "../contracts";
import type {GeneralSelectedText} from "./general-selected-text";
import type {GeneralPageInput} from "./general-page-model";
import type {GeneralRecentPageSourceInput,GeneralEntryPageSourceInput} from "./general-page-assembly";
import type {GeneralModel} from "./general-model-primitives";
import {NativeString} from "../../runtime/native-string";
import {projectGeneralRecentSelection} from "./general-recent-selection";
import {SnapshotError} from "../data/errors";

export interface GeneralApprovedPageSourceOptions {
    readonly page:Omit<GeneralPageInput,"journal">;
    readonly userpicRoot:NativeString;
    readonly recent:{
        readonly navigation:GeneralRecentPageSourceInput["navigation"];
        entry(entry:RawEntry):Parameters<GeneralSelectedText["entrySource"]>[1];
    };
    readonly directEntry:{
        readonly thread:unknown;
        entry(entry:RawEntry):Parameters<GeneralSelectedText["entryPageSource"]>[1];
    };
}

/** The User handle is issued in the worker, never serialized from the parent. */
export interface GeneralApprovedPageHeader {
    readonly fields:Omit<GeneralPageInput,"journal">;
    readonly journalName:NativeString;
    readonly defaultPicture:GeneralModel;
    readonly websiteUrl:NativeString|undefined;
    readonly websiteName:NativeString|undefined;
}
export type GeneralApprovedPageSource =
    {readonly kind:"recent";readonly page:Omit<GeneralRecentPageSourceInput,"page">&
        {readonly page:GeneralApprovedPageHeader}}|
    {readonly kind:"entry";readonly page:Omit<GeneralEntryPageSourceInput,"page">&
        {readonly page:GeneralApprovedPageHeader}};

/** Source-counted window and prepared entry cells are the only selected input. */
export function generalApprovedPageSource(snapshot:NativeSelectedSnapshot,
    prepared:GeneralSelectedText,options:GeneralApprovedPageSourceOptions):GeneralApprovedPageSource {
    const facts=snapshot.facts;
    const website=prepared.pageText().website;
    const header:GeneralApprovedPageHeader=Object.freeze({fields:options.page,
        journalName:NativeString.bytes(Buffer.from(facts.owner.user,"latin1")),
        defaultPicture:prepared.defaultPicture(facts.owner.userid,options.userpicRoot),
        websiteUrl:website.url,websiteName:website.name});
    if(facts.request.page.kind==="recent") {
        const selection=projectGeneralRecentSelection(snapshot,entry=>{
            prepared.entry(entry);
            return prepared.entrySource(entry,options.recent.entry(entry));
        });
        return Object.freeze({kind:"recent",page:Object.freeze({page:header,selection,
            navigation:options.recent.navigation})});
    }
    const entry=facts.entries[0];
    if(!entry||facts.entries.length!==1||entry.jitemid*256+entry.anum!==facts.request.page.ditemid)
        throw new SnapshotError("unsupported");
    prepared.entry(entry);
    return Object.freeze({kind:"entry",page:Object.freeze({page:header,
        entry:prepared.entryPageSource(entry,options.directEntry.entry(entry)),
        thread:options.directEntry.thread})});
}
