// general-model-wire.test.ts
//
// Approved model scalar identity, private authority and transport controls.
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
import {Context,runtime} from "../runtime/s2runtime";
import {NativeString,NativeNumber,scalarPV} from "../runtime/native-scalar";
import {encodeGeneralModel,decodeGeneralModel} from "../live/render/general-model-wire";

test("approved models retain byte scalars, native keys and shared/cyclic references",()=>{
    const raw=NativeString.bytes(Buffer.from([255,0,97]));
    const wide=NativeNumber.uv(18446744073709551615n);
    const hash=runtime.makeHash([[NativeString.flagged(Buffer.from("猫")),raw],["__proto__",wide],["constructor",null]]);
    const entry={".type":"Entry",_subject:raw,_metadata:hash};
    const page={".type":"EntryPage",_entry:entry,_entries:[entry],_undefined:undefined,_empty:null};
    Object.defineProperty(entry,"_page",{value:page,enumerable:true});
    const wire=JSON.parse(JSON.stringify(encodeGeneralModel(page)));
    const restored=decodeGeneralModel(wire) as typeof page;
    assert.equal(restored._entry,restored._entries[0]);
    assert.equal((restored._entry as unknown as {_page:unknown})._page,restored);
    assert.equal(restored[".type"],"EntryPage");
    assert.ok(Object.hasOwn(restored,"_undefined"));assert.equal(restored._undefined,undefined);
    assert.equal(Object.getPrototypeOf(restored),null);
    assert.deepEqual(scalarPV(restored._entry._subject).bytes(),Buffer.from([255,0,97]));
    assert.equal(scalarPV(restored._entry._subject).flagged(),false);
    const keys=runtime.hashKeys(restored._entry._metadata);
    assert.ok(NativeString.is(keys[0]));assert.equal(scalarPV(keys[0]).bytes().toString(),"猫");
    const maximum=runtime.memberSlot(restored._entry._metadata,"__proto__","hash").get();
    assert.ok(NativeNumber.is(maximum));assert.equal(maximum.wire().value,"18446744073709551615");
});
test("Context, callbacks, accessors and malformed wire never acquire model authority",()=>{
    const context=new Context([],()=>undefined);
    assert.throws(()=>encodeGeneralModel({private:context}));
    assert.throws(()=>encodeGeneralModel({callback(){}}));
    let called=false;
    assert.throws(()=>encodeGeneralModel(Object.defineProperty({},"value",{enumerable:true,get(){called=true;return "secret";}})));
    assert.equal(called,false);
    const valid=encodeGeneralModel({".type":"Entry",_subject:NativeString.bytes(Buffer.from([255]))});
    const malformed=JSON.parse(JSON.stringify(valid));malformed.nodes[0].entries[1][1].value.base64="/w";
    assert.throws(()=>decodeGeneralModel(malformed));
    assert.throws(()=>decodeGeneralModel({...valid,root:{kind:"reference",id:99}}));
    const duplicate=JSON.parse(JSON.stringify(valid));duplicate.nodes[0].entries.push(duplicate.nodes[0].entries[0]);
    assert.throws(()=>decodeGeneralModel(duplicate));
});
