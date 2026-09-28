// general-approved-page-source.test.ts
//
// Selected SQL to named Recent and Entry worker input, without original bags.
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
import {NativeString} from "../runtime/native-scalar";
import {GeneralSelectedText} from "../live/domain/general-selected-text";
import {generalApprovedPageSource} from "../live/domain/general-approved-page-source";
import {encodeGeneralModel,decodeGeneralModel} from "../live/render/general-model-wire";
import type {GeneralTextEncoding} from "../live/domain/general-text-encoding";
import type {GeneralPageInput} from "../live/domain/general-page-model";
import {withSelectedFixture} from "./selected-fixture";

test("selected Recent and Entry descriptors keep original source bags in the parent",{
    skip:process.env.S2_SELECTED_FIXTURE!=="1"
},async()=>withSelectedFixture(async fixture=>{
    const pv=NativeString.hostUtf8Bytes;
    const noEncoding={async item(){throw Error("Unexpected charset conversion");}} as unknown as GeneralTextEncoding;
    const page={journalTitle:pv("Selected public page")} as unknown as GeneralPageInput;
    const options={page,
        recent:{navigation:{filterActive:0,filterName:pv(""),filterTags:0,
            selectionHead:pv(""),feedTagQuery:pv(""),linkAttributes:[]},
            entry:()=>({permalinkUrl:pv("/257.html"),adultContentLevel:pv("none"),
                content:{suspendMessage:0,noEntryBody:0,noHtml:0,cutUrl:pv("/257.html"),cutDisable:0}})},
        directEntry:{thread:0,entry:()=>({permalinkUrl:pv("/257.html"),
            adultContentLevel:pv("none"),mode:0,suspendMessage:0,noHtml:0})}};
    const direct=await fixture.store.loadNativeSelectedSnapshot(
        fixture.request("ordinary6",{kind:"entry",ditemid:257}));
    assert.ok(direct);
    const directText=await GeneralSelectedText.prepare(direct,noEncoding);
    const entry=generalApprovedPageSource(direct,directText,options);
    assert.equal(entry.kind,"entry");
    if(entry.kind!=="entry")throw Error("Entry branch missing");
    assert.equal(entry.page.entry.content.ditemid,257);
    assert.equal(entry.page.entry.content.journalName.bytes().toString(),"ordinary6");
    assert.equal(entry.page.entry.content.subject?.bytes().toString(),"Plain subject");
    const directModel=encodeGeneralModel(entry);
    const directWire=JSON.stringify(directModel);
    for(const privateKey of ["sources","fingerprint","props","pictureAccounts"])
        assert.equal(directWire.includes(`\"${privateKey}\"`),false);
    const received=decodeGeneralModel(directModel) as typeof entry;
    assert.equal(received.kind,"entry");
    if(received.kind!=="entry")throw Error("Entry wire branch missing");
    assert.deepEqual(received.page.entry.content.subject?.bytes(),entry.page.entry.content.subject?.bytes());
    const unissued={...direct,facts:{...direct.facts,entries:[{...direct.facts.entries[0]!}]}};
    let unissuedCallbackCalls=0;
    assert.throws(()=>generalApprovedPageSource(unissued,directText,{...options,
        directEntry:{...options.directEntry,entry(){unissuedCallbackCalls++;
            return options.directEntry.entry();}}}));
    assert.equal(unissuedCallbackCalls,0);
    const recent=await fixture.store.loadNativeSelectedSnapshot(
        fixture.request("ordinary6",{kind:"recent",skip:0,itemshow:1}));
    assert.ok(recent);
    const recentText=await GeneralSelectedText.prepare(recent,noEncoding);
    const window=generalApprovedPageSource(recent,recentText,options);
    assert.equal(window.kind,"recent");
    if(window.kind!=="recent")throw Error("Recent branch missing");
    assert.equal(window.page.selection.window.length,recent.recentSelection?.window.length);
    const selectedHeader=recent.recentSelection?.window[0];assert.ok(selectedHeader);
    const selectedEntry=recent.facts.entries.find(row=>row.jitemid===selectedHeader.jitemid);
    assert.ok(selectedEntry);
    assert.equal(window.page.selection.window[0]?.entry?.content.ditemid,
        selectedEntry.jitemid*256+selectedEntry.anum);
    assert.equal(JSON.stringify(encodeGeneralModel(window)).includes("\"sources\""),false);
    assert.equal(await fixture.store.revalidateNativeSelectedFingerprint(direct),true);
    assert.equal(await fixture.store.revalidateNativeSelectedFingerprint(recent),true);
}));
