// crossposts.ts
//
// Finite network Storable plain-map crosspost projection, without object thawing.
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

import {SnapshotError} from "../data/errors";
import {navigationUrl} from "./links";

function unsupported(): never {throw new SnapshotError("unsupported");}
export function opaqueCrosspostBytes(base64: string): Buffer {
    if (typeof base64 !== "string" || base64.length > 10924) unsupported();
    const bytes=Buffer.from(base64,"base64");
    if (bytes.length>8192 || bytes.toString("base64")!==base64) unsupported();
    return bytes;
}

// Perl5.34.0 dist/Storable/Storable.xs:168-192,1010-1025,1072-1088,
// 1136-1155,2531-2561,3157+,6464-6534. Values precede length-prefixed keys.
// No alias table, recursive generic reader, blessings or user-defined hooks.
export function decodeCrosspostLinks(base64: string): readonly string[] {
    const bytes=opaqueCrosspostBytes(base64);let offset=0;
    const take=(count:number):Buffer=>{
        if (!Number.isSafeInteger(count)||count<0||count>bytes.length-offset) unsupported();
        const result=bytes.subarray(offset,offset+count);offset+=count;return result;
    };
    const byte=():number=>take(1)[0]!;
    const length=():number=>take(4).readInt32BE(0);
    const text=(value:Buffer):string=>{
        try{return new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(value);}
        catch{unsupported();}
    };
    const key=():string=>{
        const value=take(length());
        if (value.some(part=>part>127)) unsupported();
        return value.toString("ascii");
    };
    const count=():number=>{
        const value=length();
        // Each hash member needs at least a scalar tag and a four-byte key length.
        if (value<0||value>Math.floor((bytes.length-offset)/5)) unsupported();
        return value;
    };
    const scalar=():string|number|null=>{
        const tag=byte();
        if (tag===5)return null;
        if (tag===8)return byte()-128;
        if (tag===9)return length();
        if (tag===10||tag===23)return text(take(byte()));
        if (tag===1||tag===24)return text(take(length()));
        unsupported();
    };
    if (byte()!==5||byte()!==11||byte()!==3)unsupported();
    const members=count(),seen=new Set<string>();
    const links:{id:bigint;url:string}[]=[];
    for(let index=0;index<members;index++){
        const tag=byte();let url:string|number|null=null;
        if(tag===4){
            if(byte()!==3)unsupported();
            const fields=count(),names=new Set<string>();
            if(fields>2)unsupported();
            for(let field=0;field<fields;field++){
                const value=scalar(),name=key();
                if(!["itemid","url"].includes(name)||names.has(name))unsupported();
                names.add(name);if(name==="url")url=value;
            }
        }else if(tag!==5)unsupported();
        const id=key();
        if(!/^[1-9][0-9]*$/.test(id)||seen.has(id))unsupported();
        seen.add(id);
        if(url!==null&&url!==""&&url!=="0"&&url!==0){
            if(typeof url!=="string")unsupported();
            links.push({id:BigInt(id),url:navigationUrl(url)});
        }
    }
    if(offset!==bytes.length)unsupported();
    return Object.freeze(links.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0).map(row=>row.url));
}

export function approveCrosspostUrls(base64: string, entryUrl: string): readonly string[] {
    const urls=decodeCrosspostLinks(base64);
    for(const value of urls){
        try{navigationUrl(new URL(value,entryUrl).href);}catch{unsupported();}
    }
    return urls;
}
