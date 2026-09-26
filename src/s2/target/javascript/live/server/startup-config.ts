// startup-config.ts
//
// Private file and CLI boundary for standalone journal startup.
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

import { constants, closeSync, fstatSync, openSync, readSync } from "node:fs";
import path from "node:path";
import type { StandaloneStartupConfig } from "../startup-types";

export class StartupConfigError extends Error {
    constructor(message = "Invalid private startup configuration") { super(message); }
}

function invalid(): never { throw new StartupConfigError(); }
function record(value: unknown, keys?: readonly string[]): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
    const result = value as Record<string, unknown>;
    if (keys && (Object.keys(result).length !== keys.length ||
        keys.some(key => !Object.hasOwn(result, key)))) invalid();
    return result;
}
function text(value: unknown, max = 4096): string {
    if (typeof value !== "string" || value.length > max || value.includes("\0")) invalid();
    return value;
}
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) invalid();
    return value;
}
function boolean(value: unknown): void { if (typeof value !== "boolean") invalid(); }
function list(value: unknown, check: (item: unknown) => unknown): void {
    if (!Array.isArray(value) || value.length > 4096) invalid();
    for (const item of value) check(item);
}
function map(value: unknown, check: (item: unknown) => unknown): void {
    const fields = record(value);
    if (Object.keys(fields).length > 4096) invalid();
    for (const [key, item] of Object.entries(fields)) { text(key, 256); check(item); }
}
function nullable(value: unknown, check: (item: unknown) => unknown): void {
    if (value !== null) check(value);
}
function origin(value: unknown): void {
    const input = text(value);
    let url;
    try { url = new URL(input); } catch { invalid(); }
    if (!url || !["http:", "https:"].includes(url.protocol) || url.origin !== input ||
        url.username || url.password || url.pathname !== "/" || url.search || url.hash) invalid();
}

// This validates the private document's shape. Public renderer policy and primary
// role/topology decisions remain in their owning policy/data boundaries.
export function validateStartupConfig(value: unknown): StandaloneStartupConfig {
    const root = record(value, ["schema", "listener", "artifactPath", "app", "placeholder",
        "database", "capabilities", "styles"]);
    if (root.schema !== 1) invalid();
    const listener = record(root.listener, ["host", "port"]);
    const host = text(listener.host, 253);
    if (!host || /[\s/\\?#@]/.test(host)) invalid();
    integer(listener.port, 1, 65535);
    if (!text(root.artifactPath)) invalid();
    const app = record(root.app, ["entryContent", "canonicalAppOrigin", "listenOrigin", "siteRoot",
        "statPrefix", "jsPrefix", "userDomain", "journalUrls", "usernameMaxLength", "maxScrollback",
        "imgPrefix", "palImgRoot", "userpicRoot", "userpicUrlHookConfigured", "tagsEnabled", "tagListHookConfigured", "siteName", "siteNameShort", "siteNameAbbrev",
        "appleTouchIcon", "facebookPreviewIcon"]);
    origin(app.canonicalAppOrigin); origin(app.listenOrigin); boolean(app.userpicUrlHookConfigured); boolean(app.tagsEnabled); boolean(app.tagListHookConfigured);
    for (const key of ["siteRoot", "statPrefix", "jsPrefix", "userDomain", "imgPrefix", "palImgRoot",
        "userpicRoot", "siteName", "siteNameShort", "siteNameAbbrev", "appleTouchIcon", "facebookPreviewIcon"]) {
        text(app[key]);
    }
    integer(app.usernameMaxLength, 1, 255); integer(app.maxScrollback, 1);
    const urls = record(record(app.entryContent, ["urls"]).urls,
        ["siteDomain", "knownHttpsSites", "formDomainBanned", "imageProxy"]);
    text(urls.siteDomain);
    list(urls.knownHttpsSites, item => text(item, 320));
    list(urls.formDomainBanned, item => text(item, 320));
    if (urls.imageProxy !== "not-configured") invalid();
    const journal = record(app.journalUrls, ["protocol", "domain", "isDevServer", "subdomainRules",
        "hookConfigured"]);
    if (journal.protocol !== "http" && journal.protocol !== "https") invalid();
    text(journal.domain); boolean(journal.isDevServer); boolean(journal.hookConfigured);
    map(journal.subdomainRules, item => {
        if (!Array.isArray(item) || item.length !== 2) invalid();
        boolean(item[0]); text(item[1]);
    });
    const placeholder = record(root.placeholder,
        ["descriptor", "defaultLang", "isDevServer", "languageFiles"]);
    const image = record(placeholder.descriptor, ["src", "width", "height", "altKey"]);
    text(image.src); text(image.altKey); integer(image.width, 1); integer(image.height, 1);
    text(placeholder.defaultLang, 128); boolean(placeholder.isDevServer);
    list(placeholder.languageFiles, item => { if (!text(item)) invalid(); });
    const db = record(root.database, ["defaultDatabase", "sources", "clusters", "clusterPairActive"]);
    text(db.defaultDatabase, 256);
    list(db.sources, item => {
        const source = record(item, ["id", "host", "port", "socketPath", "database", "user", "password", "roles"]);
        for (const key of ["id", "database", "user"]) text(source[key], 256);
        text(source.password);
        nullable(source.host, item => text(item, 253));
        nullable(source.port, item => integer(item, 1, 65535));
        nullable(source.socketPath, item => text(item));
        map(source.roles, item => { if (typeof item !== "number" || !Number.isFinite(item)) invalid(); });
    });
    list(db.clusters, item => integer(item, 1));
    map(db.clusterPairActive, item => { if (item !== "a" && item !== "b") invalid(); });
    const caps = record(root.capabilities, ["moveInProgressMask", "s2ViewEntry"]);
    integer(caps.moveInProgressMask, 0, 4294967295);
    const entry = record(caps.s2ViewEntry, ["defaultValue", "byBit", "hookConfigured"]);
    nullable(entry.defaultValue, item => integer(item, Number.MIN_SAFE_INTEGER)); boolean(entry.hookConfigured);
    list(entry.byBit, item => {
        const bit = record(item, ["bit", "value"]);
        integer(bit.bit, 0, 31); integer(bit.value, Number.MIN_SAFE_INTEGER);
    });
    const styles = record(root.styles, ["defaultStyle", "layerRemap"]);
    map(styles.defaultStyle, item => text(item));
    map(styles.layerRemap, item => integer(item, 1));
    return value as StandaloneStartupConfig;
}

export function parseStartupArgs(args: readonly string[]): string {
    if (args.length !== 2 || args[0] !== "--config" || !args[1]) {
        throw new StartupConfigError("Usage: main --config <private-json-file>");
    }
    return path.resolve(args[1]);
}

export function readStartupConfig(file: string): StandaloneStartupConfig {
    let fd: number | undefined;
    try {
        fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.size > 65536 || (stat.mode & 0o077) ||
            (process.getuid && stat.uid !== process.getuid())) {
            throw new StartupConfigError("Startup config must be a private owned regular file (mode 0600)");
        }
        const bytes = Buffer.alloc(65537);
        let length = 0;
        for (;;) {
            const count = readSync(fd, bytes, length, bytes.length - length, null);
            length += count;
            if (length > 65536) throw new StartupConfigError("Startup config exceeds 64KiB");
            if (!count) break;
        }
        const json = new TextDecoder("utf-8", {fatal: true}).decode(bytes.subarray(0, length));
        const config = validateStartupConfig(JSON.parse(json) as unknown);
        const base = path.dirname(path.resolve(file));
        return {...config, artifactPath: path.resolve(base, config.artifactPath),
            placeholder: {...config.placeholder, languageFiles:
                config.placeholder.languageFiles.map(item => path.resolve(base, item))}};
    } catch (error) {
        if (error instanceof StartupConfigError) throw error;
        throw new StartupConfigError("Cannot read private startup config; check file, permissions and JSON");
    } finally { if (fd !== undefined) closeSync(fd); }
}
