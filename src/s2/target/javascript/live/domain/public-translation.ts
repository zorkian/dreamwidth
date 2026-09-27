// public-translation.ts
//
// Resolve reached public cleaner messages with retained ML precedence.
//
// Portions adapted from LJ::Lang and LJ::LangDatFile, forked from the
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
import {scalarNumber,scalarTruthy,NativeNumber} from "../../runtime/native-scalar";
import {runtime} from "../../runtime/s2runtime";

export const SUBJECT_TRANSLATION_KEYS = {
    template: "cleanhtml.error.template",
    video: "cleanhtml.error.template.video",
    markup: "cleanhtml.error.markup.extra",
} as const;
export type SubjectTranslationName = keyof typeof SUBJECT_TRANSLATION_KEYS;
export interface PublicTranslationFile {
    readonly modifiedSeconds: number;
    readonly value: NativeString | undefined;
}
export interface PublicTranslationInputs {
    readonly language: string;
    readonly defaultLanguage: string;
    readonly isDevServer: boolean;
    readonly changedSeconds: number;
    readonly files: Iterable<PublicTranslationFile>;
    // Lazy: native file-first success does not call get_text_multi. Missing
    // language is a semantic error only when the DB getter is actually reached.
    readonly fromDatabase: () => NativeString | Promise<NativeString>;
}
const bytes = (text: string): NativeString => NativeString.hostUtf8Bytes(text);
export const isMissingPublicTranslation = (value: NativeString): boolean => {
    const raw=value.bytes();
    return !raw.length || raw.subarray(0,15).equals(Buffer.from("[missing string")) ||
        raw.subarray(0,6).equals(Buffer.from("[uhhh:"));
};

/** Lang.pm598-684, with the user-authorized SELECT-only/cache-free boundary. */
export async function selectPublicTranslation(input: PublicTranslationInputs, code: string): Promise<NativeString> {
    if(input.language==="debug")return bytes(code);
    const fromFiles=async():Promise<NativeString>=>{
        for(const file of input.files) {
            if(!file.modifiedSeconds || input.changedSeconds>file.modifiedSeconds)return input.fromDatabase();
            if(file.value && scalarTruthy(file.value))return file.value;
        }
        return bytes(`[missing string ${code}]`);
    };
    const fileFirst=input.isDevServer && (input.language==="en" || input.language===input.defaultLanguage);
    let value=await (fileFirst?fromFiles():input.fromDatabase());
    if(!input.isDevServer && isMissingPublicTranslation(value)) {
        const fallback=await fromFiles();
        if(!isMissingPublicTranslation(fallback))value=fallback;
    }
    return scalarTruthy(value)?value:bytes(input.isDevServer?`[uhhh: ${code}]`:"");
}

function pluralIndex(language:string,count:unknown):number {
    const number=scalarNumber(scalarTruthy(count)?count:NativeNumber.integer(0n));
    const constant=(value:number)=>NativeNumber.integer(BigInt(value));
    const compare=(op:string,left:unknown,right:number)=>runtime.scalarCompare("int",op,left,constant(right));
    const mod10=runtime.scalarBinary("%",number,constant(10));
    const mod100=runtime.scalarBinary("%",number,constant(100));
    const one=compare("==",mod10,1)&&!compare("==",mod100,11);
    const few=compare(">=",mod10,2)&&compare("<=",mod10,4)&&
        (compare("<",mod100,10)||compare(">=",mod100,20));
    if(/^(?:hu|ja|tr)/.test(language))return 0;
    if(/^(?:fr|pt_BR)/.test(language))return compare(">",number,1)?1:0;
    if(/^(?:ru|uk|be)/.test(language))return one?0:few?1:2;
    if(/^pl/.test(language))return compare("==",number,1)?0:few?1:2;
    if(/^lt/.test(language))return one?0:compare(">=",mod10,2)&&
        (compare("<",mod100,10)||compare(">=",mod100,20))?1:2;
    if(/^lv/.test(language))return one?0:compare("!=",number,0)?1:2;
    if(/^is/.test(language))return one?0:1;
    return compare("==",number,1)?0:1;
}

// Match source ASCII delimiters against a byte view; replacements are joined
// through the shared native PV implementation, retaining bytes and UTF8 flags.
function substitute(value:NativeString,pattern:RegExp,replacement:(match:RegExpExecArray)=>NativeString):NativeString {
    const original=value.bytes(),view=original.toString("latin1");
    let result=NativeString.bytes(Buffer.alloc(0)),last=0;
    const slice=(start:number,end:number)=>NativeString.fromFrame({bytes:original.subarray(start,end),utf8:value.flagged()});
    for(const match of view.matchAll(pattern)) {
        result=concatStrings(result,slice(last,match.index));
        result=concatStrings(result,replacement(match));
        last=match.index+match[0].length;
    }
    return concatStrings(result,slice(last,original.length));
}

/** get_text vars are fixed public aopts for these cleaner helpers, not code. */
export function interpolatePublicTranslation(value:NativeString,language:string,
    variables:ReadonlyMap<string,NativeString>|undefined):NativeString {
    if(language==="debug" || variables===undefined)return value;
    let result=substitute(value,/\[\[\?([\w-]+)\|(.+?)\]\]/g,match=>{
        const words=splitString(NativeString.fromFrame({bytes:Buffer.from(match[2]!,"latin1"),utf8:value.flagged()}),bytes("|"));
        return words[pluralIndex(language,variables.get(match[1]!))]??bytes("");
    });
    result=substitute(result,/\[\[([^\[]+?)\]\]/g,match=>variables.get(match[1]!)??bytes(""));
    return result;
}
