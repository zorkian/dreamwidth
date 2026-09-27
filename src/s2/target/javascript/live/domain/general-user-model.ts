// general-user-model.ts
//
// Native public UserLite projection without exposing its private account object.
//
// Portions adapted from LJ::S2::UserLite, forked from the
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

import type {PublicUserFacts} from "../data/public-users";
import {NativeString,concatStrings} from "../../runtime/native-string";
import {escapeNativeHtml} from "../render/general-diagnostics";

export interface PublicUserLiteOperations {
    displayName(user: PublicUserFacts): NativeString | undefined;
    journalBase(user: PublicUserFacts): NativeString;
    readonly tellFriend: boolean;
}
export interface GeneralUserLiteModel extends Record<string,unknown> {
    readonly ".type": "UserLite";
    readonly _user: NativeString;
    readonly _username: NativeString;
    readonly _name: NativeString;
    readonly _journal_type: NativeString;
    readonly _userpic_listing_url: NativeString;
    readonly _link_keyseq: readonly NativeString[];
}
const bytes=(value:string)=>NativeString.hostUtf8Bytes(value);
/** Helpers consume witnessed parent facts; no raw identity or account object goes to S2. */
export function prepareGeneralUserLite(user: PublicUserFacts | null,
    operations: PublicUserLiteOperations): GeneralUserLiteModel | undefined {
    if (!user) return undefined;
    const display = operations.displayName(user), base = operations.journalBase(user);
    if (display !== undefined && !NativeString.is(display) || !NativeString.is(base) ||
        typeof operations.tellFriend !== "boolean") throw new Error("Invalid installed public UserLite helper");
    const keys = ["manage_membership","trust","watch","post_entry","track","message"];
    if (operations.tellFriend) keys.push("tell_friend");
    // The private native _u pointer is supplied independently by trusted worker
    // identity binding. Editable public user/username fields never recreate it.
    return {".type":"UserLite",_user:escapeNativeHtml(bytes(user.username)),
        _username:escapeNativeHtml(display),_name:escapeNativeHtml(user.name),
        _journal_type:bytes(user.journaltype),_userpic_listing_url:concatStrings(base,bytes("/icons")),
        _link_keyseq:keys.map(bytes)};
}
