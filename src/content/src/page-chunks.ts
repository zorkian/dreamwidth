// page-chunks.ts
//
// Neutral page-buffer flag upgrades and HTML::Parser byte-entry conversion.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.
//

import type {PageChunk} from "./page-output-types";
const utf8=new TextDecoder("utf-8",{fatal:true});
const encoder=new TextEncoder();

export function copyChunk(chunk: PageChunk): PageChunk {
    if(!(chunk.bytes instanceof Uint8Array) || typeof chunk.utf8 !== "boolean")throw new Error("Invalid page scalar");
    return {bytes:Uint8Array.from(chunk.bytes),utf8:chunk.utf8};
}
// A reversible tokenizer/screening view. It is never UTF8 output authority.
export function byteView(bytes: Uint8Array): string {
    let value="";
    for(let start=0;start<bytes.length;start+=8192)value+=String.fromCharCode(...bytes.subarray(start,start+8192));
    return value;
}
export function scalarView(chunk: PageChunk): string {return chunk.utf8 ? utf8.decode(chunk.bytes) : byteView(chunk.bytes);}
export function viewChunk(value: string, flag=false): PageChunk {
    if(flag)return {bytes:encoder.encode(value),utf8:true};
    const bytes=new Uint8Array(value.length);
    for(let i=0;i<value.length;i++) {
        const code=value.charCodeAt(i);
        if(code>255)throw new Error("Non-byte page view");
        bytes[i]=code;
    }
    return {bytes,utf8:false};
}
export function concatenate(chunks: readonly PageChunk[]): PageChunk {
    const flag=chunks.some(chunk=>chunk.utf8);
    if(flag)return viewChunk(chunks.map(scalarView).join(""),true);
    const bytes=new Uint8Array(chunks.reduce((sum,c)=>sum+c.bytes.length,0));
    let offset=0;for(const c of chunks){bytes.set(c.bytes,offset);offset+=c.bytes.length;}
    return {bytes,utf8:false};
}
// HTML::Parser's byte-entry API downgrades a flagged scalar if every character
// fits one octet; a wide character throws. utf8_mode affects entity decoding,
// not the calling scalar's SvPVbyte conversion. No replacement is permitted.
export function parserView(chunk: PageChunk): string {
    const view=scalarView(chunk);
    if(chunk.utf8 && Array.from(view).some(char=>char.codePointAt(0)!>255))
        throw new Error("Wide character in native HTML parser entry");
    return view;
}
export function encodedEntityView(value: string): string {return byteView(encoder.encode(value));}
