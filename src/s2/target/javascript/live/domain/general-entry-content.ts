// general-entry-content.ts
//
// Original-source Entry content sequencing across installed cleaner and helper boundaries.
//
// Portions adapted from LJ::S2 object constructors, forked from the
// LiveJournal project owned and operated by Live Journal, Inc., and modified
// and expanded by Dreamwidth Studios, LLC. The original license is available at:
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
// In accordance with that license, this code and its modifications are provided
// under the GNU General Public License. See LICENSE in this distribution.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//

// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.
// The inherited notice above applies to adapted LiveJournal portions.
//

import {NativeString,scalarTruthy} from "../../runtime/native-scalar";

export interface GeneralEntryContentInput {
    readonly subject:NativeString|undefined;
    readonly event:NativeString|undefined;
    readonly journalName:NativeString;
    readonly ditemid:unknown;
    readonly jitemid:unknown;
    readonly editor:NativeString|undefined;
    readonly preformatted:unknown;
    readonly importSourceDefined:boolean;
    readonly isSyndicated:unknown;
    readonly logtimeMysql:NativeString;
    readonly suspendMessage:unknown;
    readonly noEntryBody:unknown;
    readonly noHtml:unknown;
    readonly cutUrl:NativeString;
    readonly cutDisable:unknown;
}
export interface GeneralEntryEventOptions {
    readonly preformatted:unknown;readonly suspendMessage:unknown;
    readonly journal:NativeString;readonly ditemid:unknown;
    readonly isSyndicated:unknown;readonly isImported:boolean;
    readonly editor:NativeString|undefined;readonly logtimeMysql:NativeString;
    readonly cutUrl:NativeString;readonly cutDisable:unknown;
}
export interface GeneralEntryContentOperations {
    // Installed original-source cleaners. No identity or scalar-only fallback.
    cleanSubject(input:NativeString):NativeString;
    cleanEvent(input:NativeString,options:GeneralEntryEventOptions):NativeString;
    expandEmbedded(input:NativeString|undefined,itemId:unknown,
        stage:"entry-event"|"s2-entry"):NativeString|undefined;
    transformAdult(input:NativeString|undefined):NativeString|undefined;
}
/** Native quote_html changes complete non-LJ tokens only, preserving PV bytes/flag. */
export function quoteGeneralEntryHtml(input:NativeString|undefined,noHtml:unknown):NativeString|undefined {
    if(input===undefined||!scalarTruthy(noHtml))return input?.clone();
    const view=input.bytes().toString("latin1").replace(/<(?!\/?lj)([^\n]*?)>/gi,
        (_all,inside:string)=>"&lt;"+inside+"&gt;");
    return NativeString.fromFrame({bytes:Buffer.from(view,"latin1"),utf8:input.flagged()});
}
/** LJ::Entry event_html followed by LJ::S2 Entry_from_entryobj, in source order. */
export function prepareGeneralEntryContent(input:GeneralEntryContentInput,
    operations:GeneralEntryContentOperations):{subject:NativeString|undefined;text:NativeString|undefined} {
    let subject=input.subject?.clone();
    if(scalarTruthy(subject))subject=operations.cleanSubject(subject!);
    subject=quoteGeneralEntryHtml(subject,input.noHtml);
    let text:NativeString|undefined;
    if(scalarTruthy(input.noEntryBody))text=NativeString.bytes(Buffer.alloc(0));
    else {
        text=input.event?.clone();
        if(scalarTruthy(text))text=operations.cleanEvent(text!,{
            preformatted:input.preformatted,suspendMessage:input.suspendMessage,
            journal:input.journalName,ditemid:input.ditemid,isSyndicated:input.isSyndicated,
            isImported:input.importSourceDefined,editor:input.editor,logtimeMysql:input.logtimeMysql,
            cutUrl:input.cutUrl,cutDisable:input.cutDisable});
        // Entry event_html first uses external ID; S2 then uses internal ID.
        text=operations.expandEmbedded(text,input.ditemid,"entry-event");
        text=quoteGeneralEntryHtml(text,input.noHtml);
        text=operations.expandEmbedded(text,input.jitemid,"s2-entry");
        text=operations.transformAdult(text);
    }
    return {subject,text};
}
