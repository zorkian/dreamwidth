// manifest.ts
//
// Verify the closed runtime staged beside a stock artifact before child launch.
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

import {createHash} from "node:crypto";
import {lstatSync, readFileSync, readdirSync, realpathSync, type Stats} from "node:fs";
import {resolve, join, posix} from "node:path";
import {Unsupported} from "../policy/content";

const nodePath = "/opt/dw-node24/bin/node";
// Independently pinned by the signed Node24 bootstrap; manifest cannot authorize
// a different executable or self-declare an expected executable digest.
const nodeSha256 = "7fde7b8afa198da66257f42ee2001d874c7355631e6d1579a5fb5ef1f246df4c";
function digest(path: string): string {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
}
function object(value: unknown, names: readonly string[]): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        Object.keys(value).length !== names.length ||
        names.some(name => !Object.prototype.hasOwnProperty.call(value, name))) throw new Unsupported();
    return value as Record<string, unknown>;
}

export interface VerifiedRuntime { readonly root: string; readonly entry: string; readonly node: string }
export function verifyRuntime(artifactPath: string): VerifiedRuntime {
    const root = resolve(artifactPath + ".runtime");
    if (realpathSync(root) !== root) throw new Unsupported();
    const rootStat = lstatSync(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || (rootStat.mode & 0o777) !== 0o555 ||
        ![0, process.getuid?.()].includes(rootStat.uid)) throw new Unsupported();
    const checkFile = (path: string): Stats => {
        const stat = lstatSync(path);
        if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o444 || stat.uid !== rootStat.uid ||
            stat.size > 33554432) throw new Unsupported();
        return stat;
    };
    const manifestPath = join(root, "manifest.json");
    if (checkFile(manifestPath).size > 4194304) throw new Unsupported();
    const raw = object(JSON.parse(readFileSync(manifestPath, "utf8")), ["schema", "artifactSha256",
        "contentLockSha256", "nodeVersion", "nodeExecutable", "entryPath", "files"]);
    if (raw.schema !== 1 || raw.nodeVersion !== "24.21.0" || raw.nodeExecutable !== nodePath ||
        raw.entryPath !== "app/dist/live/render/worker.js" || raw.artifactSha256 !== digest(artifactPath) ||
        raw.contentLockSha256 !== digest(resolve(__dirname, "../../../../../../content/package-lock.json")) ||
        !Array.isArray(raw.files) || raw.files.length === 0 || raw.files.length > 10000) {
        throw new Unsupported();
    }
    for (const path of ["/opt", "/opt/dw-node24", "/opt/dw-node24/bin", nodePath]) {
        const stat = lstatSync(path);
        if (stat.isSymbolicLink() || stat.uid !== 0 || stat.mode & 0o022 ||
            (path === nodePath ? !stat.isFile() : !stat.isDirectory())) throw new Unsupported();
    }
    if (digest(nodePath) !== nodeSha256) throw new Unsupported();
    const listed = new Set<string>();
    let total = 0;
    for (const entry of raw.files) {
        const file = object(entry, ["path", "sha256", "bytes"]);
        if (typeof file.path !== "string" || file.path.length > 1024 ||
            file.path !== posix.normalize(file.path) || file.path.startsWith("/") ||
            file.path.split("/").some(part => !part || part === "." || part === "..") ||
            /[\\\x00-\x1f]/.test(file.path) || file.path.endsWith(".node") || listed.has(file.path) ||
            typeof file.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(file.sha256) ||
            typeof file.bytes !== "number" || !Number.isSafeInteger(file.bytes) || file.bytes < 0 ||
            !(file.path.startsWith("app/dist/live/render/") || file.path.startsWith("app/dist/live/policy/") ||
                file.path === "app/dist/runtime/s2runtime.js" || file.path === "app/package.json" ||
                file.path.startsWith("app/node_modules/")) ||
            /(?:^|\/)(?:playwright(?:-core)?|@playwright|canvas|typescript)(?:\/|$)/.test(file.path)) {
            throw new Unsupported();
        }
        const path = join(root, file.path);
        if (realpathSync(path) !== path || checkFile(path).size !== file.bytes || digest(path) !== file.sha256) {
            throw new Unsupported();
        }
        total += file.bytes;
        if (total > 134217728) throw new Unsupported();
        listed.add(file.path);
    }
    let actual = 0;
    let directories = 0;
    const scan = (directory: string, depth = 0): void => {
        if (++directories > 10000 || depth > 64) throw new Unsupported();
        for (const name of readdirSync(join(root, directory))) {
            const relative = directory ? directory + "/" + name : name;
            const path = join(root, relative);
            const stat = lstatSync(path);
            if (stat.isSymbolicLink() || stat.uid !== rootStat.uid) throw new Unsupported();
            if (stat.isDirectory()) {
                if ((stat.mode & 0o777) !== 0o555) throw new Unsupported();
                scan(relative, depth + 1);
            }
            else if (relative !== "manifest.json") {
                if (!stat.isFile() || (stat.mode & 0o777) !== 0o444 || !listed.has(relative)) throw new Unsupported();
                actual++;
            }
        }
    };
    scan("");
    if (actual !== listed.size || !listed.has(raw.entryPath)) throw new Unsupported();
    // All authority comes from the derived root and verified local bootstrap.
    // This is a trusted offline build closure, not protection against its owner
    // rewriting files concurrently. The child itself has no write permission.
    return Object.freeze({root, entry: join(root, raw.entryPath), node: nodePath});
}
