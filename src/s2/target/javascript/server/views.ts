// views.ts
//
// Map a journal-relative path to a view, as
// DW::Controller::Journal::determine_view does.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

// The named views in %LJ::viewinfo.
const NAMED_VIEWS = new Set(["lastn", "archive", "day", "read", "network", "data", "rss", "res", "info", "profile",
    "tag", "security", "update", "icons"]);

export type ViewMatch =
    | { redirect: string }
    | { mode: string; pathextra?: string; ditemid?: number; slug?: string; date?: string };

// `base` is the journal's URL, for redirects. Undefined means no such page.
export function determineView(uri: string, query: string, args: Record<string, string>,
    base: string): ViewMatch | undefined {
    const reply = args.mode === "reply" || !!args.replyto || !!args.edit;
    let match: RegExpExecArray | null;

    if (uri === "/favicon.ico") return undefined;
    if ((match = /^\/tags(.*)/.exec(uri))) return { redirect: `${base}/tag${match[1]}` };
    if ((match = /^\/calendar(.*)/.exec(uri))) return { redirect: `${base}/archive${match[1]}` };

    if ((match = /^\/(\d+)(\.html?)$/i.exec(uri))) {
        if (match[2] !== ".html") return { redirect: `/${match[1]}.html${query}` };
        return { mode: reply ? "reply" : "entry", ditemid: Number(match[1]) };
    }
    if ((match = /^\/(\d\d\d\d\/\d\d\/\d\d)\/([a-z0-9_-]+)\.html$/.exec(uri))) {
        return { mode: reply ? "reply" : "entry", slug: match[2], date: match[1] };
    }
    if ((match = /^\/(\d\d\d\d)(?:\/(\d\d)(?:\/(\d\d))?)?(\/?)$/.exec(uri))) {
        const [, year, month, day, slash] = match;
        if (!slash) return { redirect: `${base}/${year}${month ? `/${month}` : ""}${day ? `/${day}` : ""}/` };
        return { mode: day ? "day" : month ? "month" : "archive", pathextra: uri };
    }
    if ((match = /^\/([a-z_]+)?(.*)$/.exec(uri)) && (!match[1] || NAMED_VIEWS.has(match[1]))) {
        let mode = match[1] ?? "";
        let pathextra: string | undefined = match[2];
        if (!mode && pathextra) return undefined;
        if (/^day|calendar$/.test(mode) && /^\/\d\d\d\d/.test(pathextra!)) {
            return { redirect: base + uri.replace(new RegExp(`${mode}/(\\d\\d\\d\\d)`), "$1") };
        }
        if (mode === "rss") return { redirect: `${base}/data/rss${query}` };
        if (mode === "tag") {
            if (!pathextra) return { redirect: `${base}${uri}/` };
            if (pathextra === "/") return { mode: "tag" };
            return { mode: "lastn", pathextra: `/tag${pathextra}` };
        }
        if (mode === "security") {
            if (!pathextra) return { redirect: `${base}${uri}/` };
            mode = "lastn";
            pathextra = `/security${pathextra}`;
        }
        return { mode, pathextra: pathextra || undefined };
    }
    if (uri === "/robots.txt") return { mode: "robots_txt" };
    return undefined;
}
