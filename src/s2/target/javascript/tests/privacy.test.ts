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

// Perl shows its own pages for these, which this server leaves to it.
test("locked and private entries are not shown", async () => {
    for (const subject of ["Locked entry", "Private entry"]) {
        const page = await journals.get(`/~s2fix_theme/${await journals.ditemid("s2fix_theme", subject)}.html`);
        assert.equal(page.status, 501, subject);
        assert.doesNotMatch(page.body, /secret/);
    }
});

test("screened comments are hidden", async () => {
    const page = await journals.get(`/~s2fix_theme/${await journals.ditemid("s2fix_theme", "Entry 25:")}.html`);
    assert.equal(page.status, 200);
    assert.match(page.body, /Top comment/);
    assert.doesNotMatch(page.body, /Screened comment/);
});

test("suspended journals show only the site's notice", async () => {
    const entry = await journals.ditemid("s2fix_suspended", "Entry 1:");
    for (const url of ["/~s2fix_suspended/", `/~s2fix_suspended/${entry}.html`]) {
        const page = await journals.get(url);
        assert.equal(page.status, 403, url);
        assert.match(page.body, /<title>Suspended Account<\/title>/);
        assert.doesNotMatch(page.body, /Entry 1/);
    }
});

test("a suspended entry is left out of lists and replaced by the site's notice", async () => {
    const recent = await journals.get("/~s2fix_suspentry/");
    assert.equal(recent.status, 200);
    assert.match(recent.body, /Entry 2: caf/);
    assert.doesNotMatch(recent.body, /Entry 1: caf/);
    const entry = await journals.get(`/~s2fix_suspentry/${await journals.ditemid("s2fix_suspentry", "Entry 1:")}.html`);
    assert.equal(entry.status, 403);
    assert.doesNotMatch(entry.body, /Entry 1: caf/);
});
