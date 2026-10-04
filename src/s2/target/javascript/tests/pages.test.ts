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
import { createHmac } from "node:crypto";
import path from "node:path";
import { after, before, test } from "node:test";
import { type Databases, int } from "../data/db";
import { User } from "../data/user";
import { renderJournal } from "../render/render";
import { currentSecret } from "../render/reply-page";
import { createApp } from "../server/app";
import { HOST, TestJournals } from "./journal";

const PERL = "http://localhost:8080";
const JS = `http://${HOST}`;

let journals: TestJournals;
let app: ReturnType<typeof createApp>;
interface Page { status: number; body: string; type: string; location?: string }
let tools: {
    summarize(page: Page, origins: string[], quips: readonly string[]): string;
    fetchPage(origin: string, path: string, host?: string, cookie?: string): Promise<Page>;
};

before(async () => {
    journals = new TestJournals();
    app = createApp(journals.config, journals.db, journals.compiler,
        request => renderJournal(journals.db, { config: journals.config, host: request.host }, request));
    tools = await import(path.resolve(__dirname, "../../tools/compare-pages.mjs"));
});
after(() => journals.close());

// Returns the page as compared, for checks on what both servers showed.
async function comparePage(pagePath: string, cookie?: string): Promise<string> {
    const response = await app.inject({ url: pagePath, headers: { host: HOST, ...cookie ? { cookie } : {} } });
    const js = {
        status: response.statusCode, body: response.body, type: String(response.headers["content-type"] ?? ""),
        location: response.headers.location as string | undefined,
    };
    const perl = await tools.fetchPage(PERL, pagePath, undefined, cookie);
    const quips = journals.config.notFoundQuips;
    const summary = tools.summarize(js, [PERL, JS], quips);
    assert.equal(summary, tools.summarize(perl, [PERL, JS], quips), pagePath);
    return summary;
}

async function compare(pagePath: string): Promise<void> {
    await comparePage(pagePath);
}

test("recent pages, in the default style, a theme and a user layer", async () => {
    for (const user of ["s2fix_default", "s2fix_theme", "s2fix_custom"]) await compare(`/~${user}/`);
});

test("a syndicated journal, in the site's feed style", () => compare("/~s2fix_feed/"));

test("a paid journal's list of entries with the newest comments", () => compare("/~s2fix_active/"));

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

test("reply pages with the site's captcha, where the journal asks for it and not", async () => {
    const url = `/~s2fix_captcha/${await journals.ditemid("s2fix_captcha", "Entry 1:")}.html?mode=reply`;
    await compare(url);

    // A browser recently logged in to an account in good standing is not asked,
    // as long as its ljtrust cookie is signed for its ljuniq.
    const reader = (await User.byName(journals.db, "s2fix_reader"))!;
    const { stime, secret } = await currentSecret(journals.db);
    const uniq = "abcdefghijklmno";
    const sig = createHmac("sha1", secret).update(`trust-${reader.userid}-${uniq}-${stime}`).digest("hex");
    const cookie = (sign: string) => `ljuniq=${uniq}:${stime}; ljtrust=` +
        encodeURIComponent(`v1:u${reader.userid}:t${stime}:g${sign}//${journals.config.trustCookie.generations[0]}`);
    const trusted = await comparePage(url, cookie(sig));
    assert.doesNotMatch(trusted, /h-captcha/);
    const forged = await comparePage(url, cookie("0".repeat(40)));
    assert.match(forged, /h-captcha/);
});

test("feeds, as RSS and Atom, at each syndication level", async () => {
    // Cut, with the owner's address; summaries under the journal's own title; titles only.
    for (const path of ["/~s2fix_theme/data/rss", "/~s2fix_theme/data/atom", "/~s2fix_custom/data/atom",
        "/~s2fix_default/data/rss", "/~s2fix_comm/data/rss"]) {
        await compare(path);
    }
    // One entry, with a poll and embedded media, from a journal with an icon.
    await compare(`/~s2fix_archive/data/rss?itemid=${await journals.ditemid("s2fix_archive", "Embeds and a poll")}`);
});

test("profiles: a personal journal showing all it may, a community and an OpenID account", async () => {
    await compare("/~s2fix_profile/profile");
    await compare("/~s2fix_comm/profile?mode=full");
    const [openid] = await journals.db.global("SELECT userid FROM identitymap WHERE identity = ?",
        ["https://openid.example.com/s2fix"]);
    await compare(`/profile?userid=${int(openid!.userid)}&t=I`);
});

test("the site's own pages: a legal page, the site map, and the FAQ with its mark-up", async () => {
    await compare("/legal/tos");
    await compare("/site/");
    await compare("/support/faq");
    const [faq] = await journals.db.global("SELECT faqid FROM faq WHERE question LIKE 'How does [[username]]%'");
    await compare(`/support/faqbrowse?faqid=${int(faq!.faqid)}&q=visit`);
    await compare("/support/faqbrowse?faqcat=s2fix");
});

test("an entry with an embedded video and a poll", () => compare("/~s2fix_archive/2025/06/01/"));

test("a community and a reading page", async () => {
    await compare("/~s2fix_comm/");
    await compare("/~s2fix_reader/read");
});

test("the health check answers on any host, and fails while the database is down", async () => {
    const response = await app.inject({ url: "/healthz", headers: { host: "10.0.0.1:8091" } });
    assert.equal(response.statusCode, 200);
    const down = createApp(journals.config, { global: () => Promise.reject(new Error("down")) } as unknown as Databases,
        journals.compiler, () => Promise.reject(new Error("unused")));
    const failing = console.error;
    console.error = () => {};
    try {
        assert.equal((await down.inject({ url: "/healthz" })).statusCode, 503);
    } finally {
        console.error = failing;
    }
});

test("a paid reader's content filter", () => compare("/~s2fix_filterer/read/Fixture+filter"));

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
