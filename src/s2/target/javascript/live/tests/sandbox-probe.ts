// sandbox-probe.ts
//
// Real child isolation and privacy decision adversarial tests.
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
import {readFileSync, writeFileSync, fstatSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {connect, createServer} from "node:net";
import {createSocket} from "node:dgram";
import {Worker} from "node:worker_threads";

async function main(): Promise<void> {
    assert.deepEqual(Object.keys(process.env).sort(), ["LANG", "TZ"]);
    // The parent deliberately offers a regular-file descriptor at fd3. The
    // launcher must close it; Node may reuse fd3 for a non-file event handle.
    try {assert.equal(fstatSync(3).isFile(), false);} catch (e: any) {
        if (e.code !== "EBADF") throw e;
    }
    for (const path of ["/workspaces/dreamwidth/etc/config-local.pl",
        "/workspaces/dreamwidth/etc/config.pl", "/proc/self/environ", "/etc/passwd"]) {
        assert.throws(() => readFileSync(path), (e: any) => e.code === "ERR_ACCESS_DENIED");
    }
    assert.throws(() => writeFileSync("/tmp/slice3-child-must-not-write", "x"),
        (e: any) => e.code === "ERR_ACCESS_DENIED");
    assert.throws(() => spawnSync("/bin/true"), (e: any) => e.code === "ERR_ACCESS_DENIED");
    assert.throws(() => new Worker("process.exit()", {eval: true}),
        (e: any) => e.code === "ERR_ACCESS_DENIED");
    await new Promise<void>((done, fail) => {
        const socket = connect({host: "127.0.0.1", port: 3306});
        socket.once("connect", () => {socket.destroy(); fail(new Error("Network allowed"));});
        socket.once("error", (e: any) => {assert.equal(e.code, "EPERM"); done();});
    });
    await new Promise<void>((done, fail) => {
        const socket = connect({path: "/var/run/mysqld/mysqld.sock"});
        socket.once("connect", () => {socket.destroy(); fail(new Error("Unix socket allowed"));});
        socket.once("error", (e: any) => {assert.equal(e.code, "EPERM"); done();});
    });
    await new Promise<void>(done => {
        const server = createServer();
        server.once("error", (e: any) => {assert.equal(e.code, "EPERM"); done();});
        server.listen(0, "127.0.0.1", () => {server.close(); throw new Error("Listen allowed");});
    });
    await new Promise<void>(done => {
        const udp = createSocket("udp4");
        udp.once("error", (e: any) => {assert.equal(e.code, "EPERM"); udp.close(); done();});
        udp.bind(0, "127.0.0.1", () => {udp.close(); throw new Error("UDP allowed");});
    });
    process.stdout.write("credential/file/child/worker/TCP/Unix/listen/UDP denied\n");
}
main().catch(() => {process.exitCode = 1;});
