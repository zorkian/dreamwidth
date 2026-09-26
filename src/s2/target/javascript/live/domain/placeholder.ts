// placeholder.ts
//
// Resolve one startup image label with retained language-file precedence.
//
// Portions adapted from LJ::Lang and LJ::LangDatFile, forked from the
// LiveJournal project owned and operated by Live Journal, Inc., and modified
// and expanded by Dreamwidth Studios, LLC. The original license is available at:
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
// In accordance with that license, this code and its modifications are provided
// under the GNU General Public License. See LICENSE in this distribution.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//

import {closeSync, constants, fstatSync, openSync, readSync} from "node:fs";
import {sql, type Kysely} from "kysely";
import type {PlaceholderResolutionSpec} from "../contracts";
import {SnapshotError} from "../data/errors";
import {decodeLegacyText} from "../data/legacy-text";
import {decodeNativeEntities} from "./native-entities";

const maxFileBytes = 16 * 1024 * 1024;
function unsupported(): never { throw new SnapshotError("unsupported"); }
function truth(value: string | null): boolean { return value !== null && value !== "" && value !== "0"; }
function missing(value: string | null): boolean {
    return value === null || value === "" || value.startsWith("[missing string") || value.startsWith("[uhhh:");
}

// LangDatFile.pm reads raw LF-delimited lines, with dot-stuffed multiline values.
// Preserve its ordered overwrites and metadata suffix handling; do not normalize CRLF.
export function placeholderFileValue(source: string, key: string): string | null {
    const values = new Map<string, string>();
    const lines = source.match(/[^\n]*\n|[^\n]+$/g) ?? [];
    let code = "", text = "";
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index]!;
        if (/^[#;]/.test(line)) continue;
        let action = false;
        const single = /^(\S+?)=([^\n]*)/.exec(line);
        const multi = /^(\S+?)<<\s*$/.exec(line);
        if (single) { code = single[1]!; text = single[2]!; action = true; }
        else if (/^!\s*\S+/.test(line)) {
            // Native deletion syntax retains the previous code/text in parse().
            action = true;
        } else if (multi) {
            code = multi[1]!; text = "";
            while (++index < lines.length) {
                let next = lines[index]!;
                if (next === ".\n") break;
                next = next.replace(/^\./, ""); text += next;
            }
            if (text.endsWith("\n")) text = text.slice(0, -1);
            action = true;
        } else if (/\S/.test(line)) unsupported();
        if (code.includes("|")) { code = code.replace(/\|([^\n]+)/, ""); action = true; }
        if (action) values.set(code.toLowerCase(), text);
    }
    return values.get(key.toLowerCase()) ?? null;
}

function fileValue(file: string, key: string): {value: string | null; modified: number} | null {
    let fd: number;
    try { fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw new SnapshotError("unavailable");
    }
    try {
        const info = fstatSync(fd);
        if (!info.isFile() || info.size > maxFileBytes) unsupported();
        const bytes = Buffer.alloc(maxFileBytes + 1);
        let size = 0, count: number;
        do { count = readSync(fd, bytes, size, bytes.length - size, null); size += count; }
        while (count > 0 && size < bytes.length);
        if (size > maxFileBytes) unsupported();
        let source: string;
        try { source = new TextDecoder("utf-8", {fatal: true, ignoreBOM: true}).decode(bytes.subarray(0, size)); }
        catch { unsupported(); }
        return {value: placeholderFileValue(source, key), modified: Math.floor(info.mtimeMs / 1000)};
    } finally { closeSync(fd); }
}

// dbText and changedSeconds come from one SELECT-only startup read, dmid=1.
// The native helper's visible UPDATE and fallback persistence are deliberately absent.
export function resolvePlaceholderValue(spec: PlaceholderResolutionSpec, dbText: string | null,
    changedSeconds: number): {readonly alt: string; readonly title: string} {
    const key = spec.descriptor.altKey;
    if (typeof key !== "string" || !key || Buffer.byteLength(key) > 120 ||
        typeof spec.defaultLang !== "string" || !spec.defaultLang ||
        !Number.isSafeInteger(changedSeconds) || changedSeconds < 0 ||
        spec.languageFiles.length > 2 || spec.languageFiles.some(file => typeof file !== "string" || !file)) unsupported();
    if (dbText !== null && (typeof dbText !== "string" || Buffer.byteLength(dbText) > 65536)) unsupported();
    const fromFiles = (): string | null => {
        for (const file of spec.languageFiles) {
            const loaded = fileValue(file, key);
            if (!loaded) continue;
            if (!loaded.modified || changedSeconds > loaded.modified) return dbText;
            if (truth(loaded.value)) return loaded.value;
        }
        return `[missing string ${key}]`;
    };
    let value = spec.isDevServer ? fromFiles() : dbText;
    if (!spec.isDevServer && missing(value)) {
        const fallback = fromFiles();
        if (!missing(fallback)) value = fallback;
    }
    if (!truth(value)) value = spec.isDevServer ? `[uhhh: ${key}]` : "";
    if (missing(value)) value = key;
    if (value === null) unsupported();
    // Web.pm inserts this value literally into double-quoted attributes. Refuse
    // malformed source quotes before scalar entity decoding, as the native probe shows.
    if (value.includes('"') || Buffer.byteLength(value) > 1024 ||
        /[\x00-\x08\x0b-\x1f\x7f]/.test(value)) unsupported();
    const projected = decodeNativeEntities(value);
    if (Buffer.byteLength(projected) > 1024 || /[\x00-\x08\x0b-\x1f\x7f]/.test(projected) ||
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(projected)) unsupported();
    return Object.freeze({alt: projected, title: projected});
}


// These public language tables can be MyISAM. The store invokes this only at
// startup via the session-READ-ONLY primary helper with an empty table list.
// No consistent InnoDB snapshot, request authorization or fingerprint is claimed.
export async function resolvePlaceholder(connection: Kysely<Record<string, never>>,
    spec: PlaceholderResolutionSpec): Promise<{readonly alt: string; readonly title: string}> {
    try {
        if (!/^[A-Za-z0-9_-]{1,16}$/.test(spec.defaultLang) ||
            !/^[A-Za-z0-9_.-]{1,120}$/.test(spec.descriptor.altKey)) unsupported();
        const domains = (await sql<Record<string, unknown>>`
            SELECT dmid FROM ml_domains
            WHERE BINARY type = BINARY 'general' AND (args = '' OR args = '0') LIMIT 2
        `.execute(connection)).rows;
        if (domains.length !== 1) unsupported();
        const languages = (await sql<Record<string, unknown>>`
            SELECT lnid FROM ml_langs WHERE BINARY lncode = BINARY ${spec.defaultLang} LIMIT 2
        `.execute(connection)).rows;
        if (languages.length !== 1) unsupported();
        const lnid = languages[0]!.lnid;
        if (typeof lnid !== "number" || !Number.isSafeInteger(lnid) || lnid < 1 || lnid > 65535) unsupported();
        // ml() supplies undef dmid; both native text and change-time reads use 1,
        // independently of the named general domain used for file-fallback logic.
        const rows = (await sql<Record<string, unknown>>`
            SELECT CAST(l.chgtime AS CHAR) AS chgtime,
                HEX(t.text) AS stored_hex,
                HEX(CONVERT(t.text USING latin1)) AS recovered_hex,
                HEX(CONVERT(CONVERT(t.text USING latin1) USING utf8mb4)) AS roundtrip_hex
            FROM ml_items i
            LEFT JOIN ml_latest l ON l.dmid = i.dmid AND l.itid = i.itid AND l.lnid = ${lnid}
            LEFT JOIN ml_text t ON t.dmid = 1 AND t.txtid = l.txtid
            WHERE i.dmid = 1 AND i.itcode = ${spec.descriptor.altKey.toLowerCase()} LIMIT 2
        `.execute(connection)).rows;
        if (rows.length > 1) unsupported();
        const row = rows[0];
        let text: string | null = null, changed = 0;
        if (row?.stored_hex !== null && row?.stored_hex !== undefined) {
            text = decodeLegacyText(row.stored_hex, row.recovered_hex, row.roundtrip_hex, 262144, 65536, false).text;
        }
        if (row?.chgtime && row.chgtime !== "0000-00-00 00:00:00") {
            if (typeof row.chgtime !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(row.chgtime)) unsupported();
            const [year, month, day, hour, minute, second] = row.chgtime.match(/\d+/g)!.map(Number);
            const date = new Date(year!, month! - 1, day!, hour!, minute!, second!);
            if (date.getFullYear() !== year || date.getMonth() !== month! - 1 || date.getDate() !== day ||
                date.getHours() !== hour || date.getMinutes() !== minute || date.getSeconds() !== second) unsupported();
            changed = Math.floor(date.getTime() / 1000);
        }
        return resolvePlaceholderValue(spec, text, changed);
    } catch (error) {
        if (error instanceof SnapshotError) throw error;
        throw new SnapshotError("unavailable");
    }
}
