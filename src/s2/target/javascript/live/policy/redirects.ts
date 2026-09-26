// redirects.ts
//
// Pure finite anonymous request and retained-app navigation admission.
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

import type { CreateRedirectAdmission, RedirectAdmissionDecision } from "../contracts";
import { validateConfig } from "./config";
import { parseUniqCookie } from "./token";
import { canonicalUsername } from "./cohort";
import { validEntryId } from "./entry";

const REJECT: RedirectAdmissionDecision = Object.freeze({ kind: "reject" });
const GET_PATHS = new Set(["/", "/support/faq", "/interface/atom", "/openid/server", "/lostinfo", "/create"]);

function datePath(path: string): boolean {
    const match = /^\/(\d{4})\/(?:(\d{2})\/(?:(\d{2})\/)?)?$/.exec(path);
    if (!match) return false;
    const y = Number(match[1]), m = Number(match[2] ?? 1), d = Number(match[3] ?? 1);
    const date = new Date(Date.UTC(y, m - 1, d));
    return y >= 1000 && y <= 9999 && date.getUTCFullYear() === y &&
        date.getUTCMonth() + 1 === m && date.getUTCDate() === d;
}
function asset(target: string, prefixes: readonly [string, "css" | "js" | null][]): boolean {
    // Resource paths are relative to the configured source prefixes. Absolute
    // resource URLs leave the private listener directly and need no redirect.
    const file = /^(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:css|js|png|gif|jpg|svg|woff2?)$/;
    for (const [prefix, extension] of prefixes) {
        if (!prefix.startsWith("/") || prefix.startsWith("//")) continue;
        const start = prefix.replace(/\/$/, "") + "/";
        if (!target.startsWith(start)) continue;
        const rest = target.slice(start.length);
        const combo = /^\?\?([^?]+)\?v=([1-9][0-9]{0,10})$/.exec(rest);
        if (combo && extension && combo[1]!.length < 4096 && combo[1]!.split(",").every(name =>
            file.test(name) && !name.includes("..") && name.endsWith("." + extension))) return true;
        const single = /^([^?]+)(?:\?v=([1-9][0-9]{0,10}))?$/.exec(rest);
        if (single && file.test(single[1]!) && !single[1]!.includes("..")) return true;
    }
    return false;
}

// Inventory: the retained anonymous stock core2/Tabula Rasa recent page emits
// these controls/resources, including both login and multisearch POST forms.
// This admits navigation only; it never obtains app output.
export const createRedirectAdmission: CreateRedirectAdmission = config => {
    validateConfig(config);
    const expectedHost = new URL(config.listenOrigin).host;
    const canonical = (name: string): boolean => canonicalUsername(name, config.usernameMaxLength) === name;
    const page = (raw: string): {username: string; kind: "recent"; skip: number; skipPresent: boolean} |
        {username: string; kind: "entry"; ditemid: number} | null => {
        const recent = /^\/users\/([a-z0-9_]{1,25})\/(?:\?skip=(0|[1-9][0-9]{0,15}))?$/.exec(raw);
        if (recent && canonical(recent[1]!)) {
            const skip = Number(recent[2] ?? 0);
            return Number.isSafeInteger(skip) ? {kind: "recent", username: recent[1]!, skip,
                skipPresent: recent[2] !== undefined} : null;
        }
        const entry = /^\/users\/([a-z0-9_]{1,25})\/([1-9][0-9]{0,9})\.html$/.exec(raw);
        return entry && canonical(entry[1]!) && validEntryId(Number(entry[2])) ?
            {kind: "entry", username: entry[1]!, ditemid: Number(entry[2])} : null;
    };
    const controlRoot = config.siteRoot.startsWith("/") && !config.siteRoot.startsWith("//") ?
        config.siteRoot.replace(/\/$/, "") : "";
    const prefixes: readonly [string, "css" | "js" | null][] = [
        [config.statPrefix, "css"], [config.jsPrefix, "js"], [config.imgPrefix, null],
    ];
    return request => {
        try {
            if (request.host !== expectedHost || request.hasAuthorization || request.hasForwardedHeaders ||
                !["GET", "HEAD", "POST"].includes(request.method)) return REJECT;
            const uniqCookie = parseUniqCookie(request.cookieHeader);
            const raw = request.rawTarget;
            if (typeof raw !== "string" || raw.length > 8192 || !raw.startsWith("/") ||
                /[\\#\x00-\x20\x7f]/.test(raw) || raw.startsWith("//")) return REJECT;
            const selected = page(raw);
            if (selected && request.method !== "POST") {
                if (request.origin !== null && request.origin !== config.listenOrigin) return REJECT;
                const method = request.method as "GET" | "HEAD";
                return selected.kind === "recent" ? {kind: "recent", request: {method,
                    username: selected.username, skip: selected.skip, skipPresent: selected.skipPresent, uniqCookie}} :
                    {kind: "entry", request: {method, username: selected.username, ditemid: selected.ditemid, uniqCookie}};
            }
            const control = raw.startsWith(controlRoot + "/") ? raw.slice(controlRoot.length) : null;
            if (request.method === "POST") {
                if ((control !== "/login" && control !== "/multisearch") ||
                    request.origin !== config.listenOrigin) return REJECT;
            } else {
                if (request.origin !== null && request.origin !== config.listenOrigin) return REJECT;
                const item = control && /^\/tools\/(memadd|tellafriend)\?journal=([a-z0-9_]{1,25})&itemid=([1-9][0-9]{0,9})$/.exec(control);
                const safeItem = item && canonical(item[2]!) && validEntryId(Number(item[3]));
                const memories = control && /^\/tools\/memories\?user=([a-z0-9_]{1,25})$/.exec(control);
                const safeMemories = memories && canonical(memories[1]!);
                const returnto = control?.startsWith("/openid/?returnto=") ? control.slice("/openid/?returnto=".length) : "";
                const safeReturn = returnto.startsWith(config.canonicalAppOrigin + "/") &&
                    page(returnto.slice(config.canonicalAppOrigin.length)) !== null;
                const go = control && /^\/go\?dir=(prev|next)&itemid=([1-9][0-9]{0,9})&journal=([a-z0-9_]{1,25})(?:&redir_key=([^&]{1,4096}))?$/.exec(control);
                const safeGo = go && validEntryId(Number(go[2])) && canonical(go[3]!) &&
                    (go[4]===undefined || (()=>{
                        const key=decodeURIComponent(go[4]!);
                        return Buffer.byteLength(key)<=4096 && !/[\x00-\x1f\x7f]/.test(key) &&
                            encodeURIComponent(key)===go[4];
                    })());
                if (!(control && GET_PATHS.has(control)) && !safeMemories && !safeItem && !safeReturn && !safeGo &&
                    !datePath(raw) && !asset(raw, prefixes)) return REJECT;
            }
            return {kind: "redirect", status: 307, location: config.canonicalAppOrigin + raw};
        } catch {
            return REJECT;
        }
    };
};
