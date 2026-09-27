// private-transport.test.ts
//
// Private pipe framing and synchronous resume transport controls.
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
import {encodePrivateFrame, PrivateFrameDecoder, PrivateTransportError} from "../render/private-transport";

test("private frames preserve arbitrary bytes across fragmented and coalesced pipes", () => {
    const bodies = [Buffer.alloc(0), Buffer.from([0xff, 0xc3, 0, 0x80]), Buffer.alloc(65537, 0x61)];
    const wire = Buffer.concat(bodies.map(body => encodePrivateFrame(body)));
    for (const chunkSize of [1, 3, 4096, wire.length]) {
        const decoder = new PrivateFrameDecoder();
        const actual = [];
        for (let offset = 0; offset < wire.length; offset += chunkSize) {
            actual.push(...decoder.push(wire.subarray(offset, offset + chunkSize)));
        }
        decoder.finish();
        assert.deepEqual(actual, bodies);
    }
});

test("overlimit and incomplete private frames fail terminally", () => {
    const decoder = new PrivateFrameDecoder(10);
    const header = Buffer.alloc(4); header.writeUInt32BE(11);
    assert.throws(() => decoder.push(header), PrivateTransportError);
    assert.throws(() => decoder.push(encodePrivateFrame(Buffer.alloc(0))), PrivateTransportError);
    assert.throws(() => encodePrivateFrame(Buffer.alloc(11), 10), PrivateTransportError);
    for (const wire of [Buffer.from([0]), encodePrivateFrame(Buffer.from([1])).subarray(0, 4)]) {
        const partial = new PrivateFrameDecoder(); partial.push(wire);
        assert.throws(() => partial.finish(), PrivateTransportError);
    }
});

test("unchanged sandbox FD0 blocks while parent asynchronously handles a synchronous host request", async () => {
    const {spawn} = await import("node:child_process");
    const {resolve} = await import("node:path");
    const root = resolve(__dirname, "../..");
    const transport = resolve(root, "live/render/private-transport.js");
    const sandbox = resolve(root, "../artifacts/live/stock.json.sandbox");
    const script = `const {BlockingPrivateTransport}=require(${JSON.stringify(transport)});
        const wire=new BlockingPrivateTransport(0,1);
        wire.write(Buffer.from('host-request'));
        const reply=wire.read(); wire.write(reply);`;
    const child = spawn(sandbox, ["/opt/dw-node24/bin/node", "--permission", "--no-addons",
        "--disable-proto=throw", "--allow-fs-read=" + transport,
        "--allow-fs-read=" + resolve(root, "../package.json"), "-e", script],
    {env: {LANG: "C.UTF-8", TZ: "UTC"}, stdio: ["pipe", "pipe", "pipe"]});
    const decoder = new PrivateFrameDecoder();
    let count = 0, stderr = "";
    const bytes = Buffer.from([0xff, 0xc3, 0, 0x80]);
    const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
    child.stderr.on("data", chunk => {stderr += chunk;});
    child.stdout.on("data", chunk => {
        for (const frame of decoder.push(chunk)) {
            if (count++ === 0) {
                assert.equal(Buffer.from(frame).toString(), "host-request");
                // Delayed parent operation proves FD0 really waits; an EAGAIN or
                // async substitute cannot successfully return this exact reply.
                setTimeout(() => child.stdin.end(encodePrivateFrame(bytes)), 100);
            } else assert.deepEqual(frame, bytes);
        }
    });
    try {
        const code = await new Promise<number | null>((resolveCode, reject) => {
            child.once("error", reject); child.once("close", resolveCode);
        });
        assert.equal(code, 0, stderr); decoder.finish(); assert.equal(count, 2);
    } finally {clearTimeout(timeout); child.kill("SIGKILL");}
});

test("private message channel binds job, direction sequence and explicit phase", async () => {
    const {PrivateMessageChannel} = await import("../render/private-protocol.js");
    const job = "a".repeat(64), sender = new PrivateMessageChannel(job), receiver = new PrivateMessageChannel(job);
    const start = sender.send("initialize", "start", {program: "private transfer placeholder"});
    assert.equal(receiver.receive(start, "initialize", ["start"]).kind, "start");
    assert.throws(() => receiver.receive(start, "initialize", ["start"]), PrivateTransportError);
    const host = sender.send("initialize", "host", {operation: "user-lite", name: "computed"});
    assert.throws(() => receiver.receive(host, "render", ["host"]), PrivateTransportError);
    assert.throws(() => new PrivateMessageChannel("b".repeat(64)).receive(host, "initialize", ["host"]), PrivateTransportError);
    assert.equal(receiver.receive(host, "initialize", ["host"]).sequence, 1);
    assert.throws(() => receiver.receive(Buffer.from([0xff]), "render", ["result"]), PrivateTransportError);
});
