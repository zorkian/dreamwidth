// native-entities.test.ts
//
// Scalar compatibility tests against the installed independent native helper.
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
import { execFileSync } from "node:child_process";
import test from "node:test";
import { decodeNativeEntities } from "../domain/native-entities";

test("native scalar names, reference boundaries, numeric and attribute projection", () => {
    // Run from the S2 target directory inside the devcontainer. Perl is only an
    // offline test oracle; the serving module has no process or parser imports.
    const native = JSON.parse(execFileSync("perl", ["live/tests/native-entities.pl"], {
        encoding: "utf8", maxBuffer: 4 * 1024 * 1024,
    })) as {version: string; sourceSha256: string; names: string[];
        rows: {input: string; entities: string; parser: string}[]};
    assert.equal(native.version, "3.85");
    assert.equal(native.sourceSha256,
        "299f52598b6bcceeb1bd5a28351d6eddc0a0421566409cac9870420101198dfa");
    assert.equal(native.names.length, 253);
    assert.equal(native.names.filter(name => name.endsWith(";")).length, 152);
    assert.ok(native.rows.length > 5500);
    for (const row of native.rows) {
        assert.equal(decodeNativeEntities(row.input), row.entities, JSON.stringify(row.input));
        assert.equal(decodeNativeEntities(row.input), row.parser, "attribute " + JSON.stringify(row.input));
    }
});
