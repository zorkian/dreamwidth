// general-contexts.test.mjs
//
// Native general property CSS and exact scalar-byte context controls.
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
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {cleanGeneralCssProperty,escapeGeneralPlainProperty} from '../dist/general-contexts.js';

const native=JSON.parse(execFileSync('perl',[fileURLToPath(new URL('./page-css-native.pl',import.meta.url))],
    {encoding:'utf8',timeout:10000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe']}));
test('general CSS property reuses actual native screening including its arbitrary successful syntax',()=>{
    for(const row of native) {
        const input={bytes:Buffer.from(row.input),utf8:false};
        if(row.error){assert.throws(()=>cleanGeneralCssProperty(input,false,chunk=>chunk));continue;}
        const result=cleanGeneralCssProperty(input,false,chunk=>chunk);
        assert.equal(Buffer.from(result.bytes).toString(),row.sheet);
    }
});
test('attribute braces short circuit and only whole CSS invokes the trusted transform',()=>{
    let calls=0;
    const hook=chunk=>{calls++;return chunk;};
    const raw={bytes:Buffer.from('p{color:red}'),utf8:false};
    assert.equal(Buffer.from(cleanGeneralCssProperty(raw,true,hook).bytes).toString(),
        "/* bad CSS: can't use braces in a style attribute */");
    assert.equal(calls,0);
    const attribute={bytes:Buffer.from('font-family:Georgia; color:red'),utf8:false};
    assert.deepEqual(Buffer.from(cleanGeneralCssProperty(attribute,true,hook).bytes),attribute.bytes);
    assert.equal(calls,0);
    assert.deepEqual(Buffer.from(cleanGeneralCssProperty(raw,false,hook).bytes),raw.bytes);
    assert.equal(calls,1);
});
test('general plain escaping preserves invalid bytes and legitimate flag without recursive entity decoding',()=>{
    const bytes=Buffer.from([0xff,60,38,62,10,0]);
    const escaped=escapeGeneralPlainProperty({bytes,utf8:false});
    assert.deepEqual(Buffer.from(escaped.bytes),Buffer.concat([Buffer.from([0xff]),Buffer.from('&lt;&&gt;<br />'),Buffer.from([0])]));
    assert.equal(escaped.utf8,false);
    const wide=escapeGeneralPlainProperty({bytes:Buffer.from('猫<é\n'),utf8:true});
    assert.equal(Buffer.from(wide.bytes).toString(),'猫&lt;é<br />');assert.equal(wide.utf8,true);
    assert.deepEqual(bytes,Buffer.from([0xff,60,38,62,10,0]));
});
