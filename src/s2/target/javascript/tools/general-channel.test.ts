// general-channel.test.ts
//
// Actual private pipe request/reply and binary result lifecycle.
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
import {mkdtempSync, mkdirSync, copyFileSync, rmSync} from "node:fs";
import {execFileSync} from "node:child_process";
import path from "node:path";
import {tmpdir} from "node:os";
import type {NativeProfile} from "../runtime/native-profile";
import {parentExpandSiteUrl} from "../live/render/general-site-url-host";
import {nativePageResponse} from "../live/render/general-response";
import {createLiveApp} from "../live/server/app";
import {config} from "../live/tests/fixtures";
import {GeneralRenderer} from "../live/render/general-child";

test("actual sandboxed channel initializes before selection and retains arbitrary bytes", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "s2-general-channel-"));
    const sandbox = path.join(root, "sandbox");
    try {
        execFileSync("cc", ["-std=c11", "-Wall", "-Wextra", "-Werror", "-O2", "live/render/sandbox.c", "-o", sandbox]);
        for (const relative of ["tools/general-channel-child.js", "live/render/general-worker-channel.js",
            "live/render/private-protocol.js", "live/render/private-transport.js",
            "live/render/general-site-url-client.js", "runtime/native-scalar.js",
            "runtime/native-number.js", "runtime/native-string.js", "runtime/native-profile.js"]) {
            const target = path.join(root, relative);
            mkdirSync(path.dirname(target), {recursive: true});
            copyFileSync(path.join("dist", relative), target);
        }
        const renderer = new GeneralRenderer(sandbox, {root, entry: path.join(root, "tools/general-channel-child.js"),
            node: "/opt/dw-node24/bin/node"}, {maxOutputBytes: 1048576, maxHeapMiB: 128, timeoutMs: 10000});
        const calls: string[] = [];
        try {
            const body = await renderer.render("a".repeat(64), {start: "fixed-channel-test",
                async host(operation, parameters, phase) {
                    calls.push("host:" + phase);
                    assert.equal(operation, "expand-site-url");
                    assert.deepEqual(parameters, {path: "fixed-test-path"});
                    return "fixed-test-reply";
                },
                async select(count) {
                    calls.push("select");
                    assert.equal(count, 3);
                    return "fixed-selected-data";
                }});
            assert.deepEqual(calls, ["host:initialize", "select"]);
            assert.deepEqual(Buffer.from(body.bytes), Buffer.from([0xff, 0x00, 0x61]));
            const profile = JSON.parse(execFileSync("perl",["tools/compile-active.pl",path.resolve("../.."),
                path.resolve("../../S2.pm")],{input:JSON.stringify({profileOnly:true}),encoding:"utf8",
                maxBuffer:1048576,timeout:10000})).profile as NativeProfile;
            const expanded = await renderer.render("c".repeat(64),{start:"fixed-site-helper-test",
                async host(operation,parameters,phase) {
                    assert.equal(operation,"expand-site-url");assert.equal(phase,"initialize");
                    const config={siteRoot:"https://app.example.invalid",usernameMaxLength:25};
                    assert.throws(()=>parentExpandSiteUrl({path:{kind:"number",number:{mode:"iv",value:"1"}}},config,profile));
                    assert.throws(()=>parentExpandSiteUrl({...parameters as object,extra:true},config,profile));
                    return parentExpandSiteUrl(parameters,config,profile);
                },async select(count){assert.equal(count,3);return "fixed-selected-data";}});
            assert.equal(Buffer.from(expanded.bytes).toString(),"https://app.example.invalid/users/mixed_name/");
            const diagnostic = await renderer.render("b".repeat(64), {start: "fixed-preparation-error-test",
                async host() {throw Error("Init error must not reach later public hosts");},
                async select() {throw Error("Init error must not read selected entry bodies");}});
            assert.equal(Buffer.from(diagnostic.bytes).toString(), "<b>Error preparing to run:</b> &lt;author&gt;");
            const oracle=JSON.parse(execFileSync("perl",["-MJSON::PP","-MMIME::Base64=encode_base64","-MFile::Temp=tempfile","-e",`
                use utf8; my @rows; for my $text ("café","☺") {utf8::upgrade($text);
                my ($fh,$path)=tempfile(); my $length=length($text); my $ok=eval {syswrite($fh,$text);1};
                seek($fh,0,0);local $/;my $bytes=<$fh>;push @rows,{length=>$length,ok=>$ok?1:0,bytes=>encode_base64($bytes,'')};}
                print encode_json(\\@rows);`],{encoding:"utf8"}));
            for(const [index,start] of ["fixed-flagged-latin1-test","fixed-flagged-wide-test"].entries()) {
                const render=()=>renderer.render((index===0?"d":"e").repeat(64),{start,
                    async host(){throw Error("Flag control needs no public helper");},async select(){return null;}});
                const frame=await render();assert.equal(frame.utf8,true);
                const head=nativePageResponse(frame,"HEAD");assert.equal(head.contentLength,oracle[index].length);
                assert.equal(head.html.length,0);
                if(oracle[index].ok)assert.equal(Buffer.from(nativePageResponse(frame,"GET").html).toString("base64"),oracle[index].bytes);
                else assert.throws(()=>nativePageResponse(frame,"GET"),/Wide character/);
                const serve=async(request:{method:"GET"|"HEAD"})=>({ok:true as const,
                    ...nativePageResponse(await render(),request.method),setCookie:null});
                const app=createLiveApp(config,{serve,serveEntry:serve,async close(){}});
                try {
                    for(const method of ["HEAD","GET"] as const) {
                        const response=await app.inject({method,url:"/users/public_name/",headers:{host:"localhost:8081"}});
                        assert.equal(response.statusCode,method==="GET"&&!oracle[index].ok?503:200);
                        if(response.statusCode===200)assert.equal(response.headers["content-length"],String(oracle[index].length));
                        if(method==="HEAD")assert.equal(response.rawPayload.length,0);
                        else if(oracle[index].ok)assert.equal(response.rawPayload.toString("base64"),oracle[index].bytes);
                        else assert.ok(!response.rawPayload.includes(Buffer.from("☺")));
                    }
                } finally {await app.close();}
            }
        } finally {renderer.close();}
    } finally {rmSync(root, {recursive: true, force: true});}
});
