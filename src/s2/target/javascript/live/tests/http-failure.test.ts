// http-failure.test.ts
//
// Injected repository failures through the real policy service and HTTP app.
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

import {test} from "node:test";
import assert from "node:assert/strict";
import {get, type IncomingHttpHeaders} from "node:http";
import type {RawRecentRepository, RepositoryError} from "../contracts";
import {createAnonymousRecentService} from "../policy/service";
import {createLiveApp} from "../server/app";
import {config, limits, snapshot} from "./fixtures";

const sentinel = "SECRET_CONNECTION_SENTINEL_PASSWORD_SQL";
class InjectedRepositoryError extends Error implements RepositoryError {
    readonly name = "RepositoryError";
    constructor(readonly kind: "unsupported" | "unavailable") {super(sentinel);}
}

// This is typed repository fault injection, not evidence of an actual database
// outage. The policy, token generation, isolated child and HTTP app are real.
test("injected repository HTTP matrix returns fixed failures without buffered HTML or secrets", async () => {
    const matrix = [
        {name: "missing", status: 404, body: "Journal not found\n", rechecks: 0},
        {name: "load-error", status: 503, body: "Journal temporarily unavailable\n", rechecks: 0},
        {name: "recheck-error", status: 503, body: "Journal temporarily unavailable\n", rechecks: 1},
        {name: "changed", status: 409, body: "Journal changed during render\n", rechecks: 1},
        {name: "unsupported-snapshot", status: 422, body: "Unsupported journal state\n", rechecks: 0},
        {name: "unsupported-repository", status: 422, body: "Unsupported journal state\n", rechecks: 0},
    ] as const;
    for (const row of matrix) {
        let loads = 0, rechecks = 0, secrets = 0;
        const data = snapshot();
        const repository: RawRecentRepository = {
            async loadRawSnapshot(username) {
                loads++;
                assert.equal(username, "s2js_slice3");
                if (row.name === "missing") return null;
                if (row.name === "load-error") throw new InjectedRepositoryError("unavailable");
                if (row.name === "unsupported-repository") throw new InjectedRepositoryError("unsupported");
                if (row.name === "unsupported-snapshot") return {...data, owner: {...data.owner, statusvis: "S"}};
                return data;
            },
            async revalidateFingerprint(loaded) {
                rechecks++;
                assert.equal(loaded, data);
                if (row.name === "recheck-error") throw new InjectedRepositoryError("unavailable");
                assert.equal(row.name, "changed");
                return false;
            },
            async close() {},
        };
        const service = await createAnonymousRecentService({repository, config, limits,
            artifact: {path: process.env.S2_LIVE_TEST_ARTIFACT || "/tmp/slice3-stock.json"},
            secretSource: {async loadLatestSecret(nowSeconds) {
                secrets++;
                // Declared unit fixture key; no real DB credentials or app keys.
                return {stime: nowSeconds - nowSeconds % 3600,
                    secret: Buffer.from("0123456789abcdefghijklmnopqrstuv")};
            }}});
        const app = createLiveApp(config, service);
        try {
            await app.listen({host: "127.0.0.1", port: 0});
            const address = app.server.address();
            assert.ok(address && typeof address !== "string");
            const response = await new Promise<{status: number; headers: IncomingHttpHeaders; body: Buffer}>((resolve, reject) => {
                const req = get({hostname: "127.0.0.1", port: address.port,
                    path: "/users/s2js_slice3/", headers: {Host: "localhost:8081"}}, incoming => {
                    const parts: Buffer[] = [];
                    incoming.on("data", chunk => parts.push(chunk));
                    incoming.on("error", reject);
                    incoming.on("end", () => resolve({status: incoming.statusCode ?? 0,
                        headers: incoming.headers, body: Buffer.concat(parts)}));
                });
                req.setTimeout(15000, () => req.destroy(new Error("HTTP matrix deadline")));
                req.on("error", reject);
            });
            assert.equal(response.status, row.status, row.name);
            assert.equal(response.body.toString("utf8"), row.body, row.name);
            assert.equal(response.headers["content-type"], "text/plain; charset=utf-8", row.name);
            assert.equal(response.headers["content-length"], String(Buffer.byteLength(row.body)), row.name);
            assert.equal(response.headers["cache-control"], "private, no-store", row.name);
            assert.equal(response.headers["set-cookie"], undefined, row.name);
            assert.equal(response.headers.location, undefined, row.name);
            assert.ok(!(response.body.toString("utf8") + JSON.stringify(response.headers)).includes(sentinel), row.name);
            assert.ok(!response.body.includes(Buffer.from("<")), row.name);
            assert.equal(loads, 1, row.name);
            assert.equal(rechecks, row.rechecks, row.name);
            assert.equal(secrets, row.rechecks, row.name);
        } finally {
            await app.close();
            await service.close();
            await repository.close();
        }
    }
});
