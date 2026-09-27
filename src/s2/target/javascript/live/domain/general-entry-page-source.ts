// general-entry-page-source.ts
//
// Native direct EntryPage Entry preparation after parent authorization.
//
// Portions adapted from LJ::S2::EntryPage_entry, forked from the
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

import {runtime,type Context} from "../../runtime/s2runtime";
import {NativeString,scalarPV,scalarTruthy} from "../../runtime/native-scalar";
import {concatStrings} from "../../runtime/native-string";
import {generalEntry,type GeneralEntryOperations} from "./general-entry-model";
import {generalDateTimeParts} from "./general-model-date";
import {quoteGeneralEntryHtml,type GeneralEntryContentInput,
    type GeneralEntryContentOperations} from "./general-entry-content";
import type {GeneralEntrySourceInput} from "./general-entry-from-source";
import type {GeneralModel} from "./general-model-primitives";

export interface GeneralEntryPageEntryInput extends Omit<GeneralEntrySourceInput,
    "content"|"journalId"|"posterId"|"forceMoodtheme"> {
    readonly content:Omit<GeneralEntryContentInput,"noEntryBody"|"cutUrl"|"cutDisable">;
    readonly mode:unknown;
}
export interface GeneralEntryPageEntryOperations extends Pick<GeneralEntryContentOperations,
    "cleanSubject"|"cleanEvent"|"expandEmbedded"> {
    readonly features:GeneralEntryOperations["features"];
    user(kind:"journal"|"poster"):GeneralModel;
    // Direct Entry always selects its poster picture, including the native
    // picture-id-zero fallback. It does not use Recent's shared-pic branch.
    picture():GeneralModel|undefined;
    commentInfo():GeneralModel;
    tagList():{readonly html:NativeString|undefined;readonly tags:readonly GeneralModel[]};
    recordPublicEntry(text:NativeString,tags:readonly GeneralModel[]):void;
    standardImage:GeneralEntryOperations["standardImage"];
    // Native EntryPage does not pass moodthemeid; Entry uses the journal $u.
    currents:GeneralEntryOperations["currents"];
    groupNames():unknown;
}

/** EntryPage_entry differs from Recent's Entry_from_entryobj in order and effects. */
export function generalEntryPageEntryFromSource(context:Context,input:GeneralEntryPageEntryInput,
    operations:GeneralEntryPageEntryOperations):GeneralModel {
    if(!context.scalarProfile)throw Error("Missing admitted scalar profile");
    const journal=operations.user("journal"),poster=operations.user("poster");
    const picture=runtime.scalarCompare("string","==",context.prop._userpics_position,
        NativeString.hostUtf8Bytes("none"))?undefined:operations.picture();
    const comments=operations.commentInfo();
    const reply=runtime.scalarCompare("string","==",scalarTruthy(input.mode)?input.mode:
        NativeString.hostUtf8Bytes(""),NativeString.hostUtf8Bytes("reply"));
    // Native comparisons produce the true/false dual scalar (false PV is
    // empty, not "0"). The shared host boolean adapter preserves both uses.
    if(scalarTruthy(comments._show_postlink))comments._show_postlink=!reply;
    if(scalarTruthy(comments._show_readlink))comments._show_readlink=reply;
    const source=input.content;
    let subject=source.subject?.clone(),event=source.event?.clone();
    if(scalarTruthy(subject))subject=operations.cleanSubject(subject!);
    subject=quoteGeneralEntryHtml(subject,source.noHtml);
    if(scalarTruthy(event))event=operations.cleanEvent(event!,{
        preformatted:source.preformatted,suspendMessage:source.suspendMessage,
        journal:source.journalName,ditemid:source.ditemid,isSyndicated:source.isSyndicated,
        isImported:source.importSourceDefined,editor:source.editor,logtimeMysql:source.logtimeMysql,
        // Native event_html() receives no caller cut options on direct Entry.
        cutUrl:undefined,cutDisable:undefined});
    event=operations.expandEmbedded(event,source.ditemid,"entry-event");
    event=quoteGeneralEntryHtml(event,source.noHtml);
    const tags=operations.tagList();
    const text=concatStrings(scalarPV(event),scalarPV(tags.html));
    if(runtime.scalarCompare("string","==",input.security,NativeString.hostUtf8Bytes("public")))
        operations.recordPublicEntry(text,tags.tags);
    return generalEntry({subject,text,journal,poster,newDay:0,endDay:0,comments,
        userpic:picture,userpicStyle:context.prop._entry_userpic_style,
        permalinkUrl:input.permalinkUrl,itemId:source.ditemid,tags:tags.tags,
        timeformat24:undefined,adminPost:input.adminPost,domId:undefined,
        dateparts:input.dateparts,systemDateparts:input.systemDateparts,
        security:input.security,allowmask:input.allowmask,adultContentLevel:input.adultContentLevel},{
        features:operations.features,dateTimeParts:value=>generalDateTimeParts(value,context.scalarProfile!),
        standardImage:operations.standardImage,currents:operations.currents,groupNames:operations.groupNames,
    },context.scalarProfile);
}
