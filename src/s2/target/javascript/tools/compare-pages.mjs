// compare-pages.mjs
//
// Fetch the same journal paths from the Perl site and the JavaScript server
// and report differences between their normalized DOMs.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { JSDOM } from "jsdom";

// Values that differ on every request, keyed by attribute name.
const VOLATILE = new Set(["lj_form_auth", "chrp1"]);
const VERBATIM = new Set(["PRE", "TEXTAREA", "SCRIPT", "STYLE"]);

// Perl emits these script settings from hashes in random key order, and the
// comment settings carry a per-request form token.
const sortKeys = value => Array.isArray(value) ? value.map(sortKeys)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort().map(([k, v]) => [k, sortKeys(v)]))
        : value;
const sortSiteKeys = text => text
    .replace(/(Object\.assign\(Site, )(\{.*?\})(\);)/s, (whole, open, json, close) => {
        try {
            return open + JSON.stringify(sortKeys(JSON.parse(json))) + close;
        } catch {
            return whole;
        }
    })
    .replace(/(var LJ_cmtinfo = )(\{.*\})(\n)/, (whole, open, json, close) => {
        try {
            return open + JSON.stringify(sortKeys({ ...JSON.parse(json), form_auth: "*" })) + close;
        } catch {
            return whole;
        }
    });

const unorigin = (value, origins) => origins.reduce((text, origin) =>
    text.replaceAll(origin, "ORIGIN").replaceAll(new URL(origin).host, "HOST"), value)
    .replace(/LJWidget_\d+/g, "LJWidget_N");

// Perl builds some links from a hash, so their query order varies.
const sortQuery = url => {
    const match = /^([^?#]*)\?([^?#]*&[^#]*)(#.*)?$/.exec(url);
    return match ? `${match[1]}?${match[2].split("&").sort().join("&")}${match[3] ?? ""}` : url;
};

export function normalize(html, origins) {
    const document = new JSDOM(html).window.document;
    const lines = [];
    // Widget ids come from a per-process counter in Perl.
    const walk = (node, depth, verbatim) => {
        const indent = "  ".repeat(depth);
        if (node.nodeType === 3) {
            const text = verbatim ? sortSiteKeys(node.data) : node.data.replace(/\s+/g, " ").trim();
            if (text) lines.push(indent + JSON.stringify(unorigin(text, origins)));
            return;
        }
        if (node.nodeType === 8) return;
        if (node.nodeType !== 1) {
            for (const child of node.childNodes) walk(child, depth, verbatim);
            return;
        }
        const name = node.getAttribute("name");
        const attrs = [...node.attributes]
            .map(({ name: key, value }) => {
                if (key === "value" && VOLATILE.has(name)) value = "*";
                if (key === "href") value = sortQuery(value);
                return `${key}=${JSON.stringify(unorigin(value.replace(/\s+/g, " ").trim(), origins))}`;
            })
            .sort();
        lines.push(indent + [node.tagName.toLowerCase(), ...attrs].join(" "));
        for (const child of node.childNodes) walk(child, depth + 1, verbatim || VERBATIM.has(node.tagName));
    };
    walk(document, 0, false);
    // EntryPage lists article tags from a Perl hash, in random order.
    const tags = lines.filter(line => line.includes('property="article:tag"'));
    const sorted = [...tags].sort();
    return lines.map(line => line.includes('property="article:tag"') ? sorted.shift() : line).join("\n") + "\n";
}

// Connect to loopback but send the origin's own Host, which both servers
// use to build journal URLs.
// A response as compared: status, redirect target and the normalized body,
// or the body as it is for anything but HTML.
export function summarize(page, origins) {
    const html = page.type.startsWith("text/html");
    const location = page.location ? `location ${unorigin(page.location, origins)}\n` : "";
    if (!page.body) return `status ${page.status}\n${location}`;
    return `status ${page.status}\n${location}` + (html ? normalize(page.body, origins) : unorigin(page.body, origins));
}

export function fetchPage(origin, pagePath) {
    const url = new URL(origin);
    return new Promise((resolve, reject) => {
        http.get({ host: "127.0.0.1", port: url.port || 80, path: pagePath, headers: { host: url.host } },
            response => {
                let body = "";
                response.setEncoding("utf8");
                response.on("data", chunk => (body += chunk));
                response.on("end", () => resolve({
                    status: response.statusCode, body, type: response.headers["content-type"] ?? "",
                    location: response.headers.location,
                }));
            }).on("error", reject);
    });
}

// Usage: compare-pages.mjs PERL_ORIGIN JS_ORIGIN PATH...
// Origins are http://host:port as the respective server expects in Host.
if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
    const [perlOrigin, jsOrigin, ...paths] = process.argv.slice(2);
    if (!perlOrigin || !jsOrigin || !paths.length) {
        console.error("Usage: compare-pages.mjs PERL_ORIGIN JS_ORIGIN PATH...");
        process.exit(2);
    }
    const directory = mkdtempSync(path.join(tmpdir(), "compare-pages-"));
    let failed = 0;
    for (const pagePath of paths) {
        const [perl, js] = await Promise.all([perlOrigin, jsOrigin].map(origin => fetchPage(origin, pagePath)));
        const origins = [perlOrigin, jsOrigin];
        const files = ["perl", "js"].map(side => path.join(directory, side + pagePath.replace(/\W+/g, "_")));
        for (const [index, page] of [perl, js].entries()) writeFileSync(files[index], summarize(page, origins));
        const diff = spawnSync("diff", ["-u", ...files], { encoding: "utf8" });
        if (diff.status === 0) {
            console.log(`same ${pagePath}`);
        } else {
            failed++;
            console.log(`DIFFERENT ${pagePath}\n${diff.stdout}`);
        }
    }
    process.exit(failed ? 1 : 0);
}
