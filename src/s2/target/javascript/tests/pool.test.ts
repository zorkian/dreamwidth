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
import { RenderPool } from "../render/pool";
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
