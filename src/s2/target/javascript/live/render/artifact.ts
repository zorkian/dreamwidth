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
import {THEMES,EASYREAD} from "./theme-catalog";
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
    if(artifact.layouts!==undefined) {
        if(!Array.isArray(artifact.layouts)||artifact.layouts.length!==1)throw new Error("Invalid layout catalog");
        const layout=artifact.layouts[0]!;
        if(layout.name!=="easyread"||layout.sourceHash!==EASYREAD.sourceHash||typeof layout.code!=="string"||layout.code.length>4194304||
            createHash("sha256").update(layout.code).digest("hex")!==EASYREAD.codeHash)throw new Error("Invalid layout code");
    }
    if(artifact.themes!==undefined) {
        if(!Array.isArray(artifact.themes)||artifact.themes.length!==(artifact.layouts?3:2)||
            new Set(artifact.themes.map(theme=>theme.name)).size!==(artifact.layouts?3:2))throw new Error("Invalid theme catalog");
        for(const theme of artifact.themes) {
            if(!Object.hasOwn(THEMES,theme.name))throw new Error("Invalid theme");
            const expected=THEMES[theme.name as keyof typeof THEMES];
            if(theme.sourceHash!==expected.sourceHash||typeof theme.code!=="string"||theme.code.length>4194304||
                createHash("sha256").update(theme.code).digest("hex")!==expected.codeHash)throw new Error("Invalid theme code");
        }
    }
    if(artifact.layouts&&!artifact.themes?.some(theme=>theme.name==='aqua')||!artifact.layouts&&artifact.themes?.some(theme=>theme.name==='aqua'))throw new Error("Incomplete layout/theme catalog");
    return artifact;
}
export function instantiate(artifact: Artifact, theme?: keyof typeof THEMES, layout?: "easyread"): StockLayer[] {
    // Only the pinned local compiler artifact is executable. Each request gets
    // new layers so init mutations of arrays/hashes cannot survive a request.
    const selected=theme?artifact.themes?.find(item=>item.name===theme):undefined;
    if(theme&&!selected)throw new Error("Missing theme catalog; recompile with --themes");
    if(layout&&theme!=='aqua'||!layout&&theme==='aqua')throw new Error("Incompatible layout/theme");
    const selectedLayout=layout?artifact.layouts?.find(item=>item.name===layout):undefined;
    if(layout&&!selectedLayout)throw new Error("Missing EasyRead catalog; recompile with --easyread");
    const items=[artifact.layers[0]!,selectedLayout?{source:"styles/easyread/layout.s2",variable:"layout_easyread",code:selectedLayout.code}:artifact.layers[1]!,...(selected?[{source:(layout?"styles/easyread/themes.s2#":"styles/core2base/themes.s2#")+theme,
        variable:"theme_"+theme,code:selected.code}]:[])];
    return items.map(item => {
        const api = { ...s2, makeLayer: () => new StockLayer() };
        const layer = new Function("s2", `"use strict";\n${item.code}\nreturn ${item.variable};`)(api);
        if (!(layer instanceof StockLayer)) throw new Error("Invalid stock layer");
        layer.source = item.source;
        return layer;
    });
}
