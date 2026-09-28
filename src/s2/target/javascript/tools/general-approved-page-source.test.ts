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
import {generalApprovedPageInput,generalApprovedRecentInput,
    generalApprovedEntryInput} from "../live/render/general-approved-page-client";
import {GeneralUserBindings} from "../live/render/general-user-bindings";
import {generalUser} from "../live/domain/general-model-user";
import {encodeGeneralModel,decodeGeneralModel} from "../live/render/general-model-wire";
import type {GeneralTextEncoding} from "../live/domain/general-text-encoding";
import type {GeneralPageInput} from "../live/domain/general-page-model";
import {withSelectedFixture} from "./selected-fixture";

test("selected Recent and Entry descriptors keep original source bags in the parent",{
    skip:process.env.S2_SELECTED_FIXTURE!=="1"
},async()=>withSelectedFixture(async fixture=>{
    const pv=NativeString.hostUtf8Bytes;
    const noEncoding={async item(){throw Error("Unexpected charset conversion");}} as unknown as GeneralTextEncoding;
    const page:Omit<GeneralPageInput,"journal">={styleId:0,styleModtime:0,baseUrl:pv("/ordinary6"),
        journalType:pv("P"),ownerName:pv("ordinary6"),journalTitle:pv("Selected public page"),
        journalSubtitle:undefined,layoutName:undefined,themeName:undefined,layoutUrl:pv(""),
        getargs:[],viewingStyleOptions:undefined,viewUrls:[],links:[],
        customtext:{title:undefined,url:undefined,content:undefined},
        customtextDefaults:{title:undefined,url:undefined,content:undefined},
        showControlStrip:0,isCanary:0,noMobileCookie:0,sessionMessages:undefined,
        headContent:pv(""),canUseNetwork:0,activeEntries:[]};
    const options={page,userpicRoot:pv("https://www.example.invalid/userpic"),
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
    const bindings=new GeneralUserBindings();let lookups=0;
    const workerBindings={
        loadUser(name){lookups++;assert.equal(name.bytes().toString(),"ordinary6");
            const lite={".type":"UserLite",_user:name};bindings.bind(lite,"a".repeat(64));return lite;},
        prepareUser(lite,picture,url,name){const handle=bindings.account(lite);assert.ok(handle);
            const user=generalUser(lite,picture,url,name);bindings.bind(user,handle);return user;},
    } satisfies Parameters<typeof generalApprovedPageInput>[1];
    const workerPage=generalApprovedEntryInput(received,workerBindings).page;
    assert.equal(lookups,1);
    assert.equal(workerPage.journal[".type"],"User");
    assert.equal(bindings.account(workerPage.journal),"a".repeat(64));
    assert.equal(Object.hasOwn(entry.page.page,"journal"),false);
    assert.throws(()=>generalApprovedPageInput({...received.page.page,journalName:undefined},
        {loadUser(){throw Error("Invalid descriptor reached public host");},
            prepareUser(){throw Error("Invalid descriptor created bound User");}}));
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
    const workerRecent=generalApprovedRecentInput(decodeGeneralModel(encodeGeneralModel(window)),workerBindings);
    assert.equal(workerRecent.page.journal[".type"],"User");
    assert.equal(workerRecent.selection.window.length,recent.recentSelection?.window.length);
    assert.equal(lookups,2);
    assert.equal(await fixture.store.revalidateNativeSelectedFingerprint(direct),true);
    assert.equal(await fixture.store.revalidateNativeSelectedFingerprint(recent),true);
}));
