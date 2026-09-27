// general-page-model.ts
//
// Anonymous native Page construction from named approved source helpers.
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

import {runtime} from "../../runtime/s2runtime";
import {NativeString,scalarPV,scalarNumber} from "../../runtime/native-scalar";
import {concatStrings} from "../../runtime/native-string";
import {arithmetic} from "../../runtime/native-number";
import {escapeNativeHtml} from "../render/general-diagnostics";
import {generalDateTimeClock} from "./general-model-date";
import {generalUserLink,type GeneralUserLinkFields} from "./general-model-links";
import type {GeneralModel} from "./general-model-primitives";

export interface GeneralPageInput {
    readonly styleId:unknown;
    readonly styleModtime:unknown;
    readonly baseUrl:NativeString;
    readonly journal:GeneralModel;
    readonly journalType:NativeString;
    readonly ownerName:NativeString|undefined;
    readonly journalTitle:NativeString|undefined;
    readonly journalSubtitle:NativeString|undefined;
    readonly layoutName:NativeString|undefined;
    readonly themeName:NativeString|undefined;
    readonly layoutUrl:NativeString;
    readonly getargs:readonly (readonly [NativeString,unknown])[];
    readonly viewingStyleOptions:unknown;
    readonly viewUrls:readonly (readonly [NativeString,unknown])[];
    readonly links:readonly GeneralUserLinkFields[];
    readonly customtext:{title:unknown;url:unknown;content:unknown};
    readonly customtextDefaults:{title:unknown;url:unknown;content:unknown};
    readonly showControlStrip:unknown;
    readonly isCanary:unknown;
    readonly noMobileCookie:unknown;
    readonly sessionMessages:unknown;
    readonly headContent:NativeString;
    readonly canUseNetwork:unknown;
    readonly activeEntries:readonly GeneralModel[];
}
export interface GeneralPageOperations {
    /** Native samples time independently for time and anonymous local_time. */
    clockSeconds():number;
    // Actual child property/event cleaner, including native exception effects.
    // This is mandatory installed code; no identity or plain-text replacement.
    escapeProperty(value:unknown,mode:"plain"|"html"):unknown;
}
const bytes=(value:string)=>NativeString.hostUtf8Bytes(value);
/** Base Page is prepared in the admitted child; raw source bags never reach it. */
export function generalPage(input:GeneralPageInput,operations:GeneralPageOperations):GeneralModel {
    const args:(readonly [unknown,unknown])[]=[];
    for(const [key,value] of input.getargs) {
        const payload=key.bytes();
        if(payload[0]===46)args.push([NativeString.fromFrame({bytes:payload.subarray(1),utf8:key.flagged()}),value]);
    }
    const custom={...input.customtext};
    if(!runtime.scalarTruthy(custom.content))custom.content=input.customtextDefaults.content;
    if(!runtime.scalarTruthy(custom.url))custom.url=input.customtextDefaults.url;
    if(custom.title===undefined||custom.title===null||
        runtime.scalarCompare("string","==",custom.title,bytes(""))||
        runtime.scalarCompare("string","==",custom.title,bytes("Custom Text")))custom.title=input.customtextDefaults.title;
    const style=arithmetic("+",scalarNumber(input.styleId),scalarNumber(0));
    let views=["recent","archive","read","tags","memories","userinfo"];
    if(runtime.scalarCompare("string","==",input.journalType,bytes("I")))views=["read","userinfo"];
    if(runtime.scalarCompare("string","==",input.journalType,bytes("Y")))views=["recent","archive","userinfo"];
    if(runtime.scalarTruthy(input.canUseNetwork))views=["recent","archive","read","network","tags","memories","userinfo"];
    // Native writes fallback user properties; read-only viewer computes the same
    // request-local values without persisting user settings.
    return {".type":"Page",_view:bytes(""),_args:runtime.makeHash(args),_journal:input.journal,
        _journal_type:input.journalType,_layout_name:input.layoutName,_theme_name:input.themeName,
        _layout_url:input.layoutUrl,_time:generalDateTimeClock(operations.clockSeconds()),
        _local_time:generalDateTimeClock(operations.clockSeconds()),_base_url:input.baseUrl,
        _stylesheet_url:concatStrings(concatStrings(concatStrings(concatStrings(input.baseUrl,bytes("/res/")),
            scalarPV(style)),bytes("/stylesheet?")),scalarPV(input.styleModtime)),
        _view_url:runtime.makeHash(input.viewUrls),_linklist:input.links.map(link=>generalUserLink({...link})),
        _customtext_title:operations.escapeProperty(custom.title,"plain"),
        _customtext_url:operations.escapeProperty(custom.url,"plain"),
        _customtext_content:operations.escapeProperty(custom.content,"html"),
        _views_order:views.map(bytes),
        _global_title:escapeNativeHtml(runtime.scalarTruthy(input.journalTitle)?input.journalTitle:input.ownerName),
        _global_subtitle:escapeNativeHtml(input.journalSubtitle),_show_control_strip:input.showControlStrip,
        _head_content:input.headContent,_is_canary:input.isCanary,_data_link:runtime.makeHash([]),
        _data_links_order:[],_styleopts:input.viewingStyleOptions,_timeformat24:undefined,
        _include_meta_viewport:runtime.scalarTruthy(input.noMobileCookie)?0:1,
        _session_msgs:input.sessionMessages,_has_activeentries:input.activeEntries.length?1:0,
        ...(input.activeEntries.length?{_activeentries:input.activeEntries}:{})};
}
