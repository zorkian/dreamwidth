// content-differential.test.ts
//
// Actual retained cleaner probes for the admitted body grammar.
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

import {test} from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {resolve} from "node:path";
import {bodyHtml} from "../policy/content";

test("admitted HTML grammar is byte-identical to actual retained html_raw0 cleaner", () => {
    const examples = ["plain café 😀", "x & y", "text\nwith\nnewlines", "", "plain\ttext",
        "<p>Fixture: café &amp; tea 😀</p>", "<p>&lt;script&gt;&quot;text&quot;</p>",
        "<p>one</p>\n<p>two</p>", "<strong>strong</strong><em>emphasis</em>",
        "<p><b><i>deep</i></b><br />end</p>", "<br>", "x\n<br>\ny",
        "&abc", "5 > 4", "&amp", "&lt", "&quot", "&notit", "hello@example.invalid"];
    for (const tag of ["p", "strong", "em", "b", "i"]) {
        for (const body of ["", " ", "\n", "&amp;", "é 😀", "<br>", "<br />"]) {
            examples.push(`<${tag}>${body}</${tag}>`);
        }
        for (const inner of ["strong", "em", "b", "i"]) {
            examples.push(`<${tag}><${inner}>nested</${inner}></${tag}>`);
        }
    }
    const admitted = examples.filter(value => {try {bodyHtml(value); return true;} catch {return false;}});
    const result = spawnSync("perl", [resolve(__dirname, "../../../live/tests/content-oracle.pl")], {
        input: JSON.stringify(admitted), encoding: "utf8", timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    const cleaned = JSON.parse(result.stdout) as string[];
    assert.equal(cleaned.length, admitted.length);
    for (const [i, value] of admitted.entries()) assert.equal(cleaned[i], value, value);
});
