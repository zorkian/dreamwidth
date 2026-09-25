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
    AnonymousRecentRequest, AnonymousRecentService, PublicAppConfig,
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

async function earlyPost(port: number): Promise<string> {
    return await new Promise((resolve, reject) => {
        const socket = net.connect(port, "127.0.0.1");
        let response = "";
        const timeout = setTimeout(() => {
            socket.destroy();
            reject(new Error("POST waited for its body"));
        }, 2000);
        socket.on("error", reject);
        socket.on("connect", () => socket.write(
            "POST /login HTTP/1.1\r\n" +
            "Host: localhost:8081\r\n" +
            "Origin: http://localhost:8081\r\n" +
            "Content-Length: 100000\r\n" +
            "Content-Type: application/x-www-form-urlencoded\r\n\r\n",
        ));
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
    const service: AnonymousRecentService = {
        async serve(request) {
            requests.push(request);
            return {ok: true, html, setCookie: null};
        },
        async serveEntry() {
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
        await app.listen({host: "127.0.0.1", port: 0});
        const address = app.server.address();
        assert.ok(address && typeof address !== "string");
        const response = await earlyPost(address.port);
        assert.match(response, /^HTTP\/1\.1 307 /);
        assert.match(response, /\r\nlocation: http:\/\/localhost:8080\/login\r\n/i);
        assert.match(response, /\r\ncontent-length: 0\r\n/i);
        assert.ok(!response.includes("100 Continue"));
    } finally {
        await app.close();
    }
    process.stdout.write("live HTTP admission, no-store, HEAD and early POST: pass\n");
}

void main().catch(error => {
    process.stderr.write("live HTTP transport failed: " +
        (error instanceof Error ? error.message : "unknown") + "\n");
    process.exitCode = 1;
});
