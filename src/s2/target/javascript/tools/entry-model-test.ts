// entry-model-test.ts
//
// Focused stock EntryPage model and anonymous transport type boundary check.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.
//

import assert from "node:assert/strict";
import {readFileSync, statSync} from "node:fs";
import path from "node:path";
import {createEntryCleaner} from "@dreamwidth/content";
import {approveSnapshot} from "../live/policy/cohort";
import {config, now, snapshot} from "../live/tests/fixtures";
import {validateArtifact} from "../live/render/artifact";
import {renderStock} from "../live/render/engine";
import {entryOgDescription} from "../live/render/host";
import {CSS_ENTRY, CSS_LIBRARY, CSS_PAGE, JS_ENTRY, JS_LIBRARY, JS_PAGE} from
    "../live/render/resources";
import type {ApprovedEntry, RenderContentPreparation, RenderInput} from
    "../live/render/types";

const project = process.cwd();
const root = path.resolve(project, "../../../..");
const artifact = validateArtifact(JSON.parse(readFileSync(
    path.join(project, "artifacts/live/stock.json"), "utf8")));
const journal = approveSnapshot(snapshot());
const times: Record<string, number> = Object.create(null);
for (const name of [...CSS_LIBRARY, ...CSS_PAGE, ...CSS_ENTRY, "controlstrip-light.css"]) {
    times["stc/" + name] = Math.floor(statSync(path.join(
        root, "build/static/stc", name)).mtimeMs / 1000);
}
for (const name of [...JS_LIBRARY, ...JS_PAGE, ...JS_ENTRY]) {
    times["js/" + name] = Math.floor(statSync(path.join(
        root, "build/static/js", name)).mtimeMs / 1000);
}

const cleaner = createEntryCleaner({maxInputBytes: 65536, maxOutputBytes: 2097152,
    maxNodes: 4096, maxDepth: 16, maxCssBytes: 65536, maxCssNodes: 4096,
    maxImageCandidates: 256, maxCuts: 16});
function render(page: RenderInput["page"]): {html: string; bodyCalls: number;
    metadataCalls: number} {
    const input: RenderInput = {page, journal, config, skip: 0, skipPresent: false,
        nowSeconds: now, formChallenge: "test-challenge", uniq: "test-uniq",
        resourceTimes: times};
    let bodyCalls = 0, metadataCalls = 0;
    function contentInput(entry: ApprovedEntry, entryUrl: string) {
        const documentUrl = `${config.canonicalAppOrigin}/~${journal.username}/` +
            (page.kind === "entry" ? `${page.ditemid}.html` : "");
        return {body: entry.rawBody, format: "html_raw0" as const, context: {
            policy: "dreamwidth-entry-html-raw0-v1" as const,
            insertionContext: "html-div-flow" as const, documentUrl, entryUrl,
            journalUsername: journal.username, journalId: journal.userid,
            entryId: entry.id, ...config.entryContent,
            cuts: page.kind === "entry" ? "source-compatible-entry" as const :
                "source-compatible-recent" as const,
            reader: {removeColors: false, removeSizes: false, removeFonts: false,
                maxImageWidth: null, maxImageHeight: null,
                placeholderUndefinedImageSize: false, extractImages: false},
        }};
    }
    const content: RenderContentPreparation = {
        body(entry, entryUrl) {
            assert.ok(journal.entries.includes(entry), "Body callback must receive the approved entry");
            bodyCalls++;
            const result = cleaner.clean(contentInput(entry, entryUrl));
            assert.equal(result.kind, "ok", "Shared body preparation refused a seed entry");
            if (result.kind !== "ok") throw new Error("Body preparation failed");
            return result.fragment.html;
        },
        metadata(entry, entryUrl) {
            assert.ok(journal.entries.includes(entry), "Metadata callback must receive the approved entry");
            metadataCalls++;
            const result = cleaner.metadata({subject: entry.subject,
                entry: contentInput(entry, entryUrl)});
            assert.equal(result.kind, "ok", "Shared metadata refused a seed entry");
            if (result.kind !== "ok") throw new Error("Metadata preparation failed");
            return result.metadata;
        },
    };
    return {html: renderStock(artifact, input, 2097152, content), bodyCalls, metadataCalls};
}

try {
    assert.equal(entryOgDescription("x".repeat(299) + " y"), "x".repeat(299));
    assert.equal(entryOgDescription("x".repeat(299) + "😀z"), "x".repeat(299) + "😀");
    assert.equal(entryOgDescription("&amp;"), "&amp;amp;");
    assert.equal(entryOgDescription("x\u00a0y"), "x\u00a0y");
    const recent = render({kind: "recent"});
    assert.equal(recent.bodyCalls, 2);
    assert.equal(recent.metadataCalls, 0, "RecentPage invoked EntryPage metadata");
    assert.ok(recent.html.includes('class="page-recent'));
    assert.ok(!recent.html.includes("LJ_cmtinfo"));
    for (const entry of journal.entries) {
        assert.ok(recent.html.includes(entry.subject));
    }
    const selected = journal.entries[0]!;
    const entry = render({kind: "entry", ditemid: selected.id});
    assert.equal(entry.bodyCalls, 1);
    assert.equal(entry.metadataCalls, 1);
    assert.ok(entry.html.includes('class="page-entry'));
    assert.ok(entry.html.includes(`<title>s2js_slice3 | ${selected.subject}</title>`));
    assert.ok(entry.html.includes(`id="entry-${selected.id}"`));
    assert.ok(entry.html.includes("id='comments'"));
    assert.ok(entry.html.includes('id="ljqrttopcomment"'));
    assert.ok(entry.html.includes("var LJ_cmtinfo = "));
    for (const dir of ["prev", "next"]) {
        assert.ok(entry.html.includes(
            `/go?dir=${dir}&itemid=${selected.id}&journal=s2js_slice3`));
    }
    assert.ok(entry.html.includes(`/${selected.id}.html?style=site`));
    assert.ok(entry.html.includes(`&view=entry`));
    assert.ok(!recent.html.includes(`&view=entry`));
    process.stdout.write("stock Recent/Entry model callbacks, shell and controls: pass\n");
} finally {
    cleaner.close();
}
