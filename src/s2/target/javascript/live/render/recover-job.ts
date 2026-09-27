// recover-job.ts
//
// Credential-free, cancellable compiler-service active recovery job.
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


import {readSync,writeSync} from "node:fs";
// Explicit file resolution avoids probing an ungranted directory package.json.
import {recoverActiveLayer} from "./recovery/index";
const parts:Buffer[]=[];let size=0;
try {
    const chunk=Buffer.alloc(65536);
    for(;;){const count=readSync(0,chunk,0,chunk.length,null);if(!count)break;
        size+=count;if(size>134217728)throw Error("input");parts.push(Buffer.from(chunk.subarray(0,count)));}
    const input=JSON.parse(Buffer.concat(parts).toString("utf8"));
    if(!input||!Number.isSafeInteger(input.abi)||input.abi<1||!Array.isArray(input.layers)||input.layers.length>6)throw Error("input");
    const output=input.layers.map((row:any)=>{
        if(!row||typeof row.activeBase64!=="string"||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(row.activeBase64))throw Error("input");
        const activeBytes=Buffer.from(row.activeBase64,"base64");
        if(activeBytes.length>16777215)throw Error("input");
        return recoverActiveLayer({...row,activeBytes},input.abi);
    });
    const bytes=Buffer.from(JSON.stringify(output));if(bytes.length>134217728)throw Error("output");
    let offset=0;while(offset<bytes.length)offset+=writeSync(1,bytes,offset,bytes.length-offset);
}catch{process.exitCode=1;}
