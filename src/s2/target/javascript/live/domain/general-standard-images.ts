// general-standard-images.ts
//
// Installed standard-image facts and ordered public translation witnesses.
//
// Portions adapted from LJ::S2::Image_std, forked from the
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
import type {StandardImageConfiguration,StandaloneStartupConfig} from "../startup-types";
import {GeneralMlRequestContext} from "./public-translation";
import {NativeString,decodeScalar,encodeScalar,type NativeScalarWire} from "../../runtime/native-scalar";
const translated=["btn_del","btn_freeze","btn_unfreeze","btn_scr","btn_unscr","editcomment","editentry",
    "edittags","tellfriend","memadd","prev_entry","next_entry","track","untrack","atom","rss"] as const;
/** Native RequestWrapper facts, with scope supplied only by the trusted request. */
export function installedImageLanguageContext(facts:StandaloneStartupConfig["nativeLanguageContext"],
    scope?:NativeString,noteScope?:NativeString):GeneralMlRequestContext {
    if(!facts)throw Error("Installed request language facts are unavailable; re-export configuration");
    const frame=(value:{base64:string;utf8:boolean}|null)=>value===null?undefined:
        NativeString.fromFrame({bytes:Buffer.from(value.base64,"base64"),utf8:value.utf8});
    return new GeneralMlRequestContext(frame(facts.defaultLang),frame(facts.firstLang),scope,noteScope);
}
export interface GeneralStandardImageFacts {
    readonly prefix:NativeString;
    readonly images:readonly {readonly name:NativeString;readonly src:NativeString|undefined;
        readonly width:unknown;readonly height:unknown;readonly altKey:NativeString|undefined}[];
}
export interface GeneralStandardImageReply {
    readonly source:StandardImageConfiguration;
    // Ordered source calls, not a hash that would collapse duplicate alt keys.
    readonly translations:readonly {readonly key:{readonly base64:string;readonly utf8:boolean}|null;
        readonly value:NativeScalarWire|null}[];
}
/** Private validated startup facts; no child name can select configuration fields. */
export class GeneralStandardImages {
    private readonly source:StandardImageConfiguration;
    readonly identity:string;
    constructor(configuration:StandardImageConfiguration) {
        this.source=structuredClone(configuration);
        this.identity=createHash("sha256").update(JSON.stringify(this.source)).digest("hex");
    }
    facts():GeneralStandardImageFacts {
        const frame=(value:{base64:string;utf8:boolean}|null)=>value===null?undefined:
            NativeString.fromFrame({bytes:Buffer.from(value.base64,"base64"),utf8:value.utf8});
        return {prefix:frame(this.source.prefix)!,images:this.source.images.map(image=>({
            name:NativeString.hostUtf8Bytes(image.name),src:frame(image.src),altKey:frame(image.altKey),
            width:image.width===null?undefined:decodeScalar(image.width),height:image.height===null?undefined:decodeScalar(image.height)}))};
    }
    async reply(localize:(key:NativeString|undefined)=>Promise<NativeString|undefined>):Promise<GeneralStandardImageReply> {
        const translations:GeneralStandardImageReply["translations"][number][]=[];
        for(const name of translated) {
            const image=this.source.images.find(image=>image.name===name),key=image?.altKey??null;
            const value=await localize(key===null?undefined:NativeString.fromFrame({bytes:Buffer.from(key.base64,"base64"),utf8:key.utf8}));
            translations.push({key,value:value===undefined?null:encodeScalar(value)});
        }
        return {source:structuredClone(this.source),translations};
    }
}
