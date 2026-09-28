// privacy.test.ts
//
// Anonymous visitors see only public content.
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
import { TestJournals } from "./journal";

let journals: TestJournals;
before(() => { journals = new TestJournals(); });
after(() => journals.close());

test("recent pages leave out locked and private entries", async () => {
    const page = await journals.get("/~s2fix_theme/");
    assert.equal(page.status, 200);
    assert.match(page.body, /Entry 25/);
    assert.doesNotMatch(page.body, /Locked entry|Private entry|secret/);
});

test("locked and private entries are not found", async () => {
    for (const subject of ["Locked entry", "Private entry"]) {
        const page = await journals.get(`/~s2fix_theme/${await journals.ditemid("s2fix_theme", subject)}.html`);
        assert.equal(page.status, 404, subject);
        assert.doesNotMatch(page.body, /secret/);
    }
});

test("screened comments are hidden", async () => {
    const page = await journals.get(`/~s2fix_theme/${await journals.ditemid("s2fix_theme", "Entry 25:")}.html`);
    assert.equal(page.status, 200);
    assert.match(page.body, /Top comment/);
    assert.doesNotMatch(page.body, /Screened comment/);
});

test("suspended journals are not found", async () => {
    const recent = await journals.get("/~s2fix_suspended/");
    assert.equal(recent.status, 404);
    const entry = await journals.get(`/~s2fix_suspended/${await journals.ditemid("s2fix_suspended", "Entry 1:")}.html`);
    assert.equal(entry.status, 404);
});
