// general-entry-from-source.ts
//
// Native selected Entry preparation using named approved source operations.
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

import {Context,runtime} from "../../runtime/s2runtime";
import {NativeString,scalarPV,scalarTruthy} from "../../runtime/native-scalar";
import {concatStrings} from "../../runtime/native-string";
import {generalEntry,type GeneralEntryOperations} from "./general-entry-model";
import {generalDateTimeParts} from "./general-model-date";
import {prepareGeneralEntryContent,type GeneralEntryContentInput,type GeneralEntryContentOperations} from "./general-entry-content";
import type {GeneralModel} from "./general-model-primitives";

export interface GeneralEntrySourceInput {
    readonly content:GeneralEntryContentInput;
    readonly journalId:number;readonly posterId:number;
    readonly permalinkUrl:NativeString;
    readonly dateparts:NativeString;readonly systemDateparts:NativeString;
    readonly security:NativeString;readonly allowmask:unknown;
    readonly adultContentLevel:NativeString;readonly adminPost:unknown;
    readonly forceMoodtheme:NativeString|undefined;
}
export interface GeneralEntrySourceOperations extends GeneralEntryContentOperations {
    // Installed closed operations; identities come from the authorized selection.
    user(kind:"journal"|"poster"):GeneralModel;
    picture(kind:"entry-poster"|"journal-default"):GeneralModel|undefined;
    moodtheme(kind:"journal"|"poster"):unknown;
    tagList():{readonly html:NativeString|undefined;readonly tags:readonly GeneralModel[]};
    commentInfo():GeneralModel;
    readonly features:GeneralEntryOperations["features"];
    standardImage:GeneralEntryOperations["standardImage"];
    currents(theme:unknown):ReturnType<GeneralEntryOperations["currents"]>;
    groupNames():unknown;
}
/** Entry_from_entryobj source order, after parent visibility and final witnesses. */
export function generalEntryFromSource(context:Context,input:GeneralEntrySourceInput,
    operations:GeneralEntrySourceOperations):GeneralModel {
    if(!context.scalarProfile)throw Error("Missing admitted scalar profile");
    const profile=context.scalarProfile;
    const content=prepareGeneralEntryContent(input.content,operations);
    const journal=operations.user("journal");
    const poster=input.posterId===input.journalId?journal:operations.user("poster");
    let picture:GeneralModel|undefined,style:unknown;
    if(!runtime.scalarCompare("string","==",context.prop._userpics_position,NativeString.hostUtf8Bytes("none"))) {
        const kind=input.posterId===input.journalId||!scalarTruthy(context.prop._use_shared_pic)?"entry-poster":"journal-default";
        picture=operations.picture(kind);
        style=context.prop._entry_userpic_style;
    }
    const theme=operations.moodtheme(runtime.scalarCompare("string","==",input.forceMoodtheme,
        NativeString.hostUtf8Bytes("Y"))?"journal":"poster");
    const tags=operations.tagList();
    const comments=operations.commentInfo();
    return generalEntry({subject:content.subject,text:concatStrings(scalarPV(content.text),scalarPV(tags.html)),
        journal,poster,newDay:0,endDay:0,comments,userpic:picture,userpicStyle:style,
        permalinkUrl:input.permalinkUrl,itemId:input.content.ditemid,tags:tags.tags,timeformat24:undefined,
        adminPost:input.adminPost,domId:concatStrings(concatStrings(NativeString.hostUtf8Bytes("entry-"),input.content.journalName),
            concatStrings(NativeString.hostUtf8Bytes("-"),scalarPV(input.content.ditemid))),
        dateparts:input.dateparts,systemDateparts:input.systemDateparts,security:input.security,
        allowmask:input.allowmask,adultContentLevel:input.adultContentLevel},{features:operations.features,
        dateTimeParts:value=>generalDateTimeParts(value,profile),
        standardImage:kind=>operations.standardImage(kind),currents:()=>operations.currents(theme),
        groupNames:()=>operations.groupNames()},profile);
}
