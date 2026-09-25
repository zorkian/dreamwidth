// page-execute.ts
//
// Execute the compiled stock S2 recent page against validated prepared data.
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

import { readFileSync } from "node:fs";
import {
    ABI_VERSION, BuiltinFunction, cleanTrustedSafeChunk, Context, Layer, s2,
} from "../runtime/s2runtime";

type Data = Record<string, unknown>;

const sources = ["styles/core2.s2", "styles/core2base/layout.s2"];
const hashes = [
    "8621d96ebc6f9ee9eaf19f4cc0ac9e029b0e816d982653d19d52b04918cd9db6",
    "c1f6fb95fbecc202a024efa7558c6cedcdb5229f150e765fd441ba632ff0b411",
];
const maxHtmlBytes = 2 * 1024 * 1024;

function record(value: unknown, label: string): Data {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Invalid ${label}`);
    }
    return value as Data;
}

function readFixture(path: string): { page: Data; properties: Data; host: Data } {
    const fixture = record(JSON.parse(readFileSync(path, "utf8")), "page fixture");
    const provenance = record(fixture.provenance, "page provenance");
    if (provenance.schema !== 1 || provenance.abi !== ABI_VERSION ||
        provenance.base !== "aa0f7f1fc3a1cbb897e5f62954d78c3930c35313" ||
        JSON.stringify(provenance.source_files) !== JSON.stringify(sources) ||
        JSON.stringify(provenance.source_sha256) !== JSON.stringify(hashes) ||
        JSON.stringify(provenance.layer_names) !== JSON.stringify(["core2", "core2base/layout"]) ||
        JSON.stringify(provenance.request) !== JSON.stringify({
            host: "localhost", method: "GET", path: "/users/s2js_slice2/",
        }) || provenance.fixed_clock !== "2026-09-25T00:00:00Z" ||
        provenance.seed_version !== 1 ||
        !["baseline", "owned-body-1"].includes(String(provenance.content_variant))) {
        throw new Error("Wrong page fixture provenance, version, or style stack");
    }
    const graph = record(fixture.graph, "S2 graph");
    const nodes = record(graph.nodes, "S2 graph nodes");
    const objects = new Map<string, Data | unknown[]>();
    for (const [id, raw] of Object.entries(nodes)) {
        const node = record(raw, `S2 node ${id}`);
        if (node.kind !== "HASH" && node.kind !== "ARRAY") throw new Error(`Invalid S2 node ${id}`);
        objects.set(id, node.kind === "HASH" ? Object.create(null) as Data : []);
    }
    function revive(value: unknown): unknown {
        if (Array.isArray(value)) throw new Error("Unexpected inline array in S2 graph");
        if (!value || typeof value !== "object") return value;
        const ref = record(value, "S2 reference");
        if (typeof ref.$ref === "string") {
            const found = objects.get(ref.$ref);
            if (!found) throw new Error(`Missing S2 object ${ref.$ref}`);
            return found;
        }
        if (ref.$host_user !== undefined) return record(ref.$host_user, "host user");
        throw new Error("Unexpected inline object in S2 graph");
    }
    for (const [id, raw] of Object.entries(nodes)) {
        const node = record(raw, `S2 node ${id}`);
        const target = objects.get(id)!;
        if (Array.isArray(target)) {
            if (!Array.isArray(node.value)) throw new Error(`Invalid S2 array ${id}`);
            for (const item of node.value) target.push(revive(item));
        } else {
            const members = record(node.value, `S2 hash ${id}`);
            if (typeof members._type === "string") {
                for (const [key, item] of Object.entries(members)) {
                    if (!key.startsWith("_")) target[`_${key}`] = revive(item);
                }
                target[".type"] = members._type;
            }
            if (members._isnull) target[".isnull"] = true;
            // Codegen uses the S2 names with one leading underscore; the
            // persisted Perl fields are also available for explicit helpers.
            for (const [key, item] of Object.entries(members)) target[key] = revive(item);
        }
    }
    const page = record(revive(graph.root), "prepared page");
    const properties = record(revive(graph.properties), "prepared properties");
    const sections = record(properties.module_sections, "stock module sections");
    for (const key of ["one", "two"]) {
        const items = sections[key];
        if (!Array.isArray(items)) throw new Error(`Missing stock module section ${key}`);
        // Perl's S2 array dereference treats each unset string[] slot as an
        // empty array when core2 probes item[0]. Keep the explicit slots.
        for (let index = 0; index < items.length; index++) {
            if (items[index] === null) items[index] = [];
        }
    }
    const entries = page.entries;
    if (page[".type"] !== "RecentPage" || !Array.isArray(entries) || entries.length !== 2 ||
        entries.some(item => !item || typeof item !== "object" ||
            (item as Data)[".type"] !== "Entry")) {
        throw new Error("Wrong prepared page or entry count");
    }
    const host = record(fixture.host, "named host data");
    if (host.owner_user !== "s2js_slice2" || !Number.isSafeInteger(host.owner_userid) ||
        typeof host.viewer_sees_control_strip !== "boolean" ||
        typeof host.control_strip_html !== "string" ||
        typeof host.script_tags_html !== "string" ||
        typeof host.ljuser_html !== "string" ||
        typeof host.quickreply_div !== "string" ||
        typeof host.footer_pagestats_html !== "string" ||
        !Array.isArray(entries) || entries.some(entry => {
            const item = entry as Data;
            return typeof item.subject !== "string" || typeof item.text !== "string" ||
                !item.time || typeof item.time !== "object";
        })) {
        throw new Error("Missing or invalid prepared page fields");
    }
    host.calendar_month = revive(host.calendar_month_ref);
    host.admin_post_image = revive(host.admin_post_image_ref);
    host.memadd_image = revive(host.memadd_image_ref);
    host.tellfriend_image = revive(host.tellfriend_image_ref);
    return { page, properties, host };
}

function loadLayers(path: string): Layer[] {
    const artifact = record(JSON.parse(readFileSync(path, "utf8")), "compiled artifact");
    if (artifact.abi !== ABI_VERSION || !Array.isArray(artifact.layers) || artifact.layers.length !== 2) {
        throw new Error("Wrong stock artifact ABI or layer count");
    }
    return artifact.layers.map((raw, index) => {
        const item = record(raw, `compiled layer ${index}`);
        if (item.source !== sources[index] || item.variable !== `layer_${index}` ||
            typeof item.code !== "string" || !item.code) {
            throw new Error(`Wrong compiled stock layer ${index}`);
        }
        const load = new Function("s2", `"use strict";\n${item.code}\nreturn ${item.variable};`);
        const layer: unknown = load(s2);
        if (!(layer instanceof Layer)) throw new Error(`Stock layer ${index} did not register`);
        layer.source = item.source as string;
        return layer;
    });
}

function callbacks(page: Data, host: Data): Record<string, BuiltinFunction> {
    const alternates = new Map<string, boolean>();
    let quickreplyPrinted = false;
    const anonymous = () => false;
    const escape = (value: unknown) => String(value ?? "")
        .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
    const pad = (number: unknown) => String(number ?? 0).padStart(2, "0");
    function datePart(ctx: Context, item: Data, token: string): string {
        const year = Number(item.year ?? 0);
        const month = Number(item.month ?? 0);
        const day = Number(item.day ?? 0);
        const hour = Number(item.hour ?? 0);
        switch (token) {
            case "m": return String(month);
            case "mm": return pad(month);
            case "d": return String(day);
            case "dd": return pad(day);
            case "yy": return pad(year % 100);
            case "yyyy": return String(year);
            case "mon": return String((ctx.prop._lang_monthname_short as unknown[])[month]);
            case "month": return String((ctx.prop._lang_monthname_long as unknown[])[month]);
            case "dayord": return String(ctx.getFunction("lang_ordinal(int)")(ctx, day));
            case "H": return String(hour);
            case "HH": return pad(hour);
            case "h": return String(hour % 12 || 12);
            case "hh": return pad(hour % 12 || 12);
            case "min": return pad(item.min);
            case "sec": return pad(item.sec);
            case "a": return hour < 12 ? "a" : "p";
            case "A": return hour < 12 ? "A" : "P";
            default: throw new Error(`Unknown stock date token ${token}`);
        }
    }
    function formatDate(ctx: Context, value: unknown, format: unknown, kind: string, links = false): string {
        const item = record(value, "S2 date object");
        const requested = String(format || (kind === "month" ? "long" : "short"));
        const configured = ctx.prop[`_lang_fmt_${kind}_${requested}`];
        const pattern = typeof configured === "string" ? configured :
            requested === "iso" ? "%%yyyy%%-%%mm%%-%%dd%%" : requested;
        return pattern.split("%%").map((part, index) => {
            if (index % 2 === 0) return escape(part);
            const rendered = datePart(ctx, item, part);
            if (!links) return rendered;
            const year = Number(item.year ?? 0);
            const month = pad(item.month);
            const day = pad(item.day);
            const path = /^(d|dd|dayord)$/.test(part) ? `/${year}/${month}/${day}/` :
                /^(m|mm|mon|month)$/.test(part) ? `/${year}/${month}/` :
                /^(yy|yyyy)$/.test(part) ? `/${year}/` : "";
            return path ? `<a href="${path}">${rendered}</a>` : rendered;
        }).join("");
    }
    function s2Object(type: string, fields: Data): Data {
        const result: Data = { ".type": type, _type: type };
        for (const [name, value] of Object.entries(fields)) {
            result[name] = value;
            result[`_${name}`] = value;
        }
        return result;
    }
    return {
        _get_page: () => page,
        _get_image: (_ctx, name) => {
            if (name !== "admin-post") throw new Error(`Unknown stock image ${String(name)}`);
            const image = record(host.admin_post_image, "prepared stock image");
            if (image[".type"] !== "Image") throw new Error("Wrong stock image type");
            return image;
        },
        _Page__print_control_strip: ctx => {
            if (typeof host.control_strip_html !== "string") {
                throw new Error("Missing control-strip host fragment");
            }
            ctx.print(host.control_strip_html);
        },
        _Page__print_script_tags: ctx => {
            if (typeof host.script_tags_html !== "string") {
                throw new Error("Missing app-owned script resource fragment");
            }
            ctx.print(host.script_tags_html);
        },
        _EntryLite__formatted_subject: (_ctx, entry, rawOptions) => {
            const item = record(entry, "entry subject");
            const options = record(rawOptions, "subject options");
            const subject = String(item.subject ?? "");
            const format = String(options.format ?? "");
            const cssClass = options.class ? ` class="${escape(options.class)}" ` : "";
            const style = options.style ? ` style="${escape(options.style)}" ` : "";
            if (format === "text") return `<span ${cssClass}${style}>${subject}</span>`;
            if (typeof item.permalink_url !== "string") throw new Error("Missing entry permalink");
            return `<a title="${subject}" href="${item.permalink_url}"${cssClass}${style}>${subject}</a>`;
        },
        _DateTime__date_format: (ctx, date, format, links) =>
            formatDate(ctx, date, format, "date", Boolean(links)),
        _DateTime__time_format: (ctx, date, format) => formatDate(ctx, date, format, "time"),
        _YearMonth__month_format: (ctx, month, format, links) =>
            formatDate(ctx, month, format, "month", Boolean(links)),
        _Page__get_latest_month: (_ctx, currentPage) => {
            if (currentPage !== page) throw new Error("Unknown calendar page");
            const counts = record(page._day_counts, "prepared journal day counts");
            const years = Object.keys(counts).map(Number).filter(year => year <= 2026).sort((a, b) => a - b);
            const year = years.at(-1) ?? 2026;
            const byMonth = counts[String(year)] ? record(counts[String(year)], "calendar year") : {};
            const months = Object.keys(byMonth).map(Number)
                .filter(month => year < 2026 || month <= 9).sort((a, b) => a - b);
            const month = months.at(-1) ?? 9;
            const prepared = record(host.calendar_month, "prepared app calendar month");
            if (Number(prepared.year) !== year || Number(prepared.month) !== month ||
                prepared[".type"] !== "YearMonth") {
                throw new Error("Prepared calendar differs from latest journal month");
            }
            return prepared;
        },
        _Page__visible_tag_list: (_ctx, currentPage, limit) => {
            if (currentPage !== page || host.visible_tag_count !== 0 ||
                (limit !== undefined && limit !== "" && !Number.isSafeInteger(Number(limit)))) {
                throw new Error("Unsupported nonempty visible tag list");
            }
            return [];
        },
        _UserLite__equals: (_ctx, one, two) => {
            const left = record(one, "first S2 user");
            const right = record(two, "second S2 user");
            if (!Number.isSafeInteger(left.host_userid) || !Number.isSafeInteger(right.host_userid)) {
                throw new Error("Missing user identity in prepared S2 data");
            }
            return left.host_userid === right.host_userid;
        },
        _UserLite__get_link: (ctx, user, key) => {
            const person = record(user, "S2 link user");
            if (person.user !== "s2js_slice2") throw new Error("Unknown user link target");
            const links = record(host.user_links, "prepared app user links");
            const raw = links[String(key)];
            if (raw === undefined) return { ".type": "Link", ".isnull": true, _url: "" };
            const link = record(raw, `user link ${String(key)}`);
            const caption = ctx.prop._userlite_interaction_links === "text" ? link.text : link.title;
            const icon = s2Object("Image", {
                url: link.image ?? "", width: link.width ?? 20,
                height: link.height ?? 18, alttext: "", extra: {},
            });
            return s2Object("Link", {
                url: link.url ?? "", caption: caption ?? "", icon, extra: {},
            });
        },
        _UserLite__ljuser: (_ctx, user, color) => {
            const person = record(user, "S2 ljuser");
            if (person.user !== host.owner_user || person.host_userid !== host.owner_userid ||
                (color && typeof color === "object" && !(color as Data)[".isnull"])) {
                throw new Error("Unsupported S2 ljuser variant");
            }
            if (typeof host.ljuser_html !== "string") throw new Error("Missing app user tag");
            return host.ljuser_html;
        },
        _Entry__get_link: (ctx, rawEntry, key) => {
            if (!["edit_entry", "edit_tags", "mem_add", "tell_friend",
                "watch_comments", "unwatch_comments"].includes(String(key))) {
                throw new Error(`Unknown recent-entry link ${String(key)}`);
            }
            const entry = record(rawEntry, "entry link source");
            const journal = record(entry.journal, "entry journal");
            const itemid = Number(entry.itemid);
            if (!Number.isSafeInteger(itemid) || journal.user !== "s2js_slice2") {
                throw new Error("Invalid prepared entry link identity");
            }
            if (key === "mem_add" && host.memories_enabled) {
                return s2Object("Link", {
                    url: `/tools/memadd?journal=${journal.user}&amp;itemid=${itemid}`,
                    caption: ctx.prop._text_mem_add,
                    icon: record(host.memadd_image, "app memory icon"), extra: {},
                });
            }
            if (key === "tell_friend" && host.tellafriend_enabled &&
                record(host.entry_can_tell_friend, "tell-friend decisions")[String(itemid)]) {
                return s2Object("Link", {
                    url: `/tools/tellafriend?journal=${journal.user}&amp;itemid=${itemid}`,
                    caption: ctx.prop._text_tell_friend,
                    icon: record(host.tellfriend_image, "app share icon"), extra: {},
                });
            }
            return { ".type": "Link", ".isnull": true, _url: "" };
        },
        _Entry__print_reply_link: (ctx, entry, rawOptions) => {
            const item = record(entry, "reply entry");
            const options = record(rawOptions, "reply link options");
            const comments = record(item.comments, "entry comment info");
            const target = String(options.target ?? "");
            if (!/^[\w-]+$/.test(target)) return;
            const linktext = escape(options.linktext ?? "");
            const css = typeof options.class === "string" && /^[\w\s-]+$/.test(options.class)
                ? `class="${options.class}"` : "";
            const quickreply = host.has_quickreply && host.s2quickreply && !host.comments_need_access;
            const onclick = quickreply
                ? `onclick='return function(that) {return quickreply("${target}", 0, "",that)}(this)'`
                : "";
            const replyUrl = escape(comments.post_url ?? "");
            ctx.print(`<a ${onclick} href='${replyUrl}' ${css}>${linktext}</a>`);
        },
        _Entry__print_reply_container: (ctx, entry, rawOptions) => {
            if (!host.has_quickreply) return;
            const item = record(entry, "reply container entry");
            const options = record(rawOptions, "reply container options");
            const target = String(options.target || item.talkid || "");
            if (!/^[\w-]+$/.test(target)) return;
            const css = typeof options.class === "string" && /^[\w\s]+$/.test(options.class)
                ? `class="${options.class}"` : "";
            ctx.print(`<div ${css} id="ljqrt${target}" data-quickreply-container="${target}" ` +
                'style="display: none;"></div>');
            if (!quickreplyPrinted) {
                if (typeof host.quickreply_div !== "string") {
                    throw new Error("Missing app-owned quickreply fragment");
                }
                ctx.print(host.quickreply_div);
                quickreplyPrinted = true;
            }
        },
        _viewer_logged_in: anonymous, _viewer_is_owner: anonymous,
        _viewer_has_access: anonymous, _viewer_is_subscribed: anonymous,
        _viewer_is_member: anonymous, _viewer_is_admin: anonymous,
        _viewer_is_moderator: anonymous, _viewer_can_search: anonymous,
        _viewer_sees_control_strip: () => host.viewer_sees_control_strip,
        _alternate: (_ctx, one, two) => {
            const key = `${one}\0${two}`;
            const next = !alternates.get(key);
            alternates.set(key, next);
            return next ? one : two;
        },
        _clean_css_classname: (_ctx, name) => String(name).includes("eval")
            ? `${name} ${String(name).replaceAll("eval", "ev-l")}` : name,
        _ehtml: (_ctx, text) => escape(text),
        _striphtml: (_ctx, text) => String(text).replace(/<.*?>/g, ""),
        _string__contains: (_ctx, text, part) => String(text).includes(String(part)),
        _weekdays: ctx => ctx.prop._reg_firstdayofweek === "monday"
            ? [2, 3, 4, 5, 6, 7, 1] : [1, 2, 3, 4, 5, 6, 7],
        _get_plural_phrase: (ctx, count, property) => {
            const form = Number(ctx.getFunction("lang_map_plural(int)")(ctx, count));
            const raw = ctx.prop[`_${property}`];
            if (typeof raw !== "string") throw new Error(`Missing plural property ${property}`);
            const choices = raw.split(/\s*\/\/\s*/);
            const phrase = choices[form] ?? choices[choices.length - 1];
            return escape(phrase!.replace("#", String(count ?? 0)));
        },
    };
}

function main(): void {
    const [compiledPath, fixturePath] = process.argv.slice(2);
    if (!compiledPath || !fixturePath || process.argv.length !== 4) {
        throw new Error("Expected compiled stock artifact and page fixture paths");
    }
    const { page, properties, host } = readFixture(fixturePath);
    let html = "";
    let htmlBytes = 0;
    const context = new Context(loadLayers(compiledPath), text => {
        htmlBytes += Buffer.byteLength(text, "utf8");
        if (htmlBytes > maxHtmlBytes) throw new Error("Stock page HTML output limit exceeded");
        html += text;
    },
        properties, callbacks(page, host), cleanTrustedSafeChunk);
    context.runMethod(page, "print()");
    if (host.footer_hook_body !== "" || host.footer_hook_journal !== "" ||
        typeof host.footer_pagestats_html !== "string" ||
        host.footer_pagestats_html.length > 4096) {
        throw new Error("Unexpected app-owned final body fragment");
    }
    const ending = /<\/body>/i.exec(html);
    if (!ending || html.indexOf("</html>", ending.index) < 0) {
        throw new Error("Stock page omitted body/html close");
    }
    // DW::Controller::Journal inserts the two empty named hook results and
    // LJ::PageStats::render before the first closing body tag of the S2 page.
    html = html.slice(0, ending.index) + host.footer_pagestats_html + html.slice(ending.index);
    if (Buffer.byteLength(html, "utf8") > maxHtmlBytes) {
        throw new Error("Stock page HTML output limit exceeded after app footer");
    }
    process.stdout.write(html);
}

try {
    main();
} catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
}
