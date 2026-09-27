// general-standard-images-client.ts
//
// Synchronous child adapter for private standard-image facts and native translations.
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

import {NativeString,decodeScalar,encodeScalar,type NativeScalarWire} from "../../runtime/native-scalar";
import type {GeneralStandardImageFacts} from "../domain/general-standard-images";
import type {GeneralWorkerChannel} from "./general-worker-channel";
import {generalNativeHostValue} from "./general-native-host-result";
import {PrivateTransportError} from "./private-transport";
function record(input:unknown,keys:readonly string[]):Record<string,unknown> {
    if(!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).length!==keys.length||
        keys.some(key=>!Object.hasOwn(input,key)))throw new PrivateTransportError();
    return input as Record<string,unknown>;
}
function frame(input:unknown):NativeString {
    const value=record(input,["base64","utf8"]);
    if(typeof value.base64!=="string"||typeof value.utf8!=="boolean"||value.base64.length>21848)
        throw new PrivateTransportError();
    const bytes=Buffer.from(value.base64,"base64");
    if(bytes.length>16384||bytes.toString("base64")!==value.base64)throw new PrivateTransportError();
    return NativeString.fromFrame({bytes,utf8:value.utf8});
}
function scalar(input:unknown):unknown {
    if(input===null)return undefined;
    try {
        // Key order is not a scalar ABI: the trusted Perl producer emits
        // canonical JSON order while the shared JS encoder uses field order.
        const canonical=(value:unknown)=>JSON.stringify(value,(_key,item)=>item&&typeof item==="object"&&!Array.isArray(item)?
            Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
        if(canonical(input).length>32768)throw new PrivateTransportError();
        const value=decodeScalar(input as NativeScalarWire);
        if(canonical(encodeScalar(value))!==canonical(input))throw new PrivateTransportError();
        return value;
    }catch{throw new PrivateTransportError();}
}
export class GeneralStandardImageClient {
    private translations:readonly {key:NativeString|undefined;value:unknown}[]=[];
    private cursor=0;
    constructor(private readonly channel:Pick<GeneralWorkerChannel,"host">) {}
    sourceFacts():GeneralStandardImageFacts {
        const reply=this.channel.host("standard-images",{version:1},value=>generalNativeHostValue(value,response=>{
            const result=record(response,["source","translations"]),source=record(result.source,["prefix","images"]);
            if(!Array.isArray(source.images)||source.images.length>4096||!Array.isArray(result.translations)||result.translations.length!==16)
                throw new PrivateTransportError();
            const names=new Set<string>();
            const facts={prefix:frame(source.prefix),images:source.images.map(input=>{
                const image=record(input,["name","src","width","height","altKey"]);
                if(typeof image.name!=="string"||image.name.length>256||names.has(image.name))throw new PrivateTransportError();
                names.add(image.name);
                return {name:NativeString.hostUtf8Bytes(image.name),src:image.src===null?undefined:frame(image.src),
                    width:scalar(image.width),height:scalar(image.height),altKey:image.altKey===null?undefined:frame(image.altKey)};
            })};
            return {facts,translations:result.translations.map(input=>{
                const translation=record(input,["key","value"]);
                return {key:translation.key===null?undefined:frame(translation.key),value:scalar(translation.value)};
            })};
        }));
        this.translations=reply.translations;this.cursor=0;return reply.facts;
    }
    translate(key:NativeString|undefined):unknown {
        const value=this.translations[this.cursor++];
        if(!value||(key===undefined)!==(value.key===undefined)||key&&value.key&&
            (key.flagged()!==value.key.flagged()||!key.bytes().equals(value.key.bytes())))throw new PrivateTransportError();
        return value.value;
    }
}
