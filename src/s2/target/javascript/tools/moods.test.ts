// moods.test.ts
//
// Independent retained mood/icon and coordinate wrapper expectations.
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
import {test} from "node:test";
import {spawnSync} from "node:child_process";
import {resolve} from "node:path";
import {locationCurrent,coordinateFixed} from "../live/domain/location";
import {moodSelection} from "../live/domain/moods";
import {config} from "../live/tests/fixtures";
import type {RawMoods} from "../live/contracts";
const {createEntryCleaner}=require(resolve(__dirname,"../../../../../content/dist")) as typeof import("@dreamwidth/content");
const limits={maxInputBytes:65536,maxOutputBytes:2097152,maxNodes:4096,maxDepth:16,
    maxCssBytes:65536,maxCssNodes:4096,maxImageCandidates:256,maxCuts:16};
const context={policy:"dreamwidth-entry-html-raw0-v1" as const,insertionContext:"html-div-flow" as const,
    documentUrl:"https://journal.invalid/384.html",entryUrl:"https://journal.invalid/384.html",
    journalUsername:"ordinary",journalId:11,entryId:384,cuts:"source-compatible-entry" as const,...config.entryContent,
    reader:{removeColors:false,removeSizes:false,removeFonts:false,maxImageWidth:null,maxImageHeight:null,
        placeholderUndefinedImageSize:false,extractImages:false}};
test("31 native current wrappers, half-even ties and theme/image inheritance",()=>{
    const call=spawnSync("perl",[resolve(__dirname,"../../tools/moods-native.pl")],{encoding:"utf8",timeout:10000});
    assert.equal(call.status,0,call.stderr);const rows=JSON.parse(call.stdout);assert.equal(rows.length,31);
    const cleaner=createEntryCleaner(limits);
    try{for(const row of rows){
        if(row.kind==="location"){
            const actual=locationCurrent(row.props.current_coords,row.props.current_location);
            assert.ok(Object.hasOwn(row.currents,"Location"));
            assert.equal(actual,row.currents.Location??"",row.id+" native caught-undef key");continue;
        }
        const raw:RawMoods={moods:[{id:1,name:"Happy",parent:0},{id:2,name:"Child",parent:1},
            {id:3,name:"Cycle",parent:4},{id:4,name:"Cycle2",parent:3}],
            theme:row.id==="themazero"?null:{id:7,name:row.themeName},
            pictures:[{moodid:1,url:row.id==="relative"?"/other/h.png":row.id==="inherited"?"/img/h.png":
                row.id==="invalidurl"?"javascript:x":"https://img.invalid/h.png",width:0,height:16}]};
        const selectedConfig={...config,imgPrefix:"https://app.invalid/img"};
        if(row.id==="cycle"){
            assert.match(row.error,/NATIVE_CYCLE_TIMEOUT/);
            assert.throws(()=>moodSelection(raw,3,selectedConfig),"visited cycle safety refusal");continue;
        }
        const value=moodSelection(raw,row.props.current_moodid,selectedConfig);
        const custom=row.props.current_mood&&row.props.current_mood!=="0"?row.props.current_mood:"";
        const cleaned=cleaner.subject({source:custom,context});assert.equal(cleaned.kind,"ok");
        if(cleaned.kind!=="ok")throw Error(row.id);
        assert.equal(cleaned.subject.html && cleaned.subject.html!=="0" ? cleaned.subject.html : value.name,row.currents.Mood,row.id);
        assert.deepEqual(value.icon?[value.icon.url,value.icon.width,value.icon.height]:null,row.icon,row.id);
    }}finally{cleaner.close();}
    assert.equal(coordinateFixed(0.03125),"0.0312");assert.equal(coordinateFixed(-0.03125),"-0.0312");
    assert.equal(coordinateFixed(0.09375),"0.0938");assert.equal(coordinateFixed(-0.09375),"-0.0938");
    assert.equal(locationCurrent("1.0,2.0\n\n","Text"),"");
    assert.equal(locationCurrent("1.0N,2.0E\r\n","Text"),"");
});
test("source https_url exact case/domain and malformed vocabulary boundaries",()=>{
    const raw:RawMoods={moods:[{id:1,name:"Happy",parent:0}],theme:{id:7,name:"Theme"},
        pictures:[{moodid:1,url:"http://img.example.org/h.png",width:1,height:2}]};
    const cfg={...config,entryContent:{...config.entryContent,urls:{...config.entryContent.urls,
        siteDomain:"",knownHttpsSites:["example.org"]}}};
    assert.equal(moodSelection(raw,1,cfg).icon?.url,"https://img.example.org/h.png");
    assert.equal(moodSelection(raw,1,{...cfg,entryContent:{...cfg.entryContent,urls:{...cfg.entryContent.urls,
        knownHttpsSites:["EXAMPLE.ORG"]}}}).icon?.url,"http://img.example.org/h.png");
    assert.throws(()=>moodSelection({...raw,moods:[{id:1,name:"<script>x</script>",parent:0}]},1,cfg));
});
