// public-translation.test.ts
//
// Independent installed ML precedence and byte-preserving variable proof.
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

import assert from "node:assert/strict";
import test from "node:test";
import {execFileSync} from "node:child_process";
import {mkdtempSync,writeFileSync,utimesSync,rmSync} from "node:fs";
import path from "node:path";
import {tmpdir} from "node:os";
import {NativeString} from "../runtime/native-string";
import {selectPublicTranslation,interpolatePublicTranslation} from "../live/domain/public-translation";
const bytes=(value:string)=>NativeString.hostUtf8Bytes(value);
test("installed ML precedence and vars retain native bytes without persistence",async()=>{
    const directory=mkdtempSync(path.join(tmpdir(),"s2-public-language-"));
    const code="cleanhtml.error.template";
    const specs=[
        {dev:true,lang:"en",file:"FILE [[aopts]]",db:"DB",changed:0},
        {dev:true,lang:"en",file:"OLD",db:"NEW",changed:1700000000},
        {dev:false,lang:"en",file:"FILE",db:"DB",changed:0},
        {dev:false,lang:"en",file:"FALLBACK",db:"",changed:0},
        {dev:true,lang:"en",file:"0",db:"DB",changed:0},
        {dev:false,lang:"en",file:"FILE",db:"0",changed:0},
        {dev:true,lang:"fr",file:"FILE",db:"[[?aopts|one|many]] [[absent]] [[aopts]]",changed:0},
        {dev:true,lang:"debug",file:"FILE",db:"DB",changed:0},
    ];
    try {
        const nativeRows=specs.map((row,index)=>{
            const file=path.join(directory,index+".dat");
            writeFileSync(file,Buffer.from(code+"="+row.file+"\n"));utimesSync(file,1600000000,1600000000);
            return {...row,file,code,db:Buffer.from(row.db).toString("base64"),vars:{aopts:Buffer.from([0xff,60,38,62]).toString("base64")}};
        });
        const native=JSON.parse(execFileSync("perl",["tools/public-translation-native.pl"],
            {input:JSON.stringify(nativeRows),encoding:"utf8",timeout:15000}));
        for(const [index,row] of specs.entries()) {
            let reads=0;
            const selected=await selectPublicTranslation({language:row.lang,defaultLanguage:"en",isDevServer:row.dev,
                changedSeconds:row.changed,files:[{modifiedSeconds:1600000000,value:bytes(row.file)}],
                fromDatabase:()=>{reads++;return bytes(row.db);}},code);
            const value=interpolatePublicTranslation(selected,row.lang,new Map([["aopts",NativeString.bytes(Buffer.from([0xff,60,38,62]))]]));
            assert.equal(value.bytes().toString("base64"),native[index].base64,JSON.stringify(row));
            assert.equal(Number(value.flagged()),native[index].flag);
            assert.equal(reads,native[index].reads);
        }
        assert.equal(native[3].writes,1); // Observed native auto-load; viewer deliberately performs no write.
    }finally{rmSync(directory,{recursive:true,force:true});}
});
