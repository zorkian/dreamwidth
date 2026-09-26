// config.ts
//
// Bounded local S2 journal policy and rendering support.
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

import type { PublicAppConfig, RenderLimits } from "../contracts";
import { Unsupported } from "./content";

function exactRecord(value: unknown, keys?: readonly string[]): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
        keys && (Object.keys(value).length !== keys.length ||
        keys.some(key => !Object.prototype.hasOwnProperty.call(value, key)))) throw new Unsupported();
    return value as Record<string, unknown>;
}

function hostKey(value: unknown): value is string {
    if (typeof value !== "string" || !value || value.length > 320 ||
        /[\s%@/?#\\]/.test(value)) return false;
    try {
        const url = new URL("http://" + value + "/");
        return !!url.hostname && !url.username && !url.password && url.pathname === "/";
    } catch { return false; }
}

function hostList(value: unknown): void {
    if (!Array.isArray(value) || value.length > 4096 ||
        value.some((host: unknown, index: number) => !hostKey(host) ||
            (index > 0 && value[index - 1] >= host))) throw new Unsupported();
}

function validateEntryConfig(config: PublicAppConfig): void {
    const entry = exactRecord(config.entryContent, ["imagePlaceholder", "urls"]);
    const urls = exactRecord(entry.urls,
        ["siteDomain", "knownHttpsSites", "formDomainBanned", "imageProxy"]);
    if ((urls.siteDomain !== "" && !hostKey(urls.siteDomain)) ||
        urls.imageProxy !== "not-configured") throw new Unsupported();
    hostList(urls.knownHttpsSites);
    hostList(urls.formDomainBanned);
    const image = exactRecord(entry.imagePlaceholder, ["src", "width", "height", "alt", "title"]);
    if (typeof image.src !== "string" || !image.src || image.src.length > 4096 ||
        /[\x00-\x20"'<>\\]/.test(image.src) ||
        !image.src.startsWith(config.imgPrefix + "/")) throw new Unsupported();
    const resolved = new URL(image.src, config.canonicalAppOrigin);
    if (!["http:", "https:"].includes(resolved.protocol) || resolved.username || resolved.password) {
        throw new Unsupported();
    }
    if (!resolved.href.startsWith(new URL(config.imgPrefix + "/", config.canonicalAppOrigin).href)) {
        throw new Unsupported();
    }
    for (const dimension of [image.width, image.height]) {
        if (typeof dimension !== "number" || !Number.isSafeInteger(dimension) ||
            dimension <= 0 || dimension > 65535) throw new Unsupported();
    }
    for (const text of [image.alt, image.title]) {
        if (typeof text !== "string" || Buffer.byteLength(text) > 1024 ||
            /[\x00-\x08\x0b-\x1f\x7f]/.test(text) ||
            /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text)) {
            throw new Unsupported();
        }
    }
}

export function validateConfig(config: PublicAppConfig): void {
    exactRecord(config, ["entryContent", "canonicalAppOrigin", "listenOrigin", "siteRoot", "statPrefix",
        "jsPrefix", "userDomain", "journalUrls", "usernameMaxLength", "maxScrollback", "imgPrefix",
        "palImgRoot", "userpicRoot", "userpicUrlHookConfigured", "tagsEnabled", "tagListHookConfigured", "siteName", "siteNameShort", "siteNameAbbrev", "appleTouchIcon",
        "facebookPreviewIcon", ...(config.commentSettings === undefined ? [] : ["commentSettings"]),
        ...(config.headIconHookConfigured===undefined?[]:["headIconHookConfigured"])]);
    if(config.commentSettings!==undefined) {
        const c=exactRecord(config.commentSettings,["pageSize","threadPoint","maxSubjects"]);
        if(Object.values(c).some(n=>typeof n!=="number"||!Number.isSafeInteger(n)||n<1||n>10000))throw new Unsupported();
    }
    if(config.headIconHookConfigured!==undefined&&typeof config.headIconHookConfigured!=="boolean")throw new Unsupported();
    if ([config.userpicUrlHookConfigured,config.tagsEnabled,config.tagListHookConfigured].some(value=>typeof value !== "boolean")) throw new Unsupported();
    for (const value of [config.listenOrigin, config.canonicalAppOrigin]) {
        let url;
        try { url = new URL(value); } catch { throw new Unsupported(); }
        if (!["http:", "https:"].includes(url.protocol) || url.origin !== value ||
            url.username || url.password || url.search || url.hash) throw new Unsupported();
    }
    for (const value of [config.siteRoot, config.statPrefix, config.imgPrefix, config.palImgRoot,
        config.jsPrefix, config.userpicRoot, config.appleTouchIcon, config.facebookPreviewIcon]) {
        if (typeof value !== "string" || value.length > 4096 || /[\x00-\x20"'<>\\]/.test(value)) {
            throw new Unsupported();
        }
        if (!value) continue;
        if (!value.startsWith("/") && !/^https?:\/\//.test(value)) throw new Unsupported();
        let url;
        try { url = new URL(value, config.canonicalAppOrigin); } catch { throw new Unsupported(); }
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) {
            throw new Unsupported();
        }
    }
    for (const value of [config.siteName, config.siteNameShort, config.siteNameAbbrev]) {
        if (typeof value !== "string" || !value || value.length > 100 || /[<>"'&\x00-\x1f]/.test(value)) {
            throw new Unsupported();
        }
    }
    if ((config.userDomain !== "" && !hostKey(config.userDomain)) ||
        !Number.isSafeInteger(config.usernameMaxLength) || config.usernameMaxLength < 1 ||
        !Number.isSafeInteger(config.maxScrollback) ||
        config.maxScrollback < 1) throw new Unsupported();
    const journal = exactRecord(config.journalUrls,
        ["protocol", "domain", "isDevServer", "subdomainRules", "hookConfigured"]);
    if (!["http", "https"].includes(journal.protocol as string) ||
        (journal.domain !== "" && !hostKey(journal.domain)) ||
        typeof journal.isDevServer !== "boolean" || journal.hookConfigured !== false) throw new Unsupported();
    const rules = exactRecord(journal.subdomainRules);
    if (!Object.hasOwn(rules, "P") || Object.keys(rules).length > 64) throw new Unsupported();
    for (const [kind, rule] of Object.entries(rules)) {
        if (!/^[A-Z]$/.test(kind) || !Array.isArray(rule) || rule.length !== 2 ||
            typeof rule[0] !== "boolean" || typeof rule[1] !== "string" ||
            rule[1].length > 4096 || /[\x00-\x20"'<>\\?#@]/.test(rule[1])) throw new Unsupported();
        if (rule[0] && !journal.domain) throw new Unsupported();
        if (!rule[0] && !rule[1] && !journal.isDevServer) throw new Unsupported();
        if (rule[1]) {
            let url;
            try { url = new URL(journal.protocol + "://" + rule[1] + "/username"); }
            catch { throw new Unsupported(); }
            if (!url.hostname || url.username || url.password || url.hash || url.search) throw new Unsupported();
        }
    }
    validateEntryConfig(config);
}
export function validateLimits(limits: RenderLimits): void {
    for (const [value, max] of [[limits.timeoutMs, 10000], [limits.maxOutputBytes, 2097152],
        [limits.maxHeapMiB, 128]]) {
        if (!Number.isSafeInteger(value) || value! <= 0 || value! > max!) throw new Unsupported();
    }
}
