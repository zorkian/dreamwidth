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

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
        Object.keys(value).length !== keys.length ||
        keys.some(key => !Object.prototype.hasOwnProperty.call(value, key))) throw new Unsupported();
    return value as Record<string, unknown>;
}

function hostKey(value: unknown): value is string {
    if (typeof value !== "string" || !value || value.length > 320 ||
        value !== value.toLowerCase() || /[\s%@/?#\\]/.test(value)) return false;
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
    const origins = [config.listenOrigin, config.canonicalAppOrigin].map(value => {
        const url = new URL(value);
        if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
            !url.port || url.origin !== value || url.username || url.password) throw new Unsupported();
        return url;
    });
    if (origins[0]!.hostname !== origins[1]!.hostname || origins[0]!.port === origins[1]!.port ||
        config.anonymousCaptchaDisabled !== true) throw new Unsupported();
    for (const value of [config.siteRoot, config.statPrefix, config.imgPrefix, config.palImgRoot,
        config.userpicRoot, config.appleTouchIcon, config.facebookPreviewIcon]) {
        if (typeof value !== "string" || /[\x00-\x20"'<>\\]/.test(value) ||
            (value !== "" && !/^\/(?!\/)/.test(value) &&
             !value.startsWith(config.canonicalAppOrigin + "/") &&
             value !== config.canonicalAppOrigin)) throw new Unsupported();
    }
    for (const value of [config.siteName, config.siteNameShort, config.siteNameAbbrev]) {
        if (!value || value.length > 100 || /[<>"'&\x00-\x1f]/.test(value)) throw new Unsupported();
    }
    validateEntryConfig(config);
}
export function validateLimits(limits: RenderLimits): void {
    for (const [value, max] of [[limits.timeoutMs, 10000], [limits.maxOutputBytes, 2097152],
        [limits.maxHeapMiB, 128]]) {
        if (!Number.isSafeInteger(value) || value! <= 0 || value! > max!) throw new Unsupported();
    }
}
