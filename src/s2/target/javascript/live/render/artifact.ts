// artifact.ts
//
// Local S2 cohort admission and source-derived rendering.
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

import { createHash } from "node:crypto";
import { Layer, s2 } from "../../runtime/s2runtime";
import type { Artifact } from "./types";
import { SOURCE_HASHES } from "./source-hashes";

export class StockLayer extends Layer {
    readonly metadata = new Map<string, { type: string; attributes: Record<string, string> }>();
    override registerProperty(name: string, type: string, attributes: Record<string, string>): void {
        this.metadata.set(name, { type, attributes });
    }
}
export function validateArtifact(value: unknown): Artifact {
    // Deterministic live-compile.pl output from the reviewed compiler and pinned
    // sources. Checking the claimed source hash alone would admit arbitrary JS.
    const codeHashes = [
        "465cb6b53ccd1bb553561712dffd8bbf2a5d74df0913893346d0eb660f5dfc29",
        "b05f895f5ff5b03c24de9f28dd78e1c7bf4c9342011602d3c51ee3fcbafe9f65",
    ];
    const artifact = value as Artifact;
    if (!artifact || artifact.schema !== 1 || artifact.abi !== 1 ||
        !Array.isArray(artifact.layers) || artifact.layers.length !== 2) throw new Error("Invalid artifact");
    for (const [i, layer] of artifact.layers.entries()) {
        if (layer.source !== ["styles/core2.s2", "styles/core2base/layout.s2"][i] ||
            layer.sourceHash !== SOURCE_HASHES[i] || layer.variable !== `layer_${i}` ||
            typeof layer.code !== "string" || !layer.code || layer.code.length > 4194304 ||
            createHash("sha256").update(layer.code).digest("hex") !== codeHashes[i]) {
            throw new Error("Invalid stock artifact");
        }
    }
    return artifact;
}
export function instantiate(artifact: Artifact): StockLayer[] {
    // Only the pinned local compiler artifact is executable. Each request gets
    // new layers so init mutations of arrays/hashes cannot survive a request.
    return artifact.layers.map(item => {
        const api = { ...s2, makeLayer: () => new StockLayer() };
        const layer = new Function("s2", `"use strict";\n${item.code}\nreturn ${item.variable};`)(api);
        if (!(layer instanceof StockLayer)) throw new Error("Invalid stock layer");
        layer.source = item.source;
        return layer;
    });
}
