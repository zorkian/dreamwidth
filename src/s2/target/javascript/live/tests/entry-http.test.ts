// entry-http.test.ts
//
// Entry authorization and fixed HTTP failures with explicit repository injection.
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
import {request as httpRequest, type IncomingHttpHeaders} from "node:http";
import type {RawJournalSnapshot, RawRecentRepository, RepositoryError} from "../contracts";
import {createAnonymousRecentService} from "../policy/service";
import {createLiveApp} from "../server/app";
import {config, limits, snapshot} from "./fixtures";

const sentinel = "ENTRY_SQL_PASSWORD_PRIVATE_SENTINEL";
class InjectedRepositoryError extends Error implements RepositoryError {
    readonly name = "RepositoryError";
    constructor(readonly kind: "unsupported" | "unavailable") {super(sentinel);}
}

// Repository generations/errors are injected. The actual policy, token path,
// isolated renderer, Fastify and socket are exercised; this is not a DB outage.
test("entry GET/HEAD HTTP failures withhold complete HTML, cookies and private error details", async () => {
    const matrix = [
        {name: "missing-owner", status: 404}, {name: "missing-entry", status: 404},
        {name: "wrong-anum", status: 404}, {name: "private-before-cohort", status: 404},
        {name: "usemask-before-cohort", status: 404}, {name: "unknown-security", status: 422},
        {name: "selected-suspended", status: 422}, {name: "other-public-suspended", status: 422},
        {name: "owner-suspended", status: 422}, {name: "talk2-positive", status: 422},
        {name: "replycount-positive", status: 422}, {name: "spamreport-positive", status: 422},
        {name: "load-unavailable", status: 503}, {name: "load-unsupported", status: 422},
        {name: "recheck-unavailable", status: 503}, {name: "changed", status: 409},
    ] as const;
    for (const row of matrix) {
        let loads = 0, secrets = 0, rechecks = 0;
        const data = snapshot();
        const repository: RawRecentRepository = {
            async loadRawSnapshot(): Promise<RawJournalSnapshot | null> {
                loads++;
                if (row.name === "load-unavailable") throw new InjectedRepositoryError("unavailable");
                if (row.name === "load-unsupported") throw new InjectedRepositoryError("unsupported");
                if (row.name === "missing-owner") return null;
                if (row.name === "missing-entry") return {...data, entries: data.entries.slice(1)};
                if (["owner-suspended", "wrong-anum"].includes(row.name)) {
                    return {...data, owner: {...data.owner, statusvis: "S"}};
                }
                if (row.name === "private-before-cohort" || row.name === "usemask-before-cohort") {
                    return {...data, owner: {...data.owner, statusvis: "S"}, entries: [
                        {...data.entries[0]!, security: row.name === "private-before-cohort" ? "private" : "usemask",
                            subjectText: sentinel, eventText: sentinel}, data.entries[1]!,
                    ]};
                }
                if (row.name === "unknown-security") return {...data, entries: [
                    {...data.entries[0]!, security: "unknown"}, data.entries[1]!,
                ]};
                if (row.name === "selected-suspended" || row.name === "other-public-suspended") {
                    const selected = row.name === "selected-suspended" ? 1 : 2;
                    return {...data, entries: data.entries.map(entry => entry.jitemid === selected ?
                        {...entry, props: {...entry.props, statusvis: "S"}} : entry)};
                }
                if (row.name === "talk2-positive") return {...data, features: {...data.features, comments: 1}};
                if (row.name === "spamreport-positive") return {...data, features: {...data.features, spamreportBans: 1}};
                if (row.name === "replycount-positive") return {...data, entries: [
                    {...data.entries[0]!, replycount: 1}, data.entries[1]!,
                ]};
                return data;
            },
            async revalidateFingerprint(loaded) {
                rechecks++;
                assert.equal(loaded, data);
                if (row.name === "recheck-unavailable") throw new InjectedRepositoryError("unavailable");
                assert.equal(row.name, "changed");
                return false;
            },
            async close() {},
        };
        const service = await createAnonymousRecentService({repository, config, limits,
            artifact: {path: process.env.S2_LIVE_TEST_ARTIFACT || "/tmp/slice5-stock.json"},
            secretSource: {async loadLatestSecret(now) {secrets++; return {stime: now - now % 3600,
                secret: Buffer.from("0123456789abcdefghijklmnopqrstuv")};}}});
        const app = createLiveApp(config, service);
        try {
            await app.listen({host: "127.0.0.1", port: 0});
            const address = app.server.address();
            assert.ok(address && typeof address !== "string");
            for (const method of ["GET", "HEAD"] as const) {
                const response = await new Promise<{status: number; headers: IncomingHttpHeaders; body: Buffer}>((resolve, reject) => {
                    const request = httpRequest({method, hostname: "127.0.0.1", port: address.port,
                        path: `/users/s2js_slice3/${row.name === "wrong-anum" ? 385 : 384}.html`,
                        headers: {Host: "localhost:8081"}}, incoming => {
                        const parts: Buffer[] = [];
                        incoming.on("data", part => parts.push(part));
                        incoming.on("error", reject);
                        incoming.on("end", () => resolve({status: incoming.statusCode ?? 0,
                            headers: incoming.headers, body: Buffer.concat(parts)}));
                    });
                    request.setTimeout(15000, () => request.destroy(new Error("Entry HTTP test deadline")));
                    request.on("error", reject);
                    request.end();
                });
                const expected = row.status === 404 ? "Journal not found\n" : row.status === 422 ?
                    "Unsupported journal state\n" : row.status === 409 ? "Journal changed during render\n" :
                    "Journal temporarily unavailable\n";
                const label = row.name + ":" + method;
                assert.equal(response.status, row.status, label);
                assert.equal(response.body.toString("utf8"), method === "HEAD" ? "" : expected, label);
                assert.equal(response.headers["content-type"], "text/plain; charset=utf-8", label);
                assert.equal(response.headers["content-length"], String(Buffer.byteLength(expected)), label);
                assert.equal(response.headers["cache-control"], "private, no-store", label);
                assert.equal(response.headers["set-cookie"], undefined, label);
                assert.equal(response.headers.location, undefined, label);
                assert.ok(!response.body.includes(Buffer.from("<")), label);
                assert.ok(!(response.body.toString("utf8") + JSON.stringify(response.headers)).includes(sentinel), label);
            }
            assert.equal(loads, 2, row.name);
            const rendered = row.name === "changed" || row.name === "recheck-unavailable";
            assert.equal(rechecks, rendered ? 2 : 0, row.name);
            assert.equal(secrets, rendered ? 2 : 0, row.name);
        } finally {await app.close(); await service.close(); await repository.close();}
    }
});
