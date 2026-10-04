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
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { JSDOM } from "jsdom";

// Values that differ on every request, keyed by field name.
const VOLATILE = new Set(["lj_form_auth", "chrp1", "chal"]);
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

// The not-found page's title is picked at random from `quips`.
const unquip = (text, quips) => quips.reduce((out, quip) => out.replaceAll(quip, "QUIP"), text);

// Perl builds some links from a hash, so their query order varies.
const sortQuery = url => {
    const match = /^([^?#]*)\?([^?#]*&[^#]*)(#.*)?$/.exec(url);
    return match ? `${match[1]}?${match[2].split("&").sort().join("&")}${match[3] ?? ""}` : url;
};

export function normalize(html, origins, quips = []) {
    const document = new JSDOM(html).window.document;
    const lines = [];
    // Widget ids come from a per-process counter in Perl.
    const walk = (node, depth, verbatim) => {
        const indent = "  ".repeat(depth);
        if (node.nodeType === 3) {
            let text = verbatim ? sortSiteKeys(node.data) : node.data.replace(/\s+/g, " ").trim();
            // Pages rendered a minute apart.
            if (node.parentNode?.id === "load-time") text = text.replace(/\d+:\d\d [ap]m$/, "TIME");
            if (text) lines.push(indent + JSON.stringify(unquip(unorigin(text, origins), quips)));
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
                // LJ::EmbedModule names each iframe with a random suffix.
                if (key === "name" && node.tagName === "IFRAME") value = value.replace(/_\w{5}$/, "_*");
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
export function summarize(page, origins, quips) {
    const html = page.type.startsWith("text/html");
    const location = page.location ? `location ${unorigin(page.location, origins)}\n` : "";
    if (!page.body) return `status ${page.status}\n${location}`;
    return `status ${page.status}\n${location}` + (html ? normalize(page.body, origins, quips) : unorigin(page.body, origins));
}

// An https origin is fetched from where it is; an http one from this machine,
// sending its host, or `host` in its place. `cookie` is sent as the Cookie header.
export function fetchPage(origin, pagePath, host, cookie) {
    const url = new URL(origin);
    const cookies = cookie ? { cookie } : {};
    const request = url.protocol === "https:"
        ? (callback => https.get(new URL(pagePath, origin), { headers: cookies }, callback))
        : (callback => http.get({ host: "127.0.0.1", port: url.port || 80, path: pagePath,
            headers: { host: host ?? url.host, ...cookies } }, callback));
    return new Promise((resolve, reject) => {
        request(response => {
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

// Usage: compare-pages.mjs [--host HOST] [--config FILE] [--cookie COOKIE] PERL_ORIGIN JS_ORIGIN PATH...
// A local origin is http://host:port as that server expects in Host; --host
// sends HOST to the JavaScript server instead, such as a journal's subdomain.
// --config reads the not-found page's quips from the server's configuration.
// --cookie sends a Cookie header to both.
if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
    const argv = process.argv.slice(2);
    const options = {};
    while (/^--(host|config|cookie)$/.test(argv[0] ?? "")) options[argv.shift().slice(2)] = argv.shift();
    const { host, config, cookie } = options;
    const quips = config ? JSON.parse(readFileSync(config, "utf8")).notFoundQuips : [];
    const [perlOrigin, jsOrigin, ...paths] = argv;
    if (!perlOrigin || !jsOrigin || !paths.length) {
        console.error("Usage: compare-pages.mjs [--host HOST] [--config FILE] [--cookie COOKIE] PERL_ORIGIN JS_ORIGIN PATH...");
        process.exit(2);
    }
    const directory = mkdtempSync(path.join(tmpdir(), "compare-pages-"));
    let failed = 0;
    for (const pagePath of paths) {
        const [perl, js] = await Promise.all([
            fetchPage(perlOrigin, pagePath, undefined, cookie), fetchPage(jsOrigin, pagePath, host, cookie),
        ]);
        const origins = [perlOrigin, jsOrigin];
        const files = ["perl", "js"].map(side => path.join(directory, side + pagePath.replace(/\W+/g, "_")));
        for (const [index, page] of [perl, js].entries()) writeFileSync(files[index], summarize(page, origins, quips));
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
