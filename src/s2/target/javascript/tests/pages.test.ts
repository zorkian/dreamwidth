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
import { Compiler } from "../compile/compiler";
import { renderJournal } from "../render/render";
import { createApp } from "../server/app";
import { HOST, TestJournals } from "./journal";

const PERL = "http://localhost:8080";
const JS = `http://${HOST}`;

let journals: TestJournals;
let compiler: Compiler;
let app: ReturnType<typeof createApp>;
let tools: { normalize(html: string, origins: string[]): string; fetchPage(origin: string, path: string): Promise<{ status: number; html: string }> };

before(async () => {
    journals = new TestJournals();
    compiler = new Compiler(journals.db);
    app = createApp(journals.config, journals.db, compiler,
        request => renderJournal(journals.db, { config: journals.config, host: request.host }, request));
    tools = await import(path.resolve(__dirname, "../../tools/compare-pages.mjs"));
});
after(async () => {
    compiler.close();
    await journals.close();
});

async function compare(pagePath: string): Promise<void> {
    const js = await app.inject({ url: pagePath, headers: { host: HOST } });
    const perl = await tools.fetchPage(PERL, pagePath);
    assert.equal(js.statusCode, perl.status);
    assert.equal(tools.normalize(js.body, [PERL, JS]), tools.normalize(perl.html, [PERL, JS]));
}

test("recent pages, in the default style, a theme and a user layer", async () => {
    for (const user of ["s2fix_default", "s2fix_theme", "s2fix_custom"]) await compare(`/~${user}/`);
});

test("an older page of entries", () => compare("/~s2fix_theme/?skip=20"));

test("entry pages with comment threads", async () => {
    await compare(`/~s2fix_theme/${await journals.ditemid("s2fix_theme", "Entry 25:")}.html`);
    await compare(`/~s2fix_custom/${await journals.ditemid("s2fix_custom", "Entry 4:")}.html`);
});

test("an entry page without comments", async () => {
    await compare(`/~s2fix_default/${await journals.ditemid("s2fix_default", "Entry 3:")}.html`);
});
