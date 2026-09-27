// general-model-links.ts
//
// Native public UserLink model projection.
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
import {NativeString} from "../../runtime/native-string";
import {scalarPV} from "../../runtime/native-scalar";
import {escapeNativeHtml} from "../render/general-diagnostics";
import type {GeneralModel} from "./general-model-primitives";

export interface GeneralUserLinkFields {
    title:unknown;
    readonly url:unknown;
    readonly hover:unknown;
    readonly children?:unknown;
}
/** Named public link fields only; native mutates a dash title before projection. */
export function generalUserLink(link:GeneralUserLinkFields):GeneralModel {
    if(runtime.scalarCompare("string","==",link.title,NativeString.bytes(Buffer.from("-"))))
        link.title=NativeString.bytes(Buffer.alloc(0));
    return {".type":"UserLink",_is_heading:runtime.scalarTruthy(link.url)?0:1,
        _url:escapeNativeHtml(scalarPV(link.url)),_title:escapeNativeHtml(scalarPV(link.title)),
        _hover:escapeNativeHtml(scalarPV(link.hover)),
        _children:runtime.scalarTruthy(link.children)?link.children:[]};
}
