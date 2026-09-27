// general-image-url.ts
//
// Retained image URL upgrade with installed native word classes and deferred proxy.
//
// Portions adapted from LJ::CleanHTML::https_url, forked from the
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

import {createHash} from "node:crypto";
import {NativeString,byteCharacters,characterCodepoint} from "../../runtime/native-string";
import type {NativeProfile} from "../../runtime/native-profile";
import {runtime} from "../../runtime/s2runtime";

export interface GeneralImageUrlFacts {
    readonly sourceDigest:string;
    readonly siteDomain:NativeString;
    readonly knownHttpsSites:readonly NativeString[];
}
export interface GeneralImageUrlFrames {
    readonly siteDomain:{readonly base64:string;readonly utf8:boolean};
    readonly knownHttpsSites:readonly {readonly base64:string;readonly utf8:boolean}[];
}
function decodeNativeUrlFrame(frame:GeneralImageUrlFrames["siteDomain"]):NativeString {
    if(typeof frame.base64!=="string"||typeof frame.utf8!=="boolean")throw Error("Invalid native URL frame");
    const bytes=Buffer.from(frame.base64,"base64");
    if(bytes.length>16384||bytes.toString("base64")!==frame.base64)throw Error("Invalid native URL frame");
    return NativeString.fromFrame({bytes,utf8:frame.utf8});
}
/** Trusted setup value used by parent selected-Image approval, not a child URL claim. */
export function prepareGeneralUserpicRoot(frame:GeneralImageUrlFrames["siteDomain"]):
    {readonly value:NativeString;readonly sourceDigest:string} {
    const value=decodeNativeUrlFrame(frame);
    const sourceDigest=createHash("sha256").update(JSON.stringify(["USERPIC_ROOT",frame.base64,frame.utf8])).digest("hex");
    return Object.freeze({value,sourceDigest});
}
/** Parent setup binds these validated source frames into the request config identity. */
export function prepareGeneralImageUrlFacts(frames:GeneralImageUrlFrames):GeneralImageUrlFacts {
    if(!Array.isArray(frames.knownHttpsSites)||frames.knownHttpsSites.length>4096)
        throw Error("Invalid native URL facts");
    const sourceDigest=createHash("sha256").update(JSON.stringify([frames.siteDomain,frames.knownHttpsSites])).digest("hex");
    return Object.freeze({sourceDigest,siteDomain:decodeNativeUrlFrame(frames.siteDomain),
        knownHttpsSites:Object.freeze(frames.knownHttpsSites.map(decodeNativeUrlFrame))});
}
const patterns=new WeakMap<object,{byte:RegExp;unicode:RegExp}>();
function domainPattern(profile:NativeProfile,utf8:boolean):RegExp {
    let pair=patterns.get(profile);
    if(!pair) {
        const build=(flag:boolean)=>{
            const ranges=profile.word[flag?"unicode":"byte"],pieces:string[]=[];
            for(let index=0;index<ranges.length;index+=2) {
                const first=ranges[index]!,last=Math.min((ranges[index+1]??0x110000)-1,flag?0x10ffff:255);
                if(first>last)continue;
                pieces.push("\\u{"+first.toString(16)+"}"+(first===last?"":"-\\u{"+last.toString(16)+"}"));
            }
            // This is the fixed retained regex with its \w class supplied by
            // the installed Perl inversion list, not Node's Unicode version.
            return new RegExp("^http://[^/]*?([^.]+\\.["+pieces.join("")+"]{2,3})/","du");
        };
        pair={byte:build(false),unicode:build(true)};patterns.set(profile,pair);
    }
    return pair[utf8?"unicode":"byte"];
}
/** Cleaner journal/ditemid are byte-empty. Proxying remains explicitly deferred. */
export function normalizeGeneralImageUrl(input:NativeString,facts:GeneralImageUrlFacts,
    profile:NativeProfile):NativeString {
    if(!NativeString.is(input)||!NativeString.is(facts.siteDomain)||
        facts.knownHttpsSites.some(value=>!NativeString.is(value)))throw Error("Invalid installed image URL facts");
    const bytes=input.bytes();
    if(bytes.subarray(0,8).equals(Buffer.from("https://"))||bytes.subarray(0,2).equals(Buffer.from("//")))return input.clone();
    let view="",byteOffset=0;
    const boundaries=new Map<number,number>([[0,0]]);
    for(const character of byteCharacters(input)) {
        const point=characterCodepoint(character);
        // The fixed regex treats out-of-Unicode points as non-word, non-dot,
        // non-slash characters. Only its screening view uses this equivalent
        // non-word sentinel; captured/output bytes always come from the PV.
        view+=String.fromCodePoint(Number(point<=0x10ffffn?point:0x10ffffn));
        byteOffset+=character.bytes().length;boundaries.set(view.length,byteOffset);
    }
    const match=domainPattern(profile,input.flagged()).exec(view),span=match?.indices?.[1];
    if(span!==undefined) {
        const start=boundaries.get(span[0]),end=boundaries.get(span[1]);
        if(start===undefined||end===undefined)throw Error("Invalid native URL regex span");
        const domain=NativeString.fromFrame({bytes:bytes.subarray(start,end),utf8:input.flagged()});
        const known=runtime.makeHash(facts.knownHttpsSites.map(value=>[value,true] as const));
        if(runtime.scalarCompare("string","==",domain,facts.siteDomain)||runtime.memberSlot(known,domain,"hash").get())
            return NativeString.fromFrame({bytes:Buffer.concat([Buffer.from("https:"),bytes.subarray(5)]),utf8:input.flagged()});
    }
    // Operational proxy omission is explicit: retain original, no signing,
    // salt lookup, fetch, implicit HTTP upgrade or configured-site refusal.
    return input.clone();
}
