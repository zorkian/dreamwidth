// general-recent-head.ts
//
// Native Recent head markup from fixed installed public-helper facts.
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
import {concatStrings} from "../../runtime/native-string";
import {escapeNativeHtml} from "../render/general-diagnostics";
const pv=NativeString.hostUtf8Bytes;
export interface GeneralRecentHeadInput {
    readonly isCommunity:boolean;readonly siteNameShort:NativeString;
    readonly canonicalJournalBase:NativeString;
    readonly robotMarkup:NativeString;
    readonly icbm:NativeString|undefined;
    readonly cutLabels:{readonly expanded:NativeString;readonly collapsed:NativeString;
        readonly collapseAll:NativeString;readonly expandAll:NativeString};
}
export function generalRecentHead(input:GeneralRecentHeadInput):NativeString {
    const add=concatStrings;
    const title=add(input.siteNameShort,pv(input.isCommunity?" members":" friends"));
    let output=add(add(add(add(pv('<link rel="group '+(input.isCommunity?"members":"friends made")+'" title="'),
        escapeNativeHtml(title)),pv('" href="')),escapeNativeHtml(add(input.canonicalJournalBase,pv("/read")))),pv('" />\n'));
    output=add(output,input.robotMarkup);
    if(scalarTruthy(input.icbm))output=add(output,add(add(pv('<meta name="ICBM" content="'),input.icbm!),pv('" />\n')));
    const labels=input.cutLabels;
    // Native localized labels are interpolated in this exact order. Final GO
    // output and installed translation authority are separate from construction.
    return add(output,add(add(add(add(add(add(add(add(pv("\n  <script type='text/javascript'>\n  expanded = '"),labels.expanded),
        pv("';\n  collapsed = '")),labels.collapsed),pv("';\n  collapseAll = '")),labels.collapseAll),
        pv("';\n  expandAll = '")),labels.expandAll),pv("';\n  </script>\n    ")));
}
