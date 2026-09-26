// for-initializer.test.ts
//
// Native outer-scope binding and type checks for S2 for initializers.
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
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {boundedRun} from './bounded';
const s2=path.resolve(__dirname,'../../../..');
const bridge=path.join(s2,'target/javascript/tools/fixture-pipeline.pl');

test('for declaration initializer binds outer and same-name shadow before loop scope',()=>{
    const dir=mkdtempSync(path.join(tmpdir(),'s2-for-init-'));
    try {
        const source=path.join(dir,'outer.s2'),artifact=path.join(dir,'outer.json');
        writeFileSync(source,`layerinfo "type" = "core";
function main () {
    var int previous = 3;
    for (var int i = $previous; $i >= 1; $i--) { println $i; }
    var int same = 2;
    for (var int same = $same; $same >= 1; $same--) { println $same; }
    println $same;
}`);
        const compiled=boundedRun('/usr/bin/perl',[bridge,'compile','core:'+source],s2);
        assert.equal(compiled.status,0,compiled.stderr.toString());writeFileSync(artifact,compiled.stdout);
        const native=boundedRun('/usr/bin/perl',[bridge,'oracle','core:'+source],s2);
        assert.equal(native.status,0,native.stderr.toString());
        assert.equal(native.stdout.toString(),'3\n2\n1\n2\n1\n2\n');
        const js=boundedRun(process.execPath,[path.join(__dirname,'execute.js'),artifact],s2);
        assert.equal(js.status,0,js.stderr.toString());assert.deepEqual(js.stdout,native.stdout);
    }finally{rmSync(dir,{recursive:true,force:true});}
});
test('incompatible for initializer fails retained assignability checking in both backends',()=>{
    const dir=mkdtempSync(path.join(tmpdir(),'s2-for-type-'));
    try {
        const source=path.join(dir,'bad.s2');
        writeFileSync(source,'layerinfo "type" = "core"; function main () { for (var int i = "bad"; $i < 2; $i++) { println $i; } }');
        for(const mode of ['compile','oracle']) {
            const result=boundedRun('/usr/bin/perl',[bridge,mode,'core:'+source],s2);
            assert.notEqual(result.status,0);assert.equal(result.stdout.length,0);
            assert.match(result.stderr.toString(),/Can't initialize for variable of type int with expression of type string/);
        }
    }finally{rmSync(dir,{recursive:true,force:true});}
});
