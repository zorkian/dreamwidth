// urls.ts
//
// Entry URL canonicalization and retained image upgrade policy.
//
// Portions adapted from LJ::CleanHTML, forked from the LiveJournal project
// owned and operated by Live Journal, Inc., and modified and expanded by
// Dreamwidth Studios, LLC. The original license is available at:
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
// In accordance with that license, this code and its modifications are provided
// under the GNU General Public License. See LICENSE in this distribution.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//

import type { EntryContentContext } from "../contracts";

// This module does not confer safe-HTML authority. The caller still applies the
// element/attribute policy and final DOM sanitizer. No resource is fetched here.
export function canonicalUrl(value: string): string {
    return value.trim();
}

// CleanHTML.pm's entry attribute pass removes these bytes before interpreting
// schemes. Return null for a removed attribute, distinct from an empty value.
export function retainedAttributeValue(value: string): string | null {
    const cleaned = value.replace(/[\t\n\x00]/g, "");
    const compact = cleaned.replace(/\s/g, "");
    if (/(?:jscript|livescript|javascript|vbscript|^about|data):/i.test(compact)) {
        return null;
    }
    return cleaned;
}

// Relative destinations refer to the retained document, not the separate local
// render listener. Existing absolute bytes and protocol-relative semantics are
// preserved. Fragment-only href/usemap are deliberately handled by the caller.
export function resolveDocumentUrl(value: string, documentUrl: string): string {
    const url = canonicalUrl(value);
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//")) return url;
    return new URL(url, documentUrl).href;
}

export type ImageUrlDecision =
    | { readonly kind: "ready"; readonly url: string }
    | { readonly kind: "resolve"; readonly url: string };

// CleanHTML.pm https_url uses this particular last-two-label match, including
// its two/three-character TLD restriction. Do not replace it with a new host
// allowlist or apply this image proxy behavior to inline CSS URLs.
export function imageUrl(
    value: string, context: EntryContentContext,
): ImageUrlDecision {
    const url = canonicalUrl(value);
    if (/^(?:https:\/\/|\/\/)/.test(url)) return { kind: "ready", url };
    const domain = /^http:\/\/[^/]*?([^.]+\.\w{2,3})\//.exec(url)?.[1];
    if (domain && (domain === context.urls.siteDomain ||
        context.urls.knownHttpsSites.includes(domain))) {
        return { kind: "ready", url: url.replace(/^http:/, "https:") };
    }
    if (url.startsWith("http://") && context.urls.imageProxy === "host-resolved") {
        return { kind: "resolve", url };
    }
    // Resolve only after applying retained upgrade/proxy decisions. A relative
    // source was not a candidate for https_url's HTTP-only proxy in the original.
    return { kind: "ready", url: resolveDocumentUrl(url, context.documentUrl) };
}

// Form destination validation precedes relative-origin adaptation. Legacy form
// action removes relative values; formaction uses the same policy to close its
// historical bypass. Banned host keys are exact lowercased source configuration,
// not a suffix list. Do not mistake this for a network fetching permission.
export function formDestination(value: string, bannedHosts: readonly string[]): string | null {
    const cleaned = retainedAttributeValue(value);
    if (cleaned === null) return null;
    // The legacy single-slash regex accepted http:/host although browsers can
    // resolve it against the displayed document. Refuse this ambiguous action
    // instead of silently changing its destination at the separate TS origin.
    if (!/^https?:\/\//i.test(cleaned)) return null;
    const host = /^https?:\/\/?([^/]+)/.exec(cleaned.toLowerCase())?.[1];
    if (!host || /[%@\s]/.test(host) || bannedHosts.includes(host)) return null;
    return cleaned;
}
