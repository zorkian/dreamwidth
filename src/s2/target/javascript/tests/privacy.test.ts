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
    // A thread link to a hidden comment shows the same entry page as one to no comment.
    const threads = new Set<string>();
    for (const id of [int(screened!.jtalkid), 99999].map(talkid => (talkid << 8) + shown % 256)) {
        const page = await journals.get(`/~s2fix_theme/${shown}.html?thread=${id}`);
        assert.equal(page.status, 200);
        assert.doesNotMatch(page.body, /Screened comment/);
        threads.add(page.body.replace(new RegExp(`(?<!\\d)${id}(?!\\d)`, "g"), "ID").replace(/c0:[^"']+/g, "TOKEN"));
    }
    assert.equal(threads.size, 1);
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

// Unlike Perl, which asks for a confirmation, adult content needs a login.
test("adult content shows a login page, with nothing to click through", async () => {
    const explicit = `/~s2fix_adult/${await journals.ditemid("s2fix_adult", "Explicit entry")}.html`;
    const concepts = `/~s2fix_archive/${await journals.ditemid("s2fix_archive", "Discretion advised")}.html`;
    for (const [url, notice] of [
        [concepts, "The journal owner has marked this content as needing viewer discretion. Log in to view it."],
        [explicit, "The journal owner has marked this content as adult content (18+). Log in to view it."],
        ["/~s2fix_adultjournal/", "The journal owner has marked this content as needing viewer discretion. Log in to view it."],
    ]) {
        const page = await journals.get(url!);
        assert.equal(page.status, 403, url);
        assert.ok(page.body.includes(notice!), url);
        assert.ok(page.body.includes(`name="returnto" value="http://${HOST}${url}"`), url);
        assert.doesNotMatch(page.body, /Paragraph with|\/journal\/adult_|I want to view|about to view/, url);
    }
    // An unflagged journal's page shows its other entries, and only a link to the flagged one.
    const recent = await journals.get("/~s2fix_adult/");
    assert.equal(recent.status, 200);
    assert.match(recent.body, /example\.com\/1"/);
    assert.doesNotMatch(recent.body, /example\.com\/4"|\/journal\/adult_/);
    assert.ok(recent.body.includes(`<a href="http://${HOST}${explicit}">`));
});

test("feeds carry only public entries, and adult ones only as a link to log in", async () => {
    for (const url of ["/~s2fix_theme/data/rss", "/~s2fix_theme/data/atom"]) {
        const feed = await journals.get(url);
        assert.equal(feed.status, 200, url);
        assert.match(feed.body, /Entry 25/);
        assert.doesNotMatch(feed.body, /Locked entry|Private entry|secret/, url);
    }
    const explicit = await journals.ditemid("s2fix_adult", "Explicit entry");
    for (const url of ["/~s2fix_adult/data/rss", "/~s2fix_adult/data/atom"]) {
        const feed = await journals.get(url);
        assert.equal(feed.status, 200, url);
        assert.match(feed.body, /example\.com\/1(?!\d)/, url);
        assert.equal(feed.body.match(/Log in to read this entry/g)?.length, 1, url);
        assert.ok(feed.body.includes(`${explicit}.html`), url);
        assert.doesNotMatch(feed.body, /Explicit entry|example\.com\/4(?!\d)|cell 4/, url);
    }
});

test("a profile leaves out what its owner keeps from anonymous visitors", async () => {
    const page = await journals.get("/~s2fix_closedprofile/profile");
    assert.equal(page.status, 200);
    assert.match(page.body, /A public bio/);
    // Birthday, location, address, other sites' accounts, subscribers and the
    // communities it belongs to (its subscriptions stay public).
    assert.doesNotMatch(page.body, /1985|Hiddenville|s2fix_closedprofile<\/span>|hidden-github|Subscribers|Member Of/);
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
