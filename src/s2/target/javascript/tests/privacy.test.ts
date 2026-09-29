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
import { int } from "../data/db";
import { User } from "../data/user";
import { HOST, TestJournals } from "./journal";

let journals: TestJournals;
before(() => { journals = new TestJournals(); });
after(() => journals.close());

test("recent pages leave out locked and private entries", async () => {
    const page = await journals.get("/~s2fix_theme/");
    assert.equal(page.status, 200);
    assert.match(page.body, /Entry 25/);
    assert.doesNotMatch(page.body, /Locked entry|Private entry|secret/);
});

// Entries and comments a visitor cannot see answer exactly as ones that do not
// exist, apart from the requested URL the login form returns to and per-request
// tokens.
test("hidden entries and comments are indistinguishable from missing ones", async () => {
    const hidden = await journals.ditemid("s2fix_theme", "Private entry");
    const shown = await journals.ditemid("s2fix_theme", "Entry 25:");
    const u = (await User.byName(journals.db, "s2fix_theme"))!;
    const [screened] = await u.cluster(journals.db, `SELECT t.jtalkid FROM talk2 t
        JOIN talktext2 x USING (journalid, jtalkid) WHERE t.journalid = ? AND t.state = 'S' AND x.body LIKE 'Screened%'`,
    [u.userid]);
    const replyto = (id: number) => `/~s2fix_theme/${shown}.html?replyto=${(id << 8) + shown % 256}`;
    const groups = [
        // Private, missing, and a public entry with the wrong anum.
        [`/~s2fix_theme/${hidden}.html`, "/~s2fix_theme/25600001.html",
            `/~s2fix_theme/${shown - shown % 256 + (shown + 1) % 256}.html`],
        [`/~s2fix_theme/${hidden}.html?mode=reply`, "/~s2fix_theme/25600001.html?mode=reply"],
        // Private, missing, and a public entry's name under the wrong date.
        ["/~s2fix_theme/2026/01/28/private-entry.html", "/~s2fix_theme/2026/01/28/no-such-entry.html",
            "/~s2fix_theme/2026/01/27/entry-25.html"],
        ["/~s2fix_theme/2026/01/28/private-entry.html?mode=reply", "/~s2fix_theme/2026/01/28/no-such-entry.html?mode=reply"],
        [replyto(int(screened!.jtalkid)), replyto(99999)],
    ];
    const bodies = new Set<string>();
    for (const urls of groups) {
        for (const url of urls) {
            const page = await journals.get(url);
            assert.equal(page.status, 404, url);
            assert.doesNotMatch(page.body, /secret|Private entry|Screened comment/, url);
            bodies.add(page.body.replaceAll(`http://${HOST}${url}`, "URL").replace(/c0:[^"']+/g, "TOKEN"));
        }
    }
    assert.equal(bodies.size, 1);
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
