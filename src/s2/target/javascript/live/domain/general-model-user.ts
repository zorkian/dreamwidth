// general-model-user.ts
//
// Native User construction from a freshly approved UserLite and named public facts.
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

import {escapeNativeHtml} from "../render/general-diagnostics";
import type {GeneralModel} from "./general-model-primitives";

/** Caller separately binds the new object to its issued private account handle. */
export function generalUser(lite:GeneralModel,defaultPic:GeneralModel,
    websiteUrl:unknown,websiteName:unknown):GeneralModel {
    if(lite[".type"]!=="UserLite"||defaultPic[".type"]!=="Image")
        throw Error("Invalid approved User model inputs");
    return {...lite,".type":"User",_default_pic:defaultPic,
        _website_url:escapeNativeHtml(websiteUrl),_website_name:escapeNativeHtml(websiteName)};
}
