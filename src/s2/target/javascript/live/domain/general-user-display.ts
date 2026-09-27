// general-user-display.ts
//
// Native public identity display operation with explicit installed helper facts.
//
// Portions adapted from LJ::S2::UserLite, forked from the
// LiveJournal project owned and operated by Live Journal, Inc., and modified
// and expanded by Dreamwidth Studios, LLC. The original license is available at:
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
// In accordance with that license, this code and its modifications are provided
// under the GNU General Public License. See LICENSE in this distribution.
//
// DisplayOfURL semantics are adapted from Net::OpenID::VerifiedIdentity 1.18.
// Copyright (c) 2005 Brad Fitzpatrick. All rights reserved. Distributed under
// the GNU General Public License or the Artistic License, as specified in the
// Perl README file.
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
import type {NativeProfile} from "../../runtime/native-profile";
import {NativeString,caseString,concatStrings} from "../../runtime/native-string";
import {scalarTruthy} from "../../runtime/native-scalar";

const bytes=(value:string)=>NativeString.hostUtf8Bytes(value);
const sameFlag=(value:NativeString,text:string)=>NativeString.fromFrame({bytes:Buffer.from(text,"latin1"),utf8:value.flagged()});
export interface PublicIdentityDisplayOperations {
    readonly openidAvailable:boolean;
    readonly isDevServer:boolean;
    readonly profile:NativeProfile;
    // Installed hook authority, including its actual absence, is explicit.
    identityDisplayName(value:NativeString|undefined):NativeString|undefined;
}
/** Byte spelling and flag remain intact; this helper does not parse navigation. */
export function nativeOpenIdDisplay(url:NativeString,dev:boolean,profile:NativeProfile):NativeString {
    const matched=/^https?:\/\/([^/]+)(\/[^\n]*)?(?:\n)?$/.exec(url.bytes().toString("latin1"));
    if(!matched)return url;
    let host=caseString(sameFlag(url,matched[1]!),"lower",profile);
    let view=host.bytes().toString("latin1");
    if(dev)view=view.replace(/^dev\./,"").replace(/:[0-9]+/,"");
    view=view.replace(/:[^\n]*/,"").replace(/^www\./i,"");
    host=sameFlag(host,view);
    const path=matched[2]??"";
    if(path.length<=1)return host;
    let user=/^\/~([^/]+)\/?(?:\n)?$/.exec(path)||/^\/(?:users?|members?)\/([^/]+)\/?(?:\n)?$/.exec(path);
    if(!user&&/^profile\./i.test(view)) {
        user=/^\/([^/]+)\/?(?:\n)?$/.exec(path);
        if(user)host=sameFlag(host,view.slice("profile.".length));
    }
    if(!user)return url;
    return concatStrings(concatStrings(concatStrings(sameFlag(url,user[1]!),bytes(" [")),host),bytes("]"));
}
export function nativePublicDisplayName(user:PublicUserFacts,
    operations:PublicIdentityDisplayOperations):NativeString|undefined {
    if(user.journaltype!=="I")return bytes(user.username);
    if(!user.identity)return bytes("[ERR:unknown_identity]");
    if(user.identity.type!=="O")return undefined;
    let name=operations.openidAvailable?nativeOpenIdDisplay(user.identity.value,
        operations.isDevServer,operations.profile):undefined;
    const altered=operations.identityDisplayName(name);
    if(altered!==undefined&&!NativeString.is(altered))throw new Error("Invalid installed identity display hook");
    if(scalarTruthy(altered))name=altered;
    if(name===undefined)return undefined;
    const original=name,view=original.bytes().toString("latin1");
    const parts:NativeString[]=[];let offset=0;
    for(const match of view.matchAll(/%([0-9A-Fa-f]{2})/g)) {
        parts.push(sameFlag(original,view.slice(offset,match.index)));
        const value=parseInt(match[1]!,16);
        parts.push(original.flagged()?NativeString.hostUnicode(String.fromCharCode(value)):
            NativeString.bytes(Buffer.from([value])));
        offset=match.index!+match[0].length;
    }
    parts.push(sameFlag(original,view.slice(offset)));
    return parts.reduce(concatStrings,original.flagged()?NativeString.flagged(Buffer.alloc(0)):bytes(""));
}
