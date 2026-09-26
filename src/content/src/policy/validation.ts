// validation.ts
//
// Explicit input/context and resource limits for isolated entry cleaning.
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
import type {CleanerLimits, EntryContentInput, EntryMetadataInput} from "../contracts";
import {UnsupportedContent} from "./errors";

function record(value: unknown, names: readonly string[]): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
        Object.keys(value).length !== names.length ||
        names.some(name => !Object.prototype.hasOwnProperty.call(value, name))) {
        throw new UnsupportedContent();
    }
    return value as Record<string, unknown>;
}
function text(value: unknown, maxBytes: number): asserts value is string {
    // Bound code units before allocating a UTF8 encoding of an untrusted string.
    if (typeof value !== "string" || value.length > maxBytes ||
        Buffer.byteLength(value) > maxBytes ||
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) {
        throw new UnsupportedContent();
    }
}
function integer(value: unknown, min: number, max: number): asserts value is number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
        throw new UnsupportedContent();
    }
}
function boolean(value: unknown): void {
    if (typeof value !== "boolean") throw new UnsupportedContent();
}
function publicUrl(value: unknown): void {
    text(value, 4096);
    if (/[\x00-\x20\\]/.test(value)) throw new UnsupportedContent();
    try {
        const url = new URL(value);
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) {
            throw new UnsupportedContent();
        }
    } catch { throw new UnsupportedContent(); }
}
// Source configuration keys are exact bytes, not normalized hostnames.
// Form lookup lowercases its operand; image https_url compares captured case.
function hosts(value: unknown): void {
    if (!Array.isArray(value) || value.length > 4096) throw new UnsupportedContent();
    for (const [index, host] of value.entries()) {
        text(host, 320);
        if (!host || /[\s%@/?#\\]/.test(host) ||
            (index > 0 && value[index - 1] >= host)) throw new UnsupportedContent();
        try {
            const url = new URL("http://" + host + "/");
            if (!url.hostname || url.username || url.password) throw new UnsupportedContent();
        } catch { throw new UnsupportedContent(); }
    }
}

export function validateCleanerLimits(value: CleanerLimits): void {
    const limits = record(value, ["maxInputBytes", "maxOutputBytes", "maxNodes", "maxDepth",
        "maxCssBytes", "maxCssNodes", "maxImageCandidates", "maxCuts"]);
    const caps: Readonly<Record<keyof CleanerLimits, number>> = {
        maxInputBytes: 65536, maxOutputBytes: 2097152, maxNodes: 4096, maxDepth: 16,
        maxCssBytes: 65536, maxCssNodes: 4096, maxImageCandidates: 256, maxCuts: 16,
    };
    for (const key of Object.keys(caps) as (keyof CleanerLimits)[]) {
        integer(limits[key], 1, caps[key]);
    }
}

export function validateInput(value: EntryContentInput, limits: CleanerLimits): void {
    const input = record(value, ["body", "format", "context"]);
    text(input.body, limits.maxInputBytes);
    if (input.format !== "html_raw0") throw new UnsupportedContent();
    const context = record(input.context, ["policy", "insertionContext", "documentUrl", "entryUrl",
        "journalUsername", "journalId", "entryId", "reader", "imagePlaceholder", "cuts", "urls"]);
    if (context.policy !== "dreamwidth-entry-html-raw0-v1" ||
        context.insertionContext !== "html-div-flow" ||
        context.cuts !== "source-compatible-recent" && context.cuts !== "source-compatible-entry") {
        throw new UnsupportedContent();
    }
    publicUrl(context.documentUrl);
    publicUrl(context.entryUrl);
    text(context.journalUsername, 25);
    if (!/^[a-z0-9_]{1,25}$/.test(context.journalUsername)) throw new UnsupportedContent();
    integer(context.journalId, 1, Number.MAX_SAFE_INTEGER);
    integer(context.entryId, 1, Number.MAX_SAFE_INTEGER);
    const reader = record(context.reader, ["removeColors", "removeSizes", "removeFonts",
        "maxImageWidth", "maxImageHeight", "placeholderUndefinedImageSize", "extractImages"]);
    for (const name of ["removeColors", "removeSizes", "removeFonts",
        "placeholderUndefinedImageSize", "extractImages"]) boolean(reader[name]);
    for (const name of ["maxImageWidth", "maxImageHeight"]) {
        if (reader[name] !== null) integer(reader[name], 0, 65535);
    }
    const placeholder = record(context.imagePlaceholder, ["src", "width", "height", "alt", "title"]);
    text(placeholder.src, 4096);
    if (!placeholder.src || /[\x00-\x20\\]/.test(placeholder.src)) throw new UnsupportedContent();
    try {
        const url = new URL(placeholder.src, context.documentUrl as string);
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
            throw new UnsupportedContent();
        }
    } catch { throw new UnsupportedContent(); }
    for (const name of ["width", "height"]) integer(placeholder[name], 1, 65535);
    for (const name of ["alt", "title"]) text(placeholder[name], 1024);
    const urls = record(context.urls, ["siteDomain", "knownHttpsSites", "formDomainBanned", "imageProxy"]);
    text(urls.siteDomain, 320);
    if (urls.siteDomain !== "") hosts([urls.siteDomain]);
    hosts(urls.knownHttpsSites);
    hosts(urls.formDomainBanned);
    if (urls.imageProxy !== "not-configured" && urls.imageProxy !== "host-resolved") {
        throw new UnsupportedContent();
    }
}

export function validateMetadataInput(value: EntryMetadataInput, limits: CleanerLimits): void {
    const input = record(value, ["subject", "entry"]);
    text(input.subject, 1024);
    // Same existing plain-subject cohort; empty remains unsupported rather than
    // silently expanding to the broader source's no-subject fallback.
    if (!input.subject || /[<>"'\x00-\x1f\x7f]|&(?:#\w+|[A-Za-z][A-Za-z0-9]+);/.test(input.subject)) {
        throw new UnsupportedContent();
    }
    validateInput(input.entry as EntryContentInput, limits);
    if ((input.entry as EntryContentInput).context.cuts !== "source-compatible-entry") {
        throw new UnsupportedContent();
    }
    if (/^[\t\n\v\f\r ]*!markdown[\t\n\v\f\r ]*\r?\n/i.test((input.entry as EntryContentInput).body)) {
        throw new UnsupportedContent();
    }
}

// Canonical JSON for the validated finite record: sorted own keys, ordered arrays,
// ordinary JSON string escaping, no whitespace, UTF8 SHA256. Hashing grants no
// authority: the host independently verifies image source spans against its copy.
export function inputHash(input: EntryContentInput): string {
    function canonical(value: unknown): string {
        if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
        if (value && typeof value === "object") {
            const item = value as Record<string, unknown>;
            return "{" + Object.keys(item).sort().map(key =>
                JSON.stringify(key) + ":" + canonical(item[key])).join(",") + "}";
        }
        return JSON.stringify(value);
    }
    return createHash("sha256").update(canonical(input), "utf8").digest("hex");
}
