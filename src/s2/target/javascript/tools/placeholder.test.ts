// placeholder.test.ts
//
// Configured origins and source URL facts for the private journal renderer.
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
import {spawnSync} from "node:child_process";
import {mkdtempSync, writeFileSync, utimesSync, rmSync} from "node:fs";
import path from "node:path";
import test from "node:test";
import type {PlaceholderResolutionSpec} from "../live/contracts";
import {SnapshotError} from "../live/data/errors";
import {placeholderFileValue, resolvePlaceholderValue} from "../live/domain/placeholder";

function temporary(run: (dir: string) => void): void {
    const dir = mkdtempSync("/tmp/slice6-placeholder-");
    try { run(dir); } finally { rmSync(dir, {recursive: true, force: true}); }
}
function spec(files: string[], dev = true): PlaceholderResolutionSpec {
    return {descriptor: {src: "/img/placeholder.png", width: 35, height: 35, altKey: "img.placeholder"},
        defaultLang: "fr", isDevServer: dev, languageFiles: files};
}

test("language parser follows independent retained single/multiline/metadata overwrites", () => temporary(dir => {
    const samples = ["img.placeholder=One\n", "IMG.PLACEHOLDER=Upper\n",
        "# comment\nimg.placeholder=0\n", "img.placeholder<<\nFirst\n..Second\n.\n",
        "img.placeholder=first\nimg.placeholder|note=second\n",
        "img.placeholder=retained\n!other\n", "img.placeholder=CRLF\r\n",
        "other=value\n", "img.placeholder<<\nunterminated\n"];
    for (const [index, source] of samples.entries()) {
        const file = path.join(dir, String(index)); writeFileSync(file, source);
        const native = spawnSync("perl", ["-I", path.resolve(process.cwd(), "../../../../cgi-bin"),
            "-MLJ::LangDatFile", "-MJSON::PP", "-e",
            'my $v=LJ::LangDatFile->new($ARGV[0])->value("img.placeholder"); print JSON::PP->new->encode($v)', file],
            {encoding: "utf8", timeout: 10000});
        assert.equal(native.status, 0, native.stderr);
        assert.equal(placeholderFileValue(source, "img.placeholder"), JSON.parse(native.stdout));
    }
    assert.throws(() => placeholderFileValue("bogus format\n", "img.placeholder"), SnapshotError);
}));

test("startup file/DB precedence and Perl false/missing rules preserve public projection", () => temporary(dir => {
    const first = path.join(dir, "fr.dat"), second = path.join(dir, "en.dat");
    writeFileSync(first, "img.placeholder=Fichier &amp; &#34; café\n");
    writeFileSync(second, "img.placeholder=Fallback\n");
    utimesSync(first, 1000, 1000); utimesSync(second, 1000, 1000);
    const value = spec([first, second]);
    assert.deepEqual(resolvePlaceholderValue(value, "Database", 999),
        {alt: 'Fichier & " café', title: 'Fichier & " café'});
    assert.deepEqual(resolvePlaceholderValue(value, "Database", 1001), {alt: "Database", title: "Database"});
    assert.equal(resolvePlaceholderValue({...value, isDevServer: false}, "Database", 999).alt, "Database");
    assert.equal(resolvePlaceholderValue({...value, isDevServer: false}, null, 999).alt, 'Fichier & " café');
    writeFileSync(first, "img.placeholder=0\n"); utimesSync(first, 1000, 1000);
    assert.equal(resolvePlaceholderValue(value, "Database", 999).alt, "Fallback");
    assert.equal(resolvePlaceholderValue(spec([path.join(dir, "missing")]), null, 0).alt, "img.placeholder");
    assert.equal(resolvePlaceholderValue(spec([], false), "0", 0).alt, "img.placeholder");
    assert.equal(resolvePlaceholderValue(spec([], false), "[uhhh: absent]", 0).alt, "img.placeholder");
    assert.equal(resolvePlaceholderValue(spec([], false), "Single ' quote", 0).alt, "Single ' quote");
    for (const text of ['Literal " quote', "\u0000", "x".repeat(1025), "\ud800"]) {
        assert.throws(() => resolvePlaceholderValue(spec([], false), text, 0), SnapshotError);
    }
    assert.throws(() => resolvePlaceholderValue(spec([dir]), null, 0), SnapshotError);
    assert.throws(() => resolvePlaceholderValue(value, "Database", -1), SnapshotError);
}));
