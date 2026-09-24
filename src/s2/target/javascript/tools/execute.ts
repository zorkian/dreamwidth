// execute.ts
//
// Execute one trusted, generated S2 fixture artifact without a Perl process.
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

import { readFileSync } from "node:fs";
import { ABI_VERSION, Context, Layer, s2 } from "../runtime/s2runtime";

interface CompiledLayer {
    source: string;
    variable: string;
    code: string;
}

interface Artifact {
    abi: number;
    layers: CompiledLayer[];
}

function parseArtifact(raw: string): Artifact {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) throw new Error("Invalid S2 artifact");
    const artifact = parsed as Partial<Artifact>;
    if (artifact.abi !== ABI_VERSION) {
        throw new Error(`S2 artifact ABI ${artifact.abi} != runtime ABI ${ABI_VERSION}`);
    }
    if (!Array.isArray(artifact.layers) || artifact.layers.length === 0) {
        throw new Error("S2 artifact has no layers");
    }
    for (const layer of artifact.layers) {
        if (typeof layer.source !== "string" || !layer.source ||
            typeof layer.code !== "string" || !layer.code ||
            typeof layer.variable !== "string" || !/^layer_\d+$/.test(layer.variable)) {
            throw new Error("Invalid S2 artifact layer");
        }
    }
    return artifact as Artifact;
}

function main(): void {
    const artifactPath = process.argv[2];
    if (!artifactPath || process.argv.length !== 3) throw new Error("Expected one artifact path");
    const artifact = parseArtifact(readFileSync(artifactPath, "utf8"));
    const layers: Layer[] = [];
    for (const item of artifact.layers) {
        // The harness supplies only checked-in fixture artifacts. This is code execution,
        // not a tenant sandbox; the parent subprocess enforces accidental-loop limits.
        let layer: unknown;
        try {
            const load = new Function("s2", `"use strict";\n${item.code}\nreturn ${item.variable};`);
            layer = load(s2);
        } catch (error) {
            throw new Error(`${item.source}: generated layer failed: ${String(error)}`);
        }
        if (!(layer instanceof Layer)) throw new Error(`${item.source}: compiler returned no layer`);
        layer.source = item.source;
        layers.push(layer);
    }
    const context = new Context(layers, text => process.stdout.write(text));
    context.runFunction("main()");
}

try {
    main();
} catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
}
