// pool.test.ts
//
// A style that never finishes is stopped at the time limit, and the pool
// keeps serving other pages.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Databases } from "../data/db";
import { RenderPool } from "../render/pool";
import { createApp } from "../server/app";
import { TestJournals } from "./journal";

let journals: TestJournals;
before(() => { journals = new TestJournals(); });
after(() => journals.close());

test("a render past the time limit is stopped", async () => {
    const pool = new RenderPool(journals.config, 1, 2000);
    try {
        const started = Date.now();
        const looping = await pool.render(await journals.request("/~s2fix_loop/"));
        assert.equal(looping.status, 503);
        assert.ok(Date.now() - started < 3500);

        const next = await pool.render(await journals.request("/~s2fix_default/"));
        assert.equal(next.status, 200);
        assert.match(next.body, /Entry 3/);
    } finally {
        await pool.close();
    }
});

test("the status check passes only while the databases and render workers answer", async () => {
    const pool = new RenderPool(journals.config, 1, 5000);
    const app = createApp(journals.config, journals.db, journals.compiler, request => pool.render(request), () => pool.ping());
    const healthy = () => app.inject({ url: "/admin/healthy", headers: { host: "10.0.0.1:8091" } });
    try {
        const ok = await healthy();
        assert.equal(ok.statusCode, 200);
        assert.match(ok.body, /^status=ok\n\nokay:\n  global reader\n(  cluster \d+ reader\n)+  render workers\n$/);

        // The one worker is busy with a style that never finishes.
        const looping = pool.render(await journals.request("/~s2fix_loop/"));
        const busy = await healthy();
        assert.equal(busy.statusCode, 503);
        assert.match(busy.body, /^status=fail\n\nfailures:\n  render workers timed out\n/);
        await looping;

        const down = createApp(journals.config, { global: () => Promise.reject(new Error("down")),
            cluster: () => Promise.reject(new Error("down")) } as unknown as Databases, journals.compiler,
            request => pool.render(request), () => pool.ping());
        const failing = console.error;
        console.error = () => {};
        try {
            const response = await down.inject({ url: "/admin/healthy" });
            assert.equal(response.statusCode, 503);
            assert.match(response.body, /failures:\n  global reader test query failed\n/);
        } finally {
            console.error = failing;
        }
    } finally {
        await pool.close();
    }
});
