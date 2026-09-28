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
import { renderJournal } from "../render/render";
import { createApp } from "../server/app";
import { HOST, TestJournals } from "./journal";

const PERL = "http://localhost:8080";
const JS = `http://${HOST}`;

let journals: TestJournals;
let app: ReturnType<typeof createApp>;
interface Page { status: number; body: string; type: string; location?: string }
let tools: { summarize(page: Page, origins: string[]): string; fetchPage(origin: string, path: string): Promise<Page> };

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
    assert.equal(tools.summarize(js, [PERL, JS]), tools.summarize(perl, [PERL, JS]), pagePath);
}

test("recent pages, in the default style, a theme and a user layer", async () => {
    for (const user of ["s2fix_default", "s2fix_theme", "s2fix_custom"]) await compare(`/~${user}/`);
});

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

test("tags and icons pages", async () => {
    await compare("/~s2fix_theme/tag/");
    await compare("/~s2fix_archive/icons?sortorder=keyword");
});

test("stylesheets, cleaned as CSS", async () => {
    await compare("/~s2fix_theme/res/14/stylesheet");
    await compare("/~s2fix_custom/res/16/stylesheet");
});
