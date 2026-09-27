// general-navigation-url.ts
//
// Native query-value escaping and make_link using shared scalar/hash semantics.
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
import {NativeString,scalarPV} from "../../runtime/native-scalar";
import {byteCharacters,characterCodepoint,concatStrings} from "../../runtime/native-string";
const pv=NativeString.hostUtf8Bytes;
/** TextUtil.pm eurl: Perl codepoint sprintf, not encodeURIComponent/UTF8 percent encoding. */
export function generalEscapeUrl(input:unknown):NativeString {
    const value=scalarPV(input);let result="";
    for(const character of byteCharacters(value)) {
        const cp=characterCodepoint(character);
        const byte=cp<=127n?Number(cp):-1;
        if(byte===32)result+="+";
        else if(byte>=65&&byte<=90||byte>=97&&byte<=122||byte>=48&&byte<=57||
            [95,44,45,46,47,92,58].includes(byte))result+=String.fromCharCode(byte);
        else result+="%"+cp.toString(16).toUpperCase().padStart(2,"0");
    }
    return NativeString.fromFrame({bytes:Buffer.from(result,"ascii"),utf8:value.flagged()});
}
/** Hash enumeration order is unspecified natively; duplicate keys remain last-wins. */
export function generalMakeLink(url:unknown,values:readonly (readonly [unknown,unknown])[]):NativeString {
    const hash=runtime.makeHash(values);let output=scalarPV(url),separator=pv("?");
    for(const key of runtime.hashKeys(hash)) {
        const value=scalarPV(runtime.memberSlot(hash,key,"hash").get());
        if(!value.bytes().length)continue;
        output=concatStrings(concatStrings(concatStrings(concatStrings(output,separator),scalarPV(key)),pv("=")),value);
        separator=pv("&");
    }
    return output;
}
