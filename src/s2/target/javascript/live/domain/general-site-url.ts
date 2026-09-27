// general-site-url.ts
//
// Retained lj/site URL expansion with native scalar and username semantics.
//
// Portions adapted from LJ::CleanHTML::ExpandLJURL, forked from the
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

import {NativeString,concatStrings,splitString} from "../../runtime/native-string";
import {scalarTruthy,scalarPV,scalarNumber,NativeNumber} from "../../runtime/native-scalar";
import {runtime} from "../../runtime/s2runtime";
import type {NativeProfile} from "../../runtime/native-profile";
import {canonicalPublicUsername} from "./general-public-session";

const bytes=(value:string)=>NativeString.hostUtf8Bytes(value);
export function expandGeneralSiteUrl(path:NativeString,siteRoot:NativeString,profile:NativeProfile,
    usernameMaximum:number):NativeString {
    const args=splitString(path,bytes("/")).filter(value=>scalarTruthy(value));
    const mode=args.shift()?.bytes().toString("latin1")??"";
    let uri:NativeString;
    const user=()=>canonicalPublicUsername(args.shift()??bytes(""),profile,usernameMaximum);
    if(mode==="faq"||mode==="support") {
        const id=runtime.scalarBinary("+",scalarNumber(args.shift()),NativeNumber.integer(0n));
        const prefix=mode==="faq"?"support/faqbrowse?faqid=":"support/see_request?id=";
        uri=scalarTruthy(id)?concatStrings(bytes(prefix),scalarPV(id)):bytes(mode==="faq"?"support/faq":"support/");
    }else if(mode==="memories"||mode==="userinfo"||mode==="userpics") {
        const name=user(),prefix=mode==="userinfo"?"profile":mode==="userpics"?"allpics":"memories";
        uri=bytes(prefix+(name?"?user="+name:""));
    }else if(mode==="user") {
        const name=user();
        if(args.some(value=>/["'<>\n&]/.test(value.bytes().toString("latin1"))))uri=bytes("");
        else if(args[0]?.bytes().equals(Buffer.from("profile")))uri=bytes("profile?user="+name);
        else {
            uri=bytes("users/"+name+"/");
            for(const arg of args)uri=concatStrings(uri,concatStrings(arg,bytes("/")));
        }
    }else uri=bytes("error:bogus-lj-url");
    return concatStrings(concatStrings(siteRoot,bytes("/")),uri);
}
