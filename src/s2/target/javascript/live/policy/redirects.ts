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
import { USERNAME } from "./cohort";
import { validEntryId } from "./entry";

const REJECT: RedirectAdmissionDecision = Object.freeze({ kind: "reject" });
const GET_PATHS = new Set(["/", "/support/faq", "/interface/atom", "/openid/server", "/lostinfo", "/create"]);

function datePath(path: string): boolean {
    const match = /^\/(\d{4})\/(?:(\d{2})\/(?:(\d{2})\/)?)?$/.exec(path);
    if (!match) return false;
    const y = Number(match[1]), m = Number(match[2] ?? 1), d = Number(match[3] ?? 1);
    const date = new Date(Date.UTC(y, m - 1, d));
    return y >= 1970 && y <= 2038 && date.getUTCFullYear() === y &&
        date.getUTCMonth() + 1 === m && date.getUTCDate() === d;
}
function asset(target: string): boolean {
    // Actual slice3 oracle emits only /stc, /img, /js. No palimg/userpic.
    // Combo URLs use ??file,file?v=mtime, not generic URL query parsing.
    const combo = /^\/(stc|js)\/\?\?([^?]+)\?v=([1-9][0-9]{0,10})$/.exec(target);
    const file = /^(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:css|js|png|gif|jpg|svg|woff2?)$/;
    if (combo) return combo[2]!.length < 4096 && combo[2]!.split(",").every(name =>
        file.test(name) && !name.includes("..") &&
        name.endsWith(combo[1] === "stc" ? ".css" : ".js"));
    const single = /^\/(stc|img|js)\/([^?]+)(?:\?v=([1-9][0-9]{0,10}))?$/.exec(target);
    return Boolean(single && file.test(single[2]!) && !single[2]!.includes(".."));
}

// Inventory: the retained anonymous stock core2/Tabula Rasa recent page emits
// these controls/resources, including both login and multisearch POST forms.
// This admits navigation only; it never obtains app output.
export const createRedirectAdmission: CreateRedirectAdmission = config => {
    validateConfig(config);
    const expectedHost = new URL(config.listenOrigin).host;
    const recent = "/users/" + USERNAME + "/";
    const originalRecent = config.canonicalAppOrigin + recent;
    const entryPath = (path: string): number | null => {
        const match = new RegExp("^" + recent + "([1-9][0-9]{0,9})\\.html$").exec(path);
        const id = match ? Number(match[1]) : 0;
        return validEntryId(id) ? id : null;
    };
    return request => {
        try {
            if (request.host !== expectedHost || request.hasAuthorization || request.hasForwardedHeaders ||
                !["GET", "HEAD", "POST"].includes(request.method)) return REJECT;
            const uniqCookie = parseUniqCookie(request.cookieHeader);
            const raw = request.rawTarget;
            if (typeof raw !== "string" || raw.length > 8192 || !raw.startsWith("/") ||
                /[\\#\x00-\x20\x7f]/.test(raw) || raw.startsWith("//")) return REJECT;
            const match = new RegExp("^" + recent + "(?:\\?skip=(0|[1-9][0-9]{0,2}))?$").exec(raw);
            if (match && request.method !== "POST") {
                const skip = Number(match[1] ?? 0);
                if (skip > 200 || (request.origin !== null && request.origin !== config.listenOrigin)) return REJECT;
                return {kind: "recent", request: {method: request.method as "GET" | "HEAD",
                    username: USERNAME, skip, skipPresent: match[1] !== undefined, uniqCookie}};
            }
            const ditemid = entryPath(raw);
            if (ditemid !== null && request.method !== "POST") {
                if (request.origin !== null && request.origin !== config.listenOrigin) return REJECT;
                return {kind: "entry", request: {method: request.method as "GET" | "HEAD",
                    username: USERNAME, ditemid, uniqCookie}};
            }
            if (request.method === "POST") {
                if ((raw !== "/login" && raw !== "/multisearch") ||
                    request.origin !== config.listenOrigin) return REJECT;
            } else {
                if (request.origin !== null && request.origin !== config.listenOrigin) return REJECT;
                const item = /^\/tools\/(memadd|tellafriend)\?journal=s2js_slice3&itemid=([1-9][0-9]{0,12})$/.exec(raw);
                const returnto = raw.startsWith("/openid/?returnto=") ? raw.slice("/openid/?returnto=".length) : "";
                const safeReturn = returnto === originalRecent ||
                    (returnto.startsWith(config.canonicalAppOrigin + "/") &&
                     entryPath(returnto.slice(config.canonicalAppOrigin.length)) !== null) ||
                    (returnto.startsWith(originalRecent + "?skip=") &&
                     /^(0|[1-9][0-9]{0,2})$/.test(returnto.slice((originalRecent + "?skip=").length)) &&
                     Number(returnto.slice((originalRecent + "?skip=").length)) <= 200);
                const go = /^\/go\?dir=(prev|next)&itemid=([1-9][0-9]{0,9})&journal=s2js_slice3$/.exec(raw);
                const safeGo = go !== null && validEntryId(Number(go[2]));
                if (!GET_PATHS.has(raw) && raw !== "/tools/memories?user=" + USERNAME &&
                    !item && !safeReturn && !safeGo && !datePath(raw) && !asset(raw)) return REJECT;
            }
            return {kind: "redirect", status: 307, location: config.canonicalAppOrigin + raw};
        } catch {
            return REJECT;
        }
    };
};
