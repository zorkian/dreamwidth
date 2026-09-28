// compiler.ts
//
// Compile layers with tools/compile-server.pl and cache the JavaScript by
// layer source.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { createInterface } from "node:readline";
import { type Databases, int, text } from "../data/db";
import type { LayerRef } from "./styles";

export interface CompiledLayer {
    readonly id: number;
    readonly type: string;
    readonly variable: string;
    readonly code: string;
}

const SERVER = path.resolve(__dirname, "../../tools/compile-server.pl");

export class Compiler {
    private readonly cache = new Map<string, Promise<CompiledLayer>>();
    private process?: ChildProcess;
    private readonly waiting: ((line: string) => void)[] = [];
    private systemUserId?: Promise<number>;

    // The database is only needed to compile journal styles.
    constructor(private readonly db?: Databases) {}

    // Layers must be in run order, so each parent is compiled before its children.
    async compile(layers: readonly LayerRef[]): Promise<CompiledLayer[]> {
        const systemUserId = await (this.systemUserId ??= this.db!.global("SELECT userid FROM user WHERE user = 'system'")
            .then(rows => int(rows[0]?.userid)));
        const keys = new Map(layers.map(layer => [layer.id, `${layer.id}:${layer.sourceHash}`]));
        const compiled: CompiledLayer[] = [];
        for (const layer of layers) {
            const parentKey = keys.get(layer.parentId) ?? "";
            const key = `${keys.get(layer.id)}:${parentKey}`;
            let result = this.cache.get(key);
            if (!result) {
                result = this.compileLayer(layer, keys.get(layer.id)!, parentKey, layer.ownerId !== systemUserId);
                this.cache.set(key, result);
                result.catch(() => this.cache.delete(key));
            }
            compiled.push(await result);
        }
        return compiled;
    }

    close(): void {
        this.process?.kill();
    }

    // Compile one layer's source. `key` names the layer for its children's
    // parentKey; a core layer has no parent.
    async compileSource(layer: { key: string; parentKey?: string; type: string; untrusted: boolean;
        variable: string; source: string }): Promise<string> {
        const response = JSON.parse(await this.request(JSON.stringify({ parentKey: "", ...layer }))) as
            { code?: string; error?: string };
        if (response.error !== undefined) throw new Error(response.error);
        return response.code!;
    }

    private async compileLayer(layer: LayerRef, key: string, parentKey: string, untrusted: boolean): Promise<CompiledLayer> {
        const rows = await this.db!.global("SELECT s2code FROM s2source_inno WHERE s2lid = ?", [layer.id]);
        const variable = `layer_${layer.id}`;
        try {
            const code = await this.compileSource({
                key, parentKey, type: layer.type, untrusted, variable, source: text(rows[0]?.s2code),
            });
            return { id: layer.id, type: layer.type, variable, code };
        } catch (error) {
            throw new Error(`S2 layer ${layer.id}: ${(error as Error).message}`);
        }
    }

    // Requests are answered in order, one line each.
    private request(line: string): Promise<string> {
        if (!this.process) {
            const child = spawn("perl", [SERVER], { stdio: ["pipe", "pipe", "inherit"] });
            createInterface({ input: child.stdout! }).on("line", response => this.waiting.shift()?.(response));
            // The checkers go with the process, so compiled parents must be redone.
            child.on("exit", () => {
                this.process = undefined;
                this.cache.clear();
                for (const reject of this.waiting.splice(0)) reject(JSON.stringify({ error: "compiler exited" }));
            });
            this.process = child;
        }
        return new Promise(resolve => {
            this.waiting.push(resolve);
            this.process!.stdin!.write(line + "\n");
        });
    }
}
