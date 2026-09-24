// selftest.ts
//
// Failure-path checks for the bounded S2 JavaScript fixture runner.
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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Context, Layer } from "../runtime/s2runtime";
import { boundedRun } from "./bounded";
import { assertExactOutput, assertExpectedSyntaxFailure, manifest, validateManifest } from "./run";

function main(): void {
    assert.throws(() => validateManifest(manifest.slice(1)), /Nine mandatory/);
    const duplicate = [...manifest];
    duplicate[1] = duplicate[0]!;
    assert.throws(() => validateManifest(duplicate), /Mandatory S2 case/);
    const substituted = [...manifest];
    substituted[0] = { id: "Hello_World.s2", layers: [{ type: "core", file: "Arithmetic.s2" }] };
    assert.throws(() => validateManifest(substituted), /mandatory layer changed/);
    assert.throws(() => assertExactOutput("whitespace", Buffer.from("x\n"), Buffer.from("x")), /mismatch/);
    assert.throws(() => assertExactOutput("missing", Buffer.from("x"), Buffer.alloc(0)), /missing positive output/);
    const syntaxSource = "tests/fail-syntax.s2";
    const syntaxExpected = readFileSync(
        path.resolve(__dirname, "../../../../tests/fail-syntax.s2.err"), "utf8",
    );
    const rejectSyntax = (message: string) => assertExpectedSyntaxFailure(
        "fail-syntax.s2", 255, Buffer.alloc(0), Buffer.from(message), syntaxSource, syntaxExpected,
    );
    assert.doesNotThrow(() => rejectSyntax(`${syntaxSource}: ${syntaxExpected}`));
    assert.throws(() => rejectSyntax(`Cannot read ${syntaxSource}`), /expected retained syntax diagnostic/);
    assert.throws(() => rejectSyntax(`${syntaxSource}: checker rejected nosuch()`), /expected retained syntax diagnostic/);
    assert.throws(
        () => assertExpectedSyntaxFailure("fail-syntax.s2", 255, Buffer.alloc(0),
            Buffer.from(`${syntaxSource}: ${syntaxExpected}`), syntaxSource, "  "),
        /expected retained syntax diagnostic/,
    );
    const sourceLayer = new Layer();
    sourceLayer.source = "tests/diagnostic.s2";
    const context = new Context([sourceLayer], () => {});
    assert.throws(
        () => context.getMethod({ ".type": "Foo", ".isnull": true }, "out()", sourceLayer, 17),
        /tests\/diagnostic\.s2:17: method out\(\) called on null object/,
    );

    assert.throws(
        () => boundedRun(process.execPath, ["-e", "while (true) {}"], __dirname, 200),
        /ETIMEDOUT/,
    );
    assert.throws(
        () => boundedRun(process.execPath, ["-e", "process.stdout.write('x'.repeat(2048))"], __dirname, 5000, 512),
        /ENOBUFS/,
    );

    const temporary = mkdtempSync(path.join(tmpdir(), "s2-js-selftest-"));
    try {
        const artifact = path.join(temporary, "wrong-abi.json");
        writeFileSync(artifact, JSON.stringify({ abi: 2, layers: [{ source: "test", variable: "layer_0", code: "" }] }));
        const result = boundedRun(process.execPath, [path.join(__dirname, "execute.js"), artifact], __dirname);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr.toString("utf8"), /artifact ABI 2 != runtime ABI 1/);
        assert.equal(result.stdout.length, 0);

        writeFileSync(artifact, JSON.stringify({
            abi: 1,
            layers: [{
                source: "test.s2",
                variable: "layer_0",
                code: "s2.assertABI(2); var layer_0 = s2.makeLayer();",
            }],
        }));
        const generatedMismatch = boundedRun(
            process.execPath, [path.join(__dirname, "execute.js"), artifact], __dirname,
        );
        assert.notEqual(generatedMismatch.status, 0);
        assert.match(generatedMismatch.stderr.toString("utf8"), /test.s2: generated layer failed: Error: S2 artifact ABI 2/);
    } finally {
        rmSync(temporary, { recursive: true, force: true });
    }
    process.stdout.write("S2 fixture harness failure paths passed.\n");
}

main();
