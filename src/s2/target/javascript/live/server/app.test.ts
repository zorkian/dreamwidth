// app.test.ts
//
// Finite live HTTP transport checks; policy admission remains the real module.
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
import net from "node:net";
import type {
    AnonymousEntryRequest, AnonymousRecentRequest, AnonymousRecentService, PublicAppConfig,
} from "../contracts";
import { createLiveApp } from "./app";

const config: PublicAppConfig = {
    canonicalAppOrigin: "http://localhost:8080",
    listenOrigin: "http://localhost:8081",
    siteRoot: "",
    statPrefix: "/stc",
    imgPrefix: "/img",
    palImgRoot: "/palimg",
    userpicRoot: "/userpic",
    siteName: "DW Devcontainer",
    siteNameShort: "DWDev",
    siteNameAbbrev: "DW",
    appleTouchIcon: "",
    facebookPreviewIcon: "",
    anonymousCaptchaDisabled: true,
    entryContent: {
        imagePlaceholder: {
            src: "/img/imageplaceholder2.png", width: 35, height: 35,
            alt: "Image", title: "Image",
        },
        urls: {
            siteDomain: "", knownHttpsSites: [], formDomainBanned: [],
            imageProxy: "not-configured",
        },
    },
};
const path = "/users/s2js_slice3/";
const html = "<html>café 😀</html>";

async function earlyResponse(port: number, wire: string): Promise<string> {
    return await new Promise((resolve, reject) => {
        const socket = net.connect(port, "127.0.0.1");
        let response = "";
        const timeout = setTimeout(() => {
            socket.destroy();
            reject(new Error("HTTP response waited for a request body"));
        }, 2000);
        socket.on("error", reject);
        socket.on("connect", () => socket.write(wire));
        socket.on("data", chunk => {
            response += chunk.toString("latin1");
            if (response.includes("\r\n\r\n")) {
                clearTimeout(timeout);
                socket.destroy();
                resolve(response);
            }
        });
        socket.on("close", () => clearTimeout(timeout));
    });
}

async function main(): Promise<void> {
    const requests: AnonymousRecentRequest[] = [];
    const entryRequests: AnonymousEntryRequest[] = [];
    const service: AnonymousRecentService = {
        async serve(request) {
            requests.push(request);
            return {ok: true, html, setCookie: null};
        },
        async serveEntry(request) {
            entryRequests.push(request);
            return {ok: true, html, setCookie: null};
        },
        async close() {},
    };
    const app = createLiveApp(config, service);
    try {
        const get = await app.inject({
            method: "GET", url: path, headers: {host: "localhost:8081"},
        });
        assert.equal(get.statusCode, 200);
        assert.equal(get.body, html);
        assert.equal(get.headers["cache-control"], "private, no-store");
        assert.equal(get.headers["content-length"], String(Buffer.byteLength(html)));
        assert.deepEqual(requests[0], {
            method: "GET", username: "s2js_slice3",
            skip: 0, skipPresent: false, uniqCookie: null,
        });
        const head = await app.inject({
            method: "HEAD", url: path, headers: {host: "localhost:8081"},
        });
        assert.equal(head.statusCode, 200);
        assert.equal(head.body, "");
        assert.equal(head.headers["content-length"], String(Buffer.byteLength(html)));
        assert.equal(head.headers["cache-control"], "private, no-store");
        assert.equal(requests[1]?.method, "HEAD");
        const explicit = await app.inject({
            method: "GET", url: path + "?skip=0", headers: {host: "localhost:8081"},
        });
        assert.equal(explicit.statusCode, 200);
        assert.equal(requests[2]?.skipPresent, true);
        const rejected = await app.inject({
            method: "GET", url: path + "?evil=1", headers: {host: "localhost:8081"},
        });
        assert.equal(rejected.statusCode, 400);
        assert.equal(rejected.headers["cache-control"], "private, no-store");
        assert.equal(requests.length, 3);
        const entryPath = path + "384.html";
        const entry = await app.inject({
            method: "GET", url: entryPath, headers: {host: "localhost:8081"},
        });
        assert.equal(entry.statusCode, 200);
        assert.equal(entry.body, html);
        assert.equal(entry.headers["cache-control"], "private, no-store");
        assert.equal(entry.headers["content-length"], String(Buffer.byteLength(html)));
        assert.deepEqual(entryRequests[0], {
            method: "GET", username: "s2js_slice3", ditemid: 384, uniqCookie: null,
        });
        const entryHead = await app.inject({
            method: "HEAD", url: entryPath, headers: {host: "localhost:8081"},
        });
        assert.equal(entryHead.statusCode, 200);
        assert.equal(entryHead.body, "");
        assert.equal(entryHead.headers["content-length"], String(Buffer.byteLength(html)));
        assert.equal(entryHead.headers["cache-control"], "private, no-store");
        assert.deepEqual(entryRequests[1], {
            method: "HEAD", username: "s2js_slice3", ditemid: 384, uniqCookie: null,
        });
        for (const bad of [entryPath + "?mode=reply", path + "0384.html",
            path + "384.HTML", path + "0.html"]) {
            const refusal = await app.inject({
                method: "GET", url: bad, headers: {host: "localhost:8081"},
            });
            assert.equal(refusal.statusCode, 400, bad);
            assert.equal(refusal.body, "Unsupported request\n");
        }
        assert.equal(entryRequests.length, 2);
        await app.listen({host: "127.0.0.1", port: 0});
        const address = app.server.address();
        assert.ok(address && typeof address !== "string");
        // Injection canonicalizes a bare trailing '?'; the raw socket retains
        // the exact request target that the admission policy must reject.
        const bareQuery = await earlyResponse(address.port,
            "GET " + entryPath + "? HTTP/1.1\r\nHost: localhost:8081\r\n\r\n");
        assert.match(bareQuery, /^HTTP\/1\.1 400 /);
        assert.equal(entryRequests.length, 2);
        const response = await earlyResponse(address.port,
            "POST /login HTTP/1.1\r\n" +
            "Host: localhost:8081\r\n" +
            "Origin: http://localhost:8081\r\n" +
            "Content-Length: 100000\r\n" +
            "Content-Type: application/x-www-form-urlencoded\r\n\r\n");
        assert.match(response, /^HTTP\/1\.1 307 /);
        assert.match(response, /\r\nlocation: http:\/\/localhost:8080\/login\r\n/i);
        assert.match(response, /\r\ncontent-length: 0\r\n/i);
        assert.ok(!response.includes("100 Continue"));
    } finally {
        await app.close();
    }
    process.stdout.write("recent/entry HTTP admission, no-store, HEAD and early POST: pass\n");
}

void main().catch(error => {
    process.stderr.write("live HTTP transport failed: " +
        (error instanceof Error ? error.message : "unknown") + "\n");
    process.exitCode = 1;
});
