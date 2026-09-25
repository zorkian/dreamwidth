// check-page.ts
//
// Regenerate and compare one real stock S2 recent page through Perl and JS.
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
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cleanTrustedSafeChunk, Context } from "../runtime/s2runtime";
import { assertExactOutput } from "./run";

const s2Directory = path.resolve(__dirname, "../../../..");
const root = path.resolve(s2Directory, "../..");
const tools = path.join(root, "src/s2/target/javascript/tools");
const artifacts = path.join(root, "src/s2/target/javascript/artifacts/page");
const perlEnv = {
    PATH: "/usr/bin:/bin", LANG: "C.UTF-8", HOME: "/tmp",
    LJHOME: root, PERL5LIB: "/opt/dreamwidth-extlib/lib/perl5",
    PERL_HASH_SEED: "0", PERL_PERTURB_KEYS: "0",
};
const jsEnv = { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", HOME: "/tmp" };

function run(command: string, args: string[], perl: boolean, timeout: number,
    maxBuffer: number, expectedStatus = 0): Buffer {
    const result = spawnSync(command, args, {
        cwd: root, env: perl ? perlEnv : jsEnv, timeout, maxBuffer,
        killSignal: "SIGKILL", encoding: "buffer",
    });
    if (result.error || result.status !== expectedStatus) {
        throw new Error(`${path.basename(command)} ${args.join(" ")} failed: ` +
            `${result.error?.message ?? `status ${result.status}, signal ${result.signal}`}\n` +
            result.stderr?.toString("utf8"));
    }
    return result.stdout;
}

function perl(script: string, args: string[] = []): Buffer {
    return run("/usr/bin/perl", [path.join(tools, script), ...args], true, 60_000, 16 * 1024 * 1024);
}

function fixture(directory: string): { input: Buffer; oracle: Buffer } {
    mkdirSync(directory, { recursive: true });
    perl("page-fixture.pl", [directory]);
    return {
        input: readFileSync(path.join(directory, "page-input.json")),
        oracle: readFileSync(path.join(directory, "page-oracle.html")),
    };
}

function execute(compiled: string, input: string): Buffer {
    return run(process.execPath, [path.join(__dirname, "page-execute.js"), compiled, input],
        false, 10_000, 2 * 1024 * 1024);
}

function rejectExecute(compiled: string, input: string, message: string): void {
    const result = spawnSync(process.execPath,
        [path.join(__dirname, "page-execute.js"), compiled, input], {
            cwd: root, env: jsEnv, timeout: 10_000, maxBuffer: 2 * 1024 * 1024,
            killSignal: "SIGKILL", encoding: "buffer",
        });
    assert.equal(result.status, 1, `${message}: renderer should fail`);
    assert.match(result.stderr.toString("utf8"), new RegExp(message));
    assert.equal(result.stdout.length, 0, "Failed render must not leak partial HTML");
}

type Json = Record<string, any>;
function writeMutation(baseline: Buffer, name: string, mutate: (fixture: Json) => void): string {
    const parsed: Json = JSON.parse(baseline.toString("utf8"));
    mutate(parsed);
    const output = path.join(artifacts, `${name}.json`);
    writeFileSync(output, JSON.stringify(parsed));
    return output;
}

function entry(fixture: Json): Json {
    const graph = fixture.graph;
    const page = graph.nodes[graph.root.$ref].value;
    return graph.nodes[graph.nodes[page.entries.$ref].value[0].$ref].value;
}

function main(): void {
    mkdirSync(artifacts, { recursive: true });
    // Recover only the exact temporary body owned by this package if a prior
    // harness was killed before its finally block ran.
    perl("page-variant.pl", ["--restore-only"]);
    const cleanerCases: { input: string; output: string }[] = JSON.parse(
        perl("page-cleaner-probe.pl").toString("utf8"));
    for (const item of cleanerCases) {
        assert.equal(cleanTrustedSafeChunk(item.input), item.output, "Real HTMLCleaner parity");
    }
    assert.throws(() => cleanTrustedSafeChunk("<a title='&copy;'>x</a>"), /entity/);
    assert.throws(() => cleanTrustedSafeChunk("<a title='a\nb'>x</a>"), /multiline/);

    const first = fixture(path.join(artifacts, "baseline"));
    const again = fixture(path.join(artifacts, "regenerated"));
    assert(first.input.equals(again.input), "Prepared fixture generation differs");
    assert(first.oracle.equals(again.oracle), "Real HTTP oracle generation differs");
    const compileArgs = [path.join(tools, "fixture-pipeline.pl"), "compile",
        "core:styles/core2.s2", "layout:styles/core2base/layout.s2"];
    const compiled = run("/usr/bin/perl", compileArgs, true, 60_000, 16 * 1024 * 1024);
    assert(compiled.equals(run("/usr/bin/perl", compileArgs, true, 60_000,
        16 * 1024 * 1024)), "Stock JS compilation differs");
    const compiledPath = path.join(artifacts, "stock-compiled.json");
    writeFileSync(compiledPath, compiled);
    const baselinePath = path.join(artifacts, "baseline/page-input.json");
    const rendered = execute(compiledPath, baselinePath);
    assertExactOutput("stock recent page", first.oracle, rendered);
    writeFileSync(path.join(artifacts, "page-rendered.html"), rendered);

    const changes: [string, (value: Json) => void, string][] = [
        ["subject", value => { entry(value).subject = "Changed subject & text"; },
            "Changed subject & text"],
        ["body", value => { entry(value).text = "<p>Changed fixture body 😀</p>"; },
            "Changed fixture body 😀"],
        ["date", value => {
            const item = entry(value);
            value.graph.nodes[item.time.$ref].value.day = 23;
        }, "23"],
    ];
    for (const [name, mutate, marker] of changes) {
        const input = writeMutation(first.input, `mutation-${name}`, mutate);
        const changed = execute(compiledPath, input);
        assert(!changed.equals(rendered), `${name}: JS output ignored prepared input`);
        assert(changed.toString("utf8").includes(marker), `${name}: expected location did not change`);
    }

    const variantDirectory = path.join(artifacts, "variant");
    mkdirSync(variantDirectory, { recursive: true });
    try {
        perl("page-variant.pl", [variantDirectory]);
    } finally {
        perl("page-variant.pl", ["--restore-only"]);
    }
    const variant = {
        input: readFileSync(path.join(variantDirectory, "page-input.json")),
        oracle: readFileSync(path.join(variantDirectory, "page-oracle.html")),
    };
    assert(!variant.oracle.equals(first.oracle), "Real Perl variant did not change HTTP HTML");
    assertExactOutput("owned-content variant", variant.oracle,
        execute(compiledPath, path.join(artifacts, "variant/page-input.json")));
    const restored = fixture(path.join(artifacts, "restored"));
    assert(first.oracle.equals(restored.oracle), "Owned sample did not restore its real HTTP page");
    assert(first.input.equals(restored.input), "Owned sample did not restore prepared data");
    const failureDirectory = path.join(artifacts, "injected-failure");
    mkdirSync(failureDirectory, { recursive: true });
    try {
        assert.throws(() => perl("page-variant.pl", ["--fail-after-edit", failureDirectory]),
            /Injected failure/);
    } finally {
        perl("page-variant.pl", ["--restore-only"]);
    }
    try {
        const timeout = spawnSync("/usr/bin/perl",
            [path.join(tools, "page-variant.pl"), "--sleep-after-edit", failureDirectory], {
                cwd: root, env: perlEnv, timeout: 100, maxBuffer: 16 * 1024 * 1024,
                killSignal: "SIGKILL", encoding: "buffer",
            });
        assert(timeout.error || timeout.signal, "Injected variant timeout did not fail");
    } finally {
        perl("page-variant.pl", ["--restore-only"]);
    }
    const recovered = fixture(path.join(artifacts, "recovered"));
    assert(first.oracle.equals(recovered.oracle) && first.input.equals(recovered.input),
        "Injected failure or timeout left owned sample changed");

    assert.throws(() => assertExactOutput("deliberate mismatch", first.oracle,
        Buffer.from(rendered.toString("utf8") + "!")), /mismatch/);
    rejectExecute(compiledPath,
        writeMutation(first.input, "bad-schema", value => { value.provenance.schema = 2; }),
        "provenance");
    rejectExecute(compiledPath,
        writeMutation(first.input, "bad-stack", value => { value.provenance.layer_names[1] = "other"; }),
        "provenance");
    rejectExecute(compiledPath,
        writeMutation(first.input, "missing-host", value => { delete value.host.ljuser_html; }),
        "Missing or invalid prepared page fields");
    const brokenArtifact = path.join(artifacts, "broken-compiled.json");
    const broken = JSON.parse(compiled.toString("utf8"));
    broken.layers[1].code += "\nthrow new Error('deliberate renderer error');";
    writeFileSync(brokenArtifact, JSON.stringify(broken));
    rejectExecute(brokenArtifact, baselinePath, "deliberate renderer error");
    const context = new Context([], () => undefined);
    assert.throws(() => context.builtin._unknownHostCapability!(context), /Unknown|unknown/i);

    const timed = spawnSync(process.execPath, ["-e", "while(true){}"], {
        cwd: root, env: jsEnv, timeout: 100, maxBuffer: 2 * 1024 * 1024,
        killSignal: "SIGKILL", encoding: "buffer",
    });
    assert(timed.error || timed.signal, "Subprocess timeout did not fail");
    const overflow = spawnSync(process.execPath,
        ["-e", "process.stdout.write('x'.repeat(3*1024*1024))"], {
            cwd: root, env: jsEnv, timeout: 10_000, maxBuffer: 2 * 1024 * 1024,
            killSignal: "SIGKILL", encoding: "buffer",
        });
    assert(overflow.error, "Subprocess output bound did not fail");
    process.stdout.write(`Stock recent page parity passed: ${first.oracle.length} bytes; ` +
        "two entries, deterministic regeneration, real Perl variant, mutations, bounds.\n");
}

try {
    main();
} catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
}
