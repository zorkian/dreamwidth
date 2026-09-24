// run.ts
//
// Regenerate and compare the fixed nine S2 JavaScript slice 1 fixture cases.
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
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { boundedRun } from "./bounded";

interface LayerSpec {
    type: "core" | "layout";
    file: string;
}

export interface Case {
    id: string;
    layers: readonly LayerSpec[];
    negative?: true;
}

const expectedIds = [
    "Hello_World.s2", "Arithmetic.s2", "conditions.s2", "range.s2",
    "arrayliterals.s2", "super.s2", "fail-syntax.s2", "two-layer", "unicode",
];

const expectedLayers: Record<string, readonly string[]> = {
    "Hello_World.s2": ["core:Hello_World.s2"],
    "Arithmetic.s2": ["core:Arithmetic.s2"],
    "conditions.s2": ["core:conditions.s2"],
    "range.s2": ["core:range.s2"],
    "arrayliterals.s2": ["core:arrayliterals.s2"],
    "super.s2": ["core:super.s2"],
    "fail-syntax.s2": ["core:fail-syntax.s2"],
    "two-layer": ["core:js-slice1-parent.s2", "layout:js-slice1-child.s2"],
    "unicode": ["core:js-slice1-unicode.s2"],
};

export const manifest: readonly Case[] = [
    { id: "Hello_World.s2", layers: [{ type: "core", file: "Hello_World.s2" }] },
    { id: "Arithmetic.s2", layers: [{ type: "core", file: "Arithmetic.s2" }] },
    { id: "conditions.s2", layers: [{ type: "core", file: "conditions.s2" }] },
    { id: "range.s2", layers: [{ type: "core", file: "range.s2" }] },
    { id: "arrayliterals.s2", layers: [{ type: "core", file: "arrayliterals.s2" }] },
    { id: "super.s2", layers: [{ type: "core", file: "super.s2" }] },
    { id: "fail-syntax.s2", layers: [{ type: "core", file: "fail-syntax.s2" }], negative: true },
    {
        id: "two-layer",
        layers: [
            { type: "core", file: "js-slice1-parent.s2" },
            { type: "layout", file: "js-slice1-child.s2" },
        ],
    },
    { id: "unicode", layers: [{ type: "core", file: "js-slice1-unicode.s2" }] },
];

export function validateManifest(cases: readonly Case[]): void {
    assert.equal(cases.length, expectedIds.length, "Nine mandatory S2 cases required");
    assert.deepEqual(cases.map(item => item.id), expectedIds, "Mandatory S2 case missing or reordered");
    assert.equal(new Set(cases.map(item => item.id)).size, expectedIds.length, "Duplicate S2 case");
    assert.equal(cases.filter(item => item.negative).length, 1, "Exactly one negative case required");
    for (const item of cases) {
        assert.deepEqual(
            item.layers.map(layer => `${layer.type}:${layer.file}`),
            expectedLayers[item.id],
            `${item.id}: mandatory layer changed or skipped`,
        );
        assert.equal(item.negative === true, item.id === "fail-syntax.s2", `${item.id}: negative flag changed`);
    }
}

export function assertExactOutput(id: string, oracle: Buffer, executed: Buffer): void {
    if (oracle.length === 0 || executed.length === 0) {
        throw new Error(`${id}: missing positive output`);
    }
    if (!oracle.equals(executed)) {
        throw new Error(
            `${id}: exact UTF-8 output mismatch\n` +
            `Perl: ${JSON.stringify(oracle.toString("utf8"))}\n` +
            `JS:   ${JSON.stringify(executed.toString("utf8"))}`,
        );
    }
}

function main(): void {
    validateManifest(manifest);
    const s2Directory = path.resolve(__dirname, "../../../..");
    const bridge = path.join(s2Directory, "target/javascript/tools/fixture-pipeline.pl");
    const executor = path.join(__dirname, "execute.js");
    const temporary = mkdtempSync(path.join(tmpdir(), "s2-js-slice1-"));
    const completed: string[] = [];
    try {
        for (const item of manifest) {
            const args = item.layers.map(layer => {
                const source = path.join(s2Directory, "tests", layer.file);
                if (!existsSync(source)) throw new Error(`${item.id}: missing fixture ${source}`);
                return `${layer.type}:tests/${layer.file}`;
            });
            const compiled = boundedRun("/usr/bin/perl", [bridge, "compile", ...args], s2Directory);
            if (item.negative) {
                const diagnostic = compiled.stderr.toString("utf8");
                if (compiled.status === 0 || compiled.stdout.length !== 0 ||
                    !/line|syntax|parse|error/i.test(diagnostic) ||
                    !diagnostic.includes(item.layers[0]!.file)) {
                    throw new Error(`${item.id}: expected useful nonzero compile diagnostic, got ${diagnostic}`);
                }
                completed.push(item.id);
                continue;
            }
            if (compiled.status !== 0 || compiled.stdout.length === 0) {
                throw new Error(`${item.id}: JS compile failed: ${compiled.stderr.toString("utf8")}`);
            }
            const regenerated = boundedRun("/usr/bin/perl", [bridge, "compile", ...args], s2Directory);
            if (regenerated.status !== 0 || !compiled.stdout.equals(regenerated.stdout)) {
                throw new Error(`${item.id}: generated artifact is not deterministic`);
            }
            const artifact = path.join(temporary, `${item.id}.json`);
            writeFileSync(artifact, compiled.stdout);

            const oracle = boundedRun("/usr/bin/perl", [bridge, "oracle", ...args], s2Directory);
            if (oracle.status !== 0 || oracle.stdout.length === 0) {
                throw new Error(`${item.id}: Perl oracle failed or produced no output: ${oracle.stderr.toString("utf8")}`);
            }
            const executed = boundedRun(process.execPath, [executor, artifact], s2Directory);
            if (executed.status !== 0 || executed.stdout.length === 0) {
                throw new Error(`${item.id}: JS runtime failed or produced no output: ${executed.stderr.toString("utf8")}`);
            }
            assertExactOutput(item.id, oracle.stdout, executed.stdout);
            completed.push(item.id);
        }
        assert.equal(completed.length, expectedIds.length);
        process.stdout.write(`All ${completed.length} mandatory S2 cases passed; regeneration deterministic.\n`);
    } finally {
        rmSync(temporary, { recursive: true, force: true });
    }
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}
