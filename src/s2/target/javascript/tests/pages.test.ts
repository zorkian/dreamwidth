// pages.test.ts
//
// Fixture journal pages match what the Perl site renders, once both are
// normalized: attribute order, whitespace, hosts and per-request tokens.
// Needs the devcontainer's Perl site running on port 8080.
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
import path from "node:path";
import { after, before, test } from "node:test";
import { int } from "../data/db";
import { User } from "../data/user";
import { renderJournal } from "../render/render";
import { createApp } from "../server/app";
import { HOST, TestJournals } from "./journal";

const PERL = "http://localhost:8080";
const JS = `http://${HOST}`;

let journals: TestJournals;
let app: ReturnType<typeof createApp>;
interface Page { status: number; body: string; type: string; location?: string }
let tools: {
    summarize(page: Page, origins: string[], quips: readonly string[]): string;
    fetchPage(origin: string, path: string): Promise<Page>;
};

before(async () => {
    journals = new TestJournals();
    app = createApp(journals.config, journals.db, journals.compiler,
        request => renderJournal(journals.db, { config: journals.config, host: request.host }, request));
    tools = await import(path.resolve(__dirname, "../../tools/compare-pages.mjs"));
});
after(() => journals.close());

async function compare(pagePath: string): Promise<void> {
    const response = await app.inject({ url: pagePath, headers: { host: HOST } });
    const js = {
        status: response.statusCode, body: response.body, type: String(response.headers["content-type"] ?? ""),
        location: response.headers.location as string | undefined,
    };
    const perl = await tools.fetchPage(PERL, pagePath);
    const quips = journals.config.notFoundQuips;
    assert.equal(tools.summarize(js, [PERL, JS], quips), tools.summarize(perl, [PERL, JS], quips), pagePath);
}

test("recent pages, in the default style, a theme and a user layer", async () => {
    for (const user of ["s2fix_default", "s2fix_theme", "s2fix_custom"]) await compare(`/~${user}/`);
});

test("a syndicated journal, in the site's feed style", () => compare("/~s2fix_feed/"));

test("an older page of entries", () => compare("/~s2fix_theme/?skip=20"));

test("entries filtered by tag", () => compare("/~s2fix_theme/?tag=number%203,fixture&mode=and"));

test("entry pages with comment threads", async () => {
    await compare(`/~s2fix_theme/${await journals.ditemid("s2fix_theme", "Entry 25:")}.html`);
    await compare(`/~s2fix_custom/${await journals.ditemid("s2fix_custom", "Entry 4:")}.html`);
});

test("an entry page without comments", async () => {
    await compare(`/~s2fix_default/${await journals.ditemid("s2fix_default", "Entry 3:")}.html`);
});

test("archive pages for a year, a month and a day", async () => {
    for (const path of ["/~s2fix_archive/2025/", "/~s2fix_archive/2025/03/", "/~s2fix_archive/2025/03/10/"]) {
        await compare(path);
    }
});

test("reply pages, to an entry and to a comment", async () => {
    const ditemid = await journals.ditemid("s2fix_theme", "Entry 25:");
    await compare(`/~s2fix_theme/${ditemid}.html?mode=reply`);
    // The second comment, "Re: top".
    await compare(`/~s2fix_theme/${ditemid}.html?replyto=${(2 << 8) + ditemid % 256}`);
});

test("an entry with an embedded video and a poll", () => compare("/~s2fix_archive/2025/06/01/"));

test("a community and a reading page", async () => {
    await compare("/~s2fix_comm/");
    await compare("/~s2fix_reader/read");
});

test("tags and icons pages", async () => {
    await compare("/~s2fix_theme/tag/");
    await compare("/~s2fix_archive/icons?sortorder=keyword");
});

test("stylesheets, cleaned as CSS", async () => {
    await compare("/~s2fix_theme/res/14/stylesheet");
    await compare("/~s2fix_custom/res/16/stylesheet");
});

// Foundation pages load scripts at the end of the body; others use the
// scheme's older layout, with the search widget and the table login form.
test("error pages in the site scheme", async () => {
    await compare("/~no-such-user/");
    await compare("/~s2fix_archive/?tag=nosuchtag");
    await compare("/~s2fix_deletedcomm/");
    await compare("/~s2fix_deleted/?skin=lynx");
});

test("a not-found page, for an unknown path", () => compare("/~s2fix_theme/nosuchpage/"));

test("entries and comments the visitor cannot see, answered as missing ones", async () => {
    const shown = await journals.ditemid("s2fix_theme", "Entry 25:");
    const u = (await User.byName(journals.db, "s2fix_theme"))!;
    const [screened] = await u.cluster(journals.db, `SELECT t.jtalkid FROM talk2 t
        JOIN talktext2 x USING (journalid, jtalkid) WHERE t.journalid = ? AND t.state = 'S' AND x.body LIKE 'Screened%'`,
    [u.userid]);
    const screenedId = (int(screened!.jtalkid) << 8) + shown % 256;
    await compare(`/~s2fix_theme/${await journals.ditemid("s2fix_theme", "Private entry")}.html`);
    await compare("/~s2fix_theme/25600001.html");
    await compare("/~s2fix_theme/2026/01/28/private-entry.html?mode=reply");
    await compare("/~s2fix_theme/2026/01/27/private-entry.html");
    await compare(`/~s2fix_theme/${shown}.html?replyto=${screenedId}`);
    await compare(`/~s2fix_theme/${shown}.html?thread=${screenedId}`);
});

test("a memorial journal reads as usual, and a renamed one redirects", async () => {
    await compare("/~s2fix_memorial/");
    await compare("/~s2fix_renamed/2026/01/?style=light");
});

test("pages in the site's own style: a feed's entry, icons, and the light and site views", async () => {
    await compare(`/~s2fix_feed/${await journals.ditemid("s2fix_feed", "Feed item")}.html`);
    await compare("/~s2fix_default/icons");
    await compare("/~s2fix_theme/?style=light");
    await compare("/~s2fix_archive/2025/03/10/?style=site");
    await compare("/~s2fix_archive/security/");
});
