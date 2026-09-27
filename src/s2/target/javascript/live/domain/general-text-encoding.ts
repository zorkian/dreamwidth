// general-text-encoding.ts
//
// Source item_toutf8 ordering over selected original byte fields.
//
// Portions adapted from LJ::item_toutf8 / LJ::text_convert, forked from the
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

import {NativeString} from "../../runtime/native-string";
import {nativeTextOut,type NativeEncodingLimits} from "./native-encoding";
import type {GeneralEncodingProfile} from "./general-encoding-profile";
import type {GeneralPublicSession} from "./general-public-session";
import {encodingName,type PublicEncodingSnapshot} from "../data/public-encodings";

export interface ConvertedNativeItem {
    readonly subject:NativeString|undefined;
    readonly text:NativeString|undefined;
    readonly props:Readonly<Record<string,NativeString|undefined>>;
}
/** Parent-only conversion; original snapshot witnesses are never overwritten. */
export class GeneralTextEncoding {
    private codes:PublicEncodingSnapshot|undefined;
    constructor(private readonly session:GeneralPublicSession,
        private readonly profile:GeneralEncodingProfile,private readonly oldEncoding:number,
        private readonly limits:NativeEncodingLimits) {
        if(!Number.isSafeInteger(oldEncoding))throw Error("Invalid native owner old encoding");
    }
    async text(input:NativeString|undefined):Promise<NativeString|undefined> {
        // item_toutf8 does not invoke text_convert for undef. is_ascii excludes
        // NUL but allows other original ASCII bytes, before any codes lookup.
        if(input===undefined)return undefined;
        if(!NativeString.is(input))throw Error("Invalid selected native text");
        if(input.bytes().every(value=>value>=1&&value<=127))return input;
        if(!this.codes?.entries.length)this.codes=await this.session.encoding();
        const name=encodingName(this.codes,this.oldEncoding);
        // Native lookup occurs even when oldenc is zero. Only these source
        // error paths invoke text_out; supported converter failures propagate.
        if(this.oldEncoding===0||name===undefined)return nativeTextOut(input);
        const result=this.profile.convert(name,input,this.limits);
        return result.kind==="converted"?result.value:nativeTextOut(input);
    }
    async item(subject:NativeString|undefined,text:NativeString|undefined,
        props:Readonly<Record<string,NativeString|undefined>>={}):Promise<ConvertedNativeItem> {
        const convertedSubject=await this.text(subject),convertedText=await this.text(text);
        const converted:Record<string,NativeString|undefined>=Object.create(null);
        for(const key of Object.keys(props))converted[key]=key==="xpost"||key==="xpostdetail"?
            props[key]:await this.text(props[key]);
        return Object.freeze({subject:convertedSubject,text:convertedText,props:Object.freeze(converted)});
    }
    current():boolean {return this.profile.current();}
}
