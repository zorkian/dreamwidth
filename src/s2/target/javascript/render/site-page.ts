// site-page.ts
//
// Render a page in the site's own style, as DW::Template's render_template
// does: a view template, then the visitor's site scheme around it, with the
// dw, form and dw_scheme plugins and the ml filter.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { type Filter, type Plugin, type Stash, type Value, Template, isHash, num, str, truthy } from "../template";
import type { Document } from "../template/parser";
import type { Databases } from "../data/db";
import { type Site, User } from "../data/user";
import type { SiteConfig } from "../server/config";
import { ljuserTag } from "./chrome";
import { ehtml } from "./objects";
import { metaDiscoveryLinks } from "./pages";
import type { RenderResult } from "./render";
import { challenge, randChars } from "./reply-page";
import { LIBRARY, PAGE_STATS, type NeedOptions, Resources, siteSettings, standardResources } from "./resources";

export interface Secret {
    readonly stime: number;
    readonly secret: string;
}

export interface SiteRequest {
    readonly site: Site;
    // The path and query as requested.
    readonly url: string;
    readonly args: Readonly<Record<string, string>>;
    readonly cookie: string;
    // The visitor's ljuniq identity, which form_auth ties forms to.
    readonly uniq: string;
    // The journal the page is about, which scripts are told of.
    readonly journal?: User;
    readonly secret: Secret;
    // What the page has already asked for; a new page starts with the standard set.
    readonly resources?: Resources;
    // A scheme the request has chosen, ahead of the visitor's.
    readonly scheme?: string;
}

const viewCache = new Map<string, Document>();
const schemeCache = new Map<string, Document>();
// LJ::Widget's element ids count up for the life of the process.
let widgetId = 0;

// `status` is the response status unless the template sets one.
export function renderSitePage(request: SiteRequest, view: string, vars: Stash, status = 200): RenderResult {
    const page = new SitePage(request);
    page.status = status;
    const sections: Stash = {};
    return page.wrap(page.templateString(view, vars, sections), sections);
}

// DW::Template::render_string: HTML made elsewhere, in the site scheme.
export function renderSiteString(request: SiteRequest, content: string, sections: Stash): RenderResult {
    return new SitePage(request).wrap(content, sections);
}

// DW::SiteScheme->current, with a scheme the request set taking precedence.
export function currentScheme(config: SiteConfig, args: Readonly<Record<string, string>>, cookie: string,
    forced?: string): string {
    const { schemeList, defaultScheme } = config.siteTemplates;
    const pref = /(?:^|;\s*)BMLschemepref=([^;]*)/.exec(cookie)?.[1];
    const chosen = forced || args.skin || args.usescheme || (pref && decodeURIComponent(pref));
    return chosen && schemeList[chosen] ? chosen : defaultScheme;
}

class SitePage {
    status = 200;
    // The ml_scope request note: where keys starting with "." are found.
    scope: string | undefined;
    readonly resources: Resources;
    readonly config: SiteConfig;
    private formAuth?: string;

    constructor(readonly request: SiteRequest) {
        this.config = request.site.config;
        if (request.resources) {
            this.resources = request.resources;
        } else {
            this.resources = standardResources(this.config);
            this.resources.group = undefined;
        }
    }

    // DW::Template::render_scheme
    wrap(content: string, sections: Stash): RenderResult {
        const { schemeList } = this.config.siteTemplates;
        const scheme = currentScheme(this.config, this.request.args, this.request.cookie, this.request.scheme);
        const [pathname, query] = this.request.url.split(/\?(.*)/s);
        const body = this.engine("schemes").process("_init.tt", {
            sections, content, get: { ...this.request.args }, resource_group: this.resources.group,
            inheritance: [...schemeList[scheme]!].reverse().map(name => `${name}.tt`),
            returnto: `${this.config.protocol}://${this.request.site.host}${pathname}${query ? `?${query}` : ""}`,
        });
        return { status: this.status, body };
    }

    // DW::Template::template_string
    templateString(view: string, vars: Stash, sections: Stash = {}): string {
        sections.errors = vars.errors;
        const saved = this.scope;
        this.scope = `/${view}`;
        try {
            return this.engine("views").process(view, { ...vars, sections });
        } finally {
            this.scope = saved;
        }
    }

    private engine(kind: "views" | "schemes"): Template {
        const dirs = this.config.siteTemplates[kind];
        const plugins: Record<string, Plugin> = { dw: context => this.dwPlugin(context.stash), form: formPlugin };
        if (kind === "schemes") plugins.dw_scheme = () => this.schemePlugin();
        return new Template({
            load: name => {
                const dir = dirs.find(dir => existsSync(path.join(dir, name)));
                return dir === undefined ? undefined : readFileSync(path.join(dir, name), "utf8");
            },
            cache: kind === "views" ? viewCache : schemeCache,
            filters: { ml: { dynamic: (_context, ...args) => code => this.ml(code, args.at(-1)) } },
            plugins,
            preProcess: kind === "views" ? ["_init.tt"] : [],
        });
    }

    // LJ::Lang::ml, through DW::Template::Filters::ml's arguments.
    ml(code: string, vars: Value): string {
        if (code.startsWith(".") && this.scope) code = this.scope + code;
        const text = this.config.strings[code];
        if (text === undefined) return `[missing string ${code}]`;
        const values = isHash(vars) ? vars : {};
        return text.replace(/\[\[\?([\w-]+)\|(.+?)\]\]/g, (_, name, words) => words.split("|")[num(values[name]) === 1 ? 0 : 1] ?? "")
            .replace(/\[\[([^[]+?)\]\]/g, (_, name) => str(values[name]));
    }

    // DW::Template::Plugin
    private dwPlugin(stash: Stash): Stash {
        const { config } = this;
        stash.site = {
            ...config.siteTemplates.constants,
            root: config.siteRoot, imgroot: config.imgPrefix, jsroot: config.jsPrefix,
            shoproot: config.siteTemplates.shopRoot, statroot: config.statPrefix,
            is_canary: config.siteTemplates.isCanary ? 1 : "",
        };
        return {
            need_res: (...args: Value[]) => needRes(this.resources, {}, args),
            active_resource_group: (group: Value) => { this.resources.group = str(group); },
            request_status: (status: Value) => { this.status = num(status); },
            ml_scope: (...args: Value[]) => {
                const old = this.scope;
                if (args.length) this.scope = str(args[0]);
                return old;
            },
            form_auth: () => htmlHidden({ name: "lj_form_auth", value: this.formAuthChallenge() }),
            ml: (code: Value, ...args: Value[]) => this.ml(str(code), args.at(-1)),
        };
    }

    // LJ::form_auth for a logged-out visitor, once a request.
    private formAuthChallenge(): string {
        this.formAuth ??= challenge(this.request.secret, Math.floor(Date.now() / 1000), 86400,
            `${randChars(10)}-0-${this.request.uniq}`);
        return this.formAuth;
    }

    // DW::Template::Plugin::SiteScheme
    private schemePlugin(): Stash {
        const res = this.resources;
        const foundation = () => res.group === "foundation";
        const settings = () => siteSettings(this.request.site, this.request.journal);
        return {
            need_res: (...args: Value[]) => needRes(res, { priority: LIBRARY }, args),
            res_includes: () => settings() + res.includes("stylesheets") + (foundation() ? "" : res.includes("scripts")),
            final_head_html: () => "",
            final_body_html: () => (foundation() ? res.includes("scripts") : "") + PAGE_STATS,
            menu_nav: () => this.config.siteTemplates.menu.map(category => ({
                name: category.name, items: category.items.map(item => ({ ...item, display: 1 })),
            })),
            search_render: () => {
                const id = widgetId++;
                res.need({}, "stc/widgets/search.css");
                const body = this.templateString("widget/search.tt", {});
                return /\w/.test(body)
                    ? `<div class='appwidget appwidget-search' id='LJWidget_${id}'>\n${body}</div><!-- end .appwidget-search -->\n`
                    : "";
            },
            challenge_generate: (goodfor: Value) =>
                challenge(this.request.secret, Math.floor(Date.now() / 1000), num(goodfor) || 60, randChars(20)),
            switch_accounts: () => [],
        };
    }
}

// LJ::need_res, with its options hash first and keys given singly or as a list.
function needRes(res: Resources, defaults: NeedOptions, args: Value[]): string {
    const options = isHash(args[0]) ? args.shift() as NeedOptions : {};
    const keys = Array.isArray(args[0]) ? args[0] : args;
    res.need({ ...options, ...defaults }, ...keys.map(str));
    return "";
}

// A user, as templates call its methods.
export function templateUser(site: Site, u: User, identity?: string): Stash {
    return {
        user: u.user,
        journal_base: () => u.journalBase(site),
        ljuser_display: () => ljuserTag(site, u),
        openid_identity: () => identity,
        meta_discovery_links: () => metaDiscoveryLinks(site, u),
    };
}

// LJ::User::display_journal_deleted's data, for a logged-out visitor.
export async function deletedJournalVars(db: Databases, site: Site, u: User): Promise<Stash> {
    const [row] = await db.global("SELECT statusvisdate FROM user WHERE userid = ?", [u.userid]);
    const date = str(row?.statusvisdate);
    let deleter = ljuserTag(site, u);
    if (u.journaltype === "C") {
        const [log] = await u.cluster(db, "SELECT remoteid FROM userlog WHERE userid = ? AND logtime = UNIX_TIMESTAMP(?) LIMIT 1",
            [u.userid, date]);
        const [name] = log?.remoteid ? await db.global("SELECT user FROM user WHERE userid = ?", [log.remoteid]) : [];
        const by = name ? await User.byName(db, str(name.user)) : null;
        deleter = by ? ljuserTag(site, by) : "Unknown";
    }
    await u.loadProps(db, ["delete_reason"]);
    // One day short of the 30 before purging, to allow for time zones.
    const purge = new Date(Date.parse(`${date.replace(" ", "T")}Z`) + 29 * 86400 * 1000);
    return {
        reason: u.props.delete_reason, u: templateUser(site, u), purge_date: purge.toISOString().slice(0, 10),
        deleter_name_html: deleter, u_name_html: ljuserTag(site, u), is_comm: u.journaltype === "C" ? 1 : "",
    };
}

// DW::Template::Plugin::FormHTML, for forms that start empty.
const formPlugin: Plugin = () => {
    let counter = 0;
    const id = (args: Stash) => args.id || `id-${str(args.name)}-${counter++}`;
    // _process_value_and_label: fills in the value, and returns the label's HTML.
    const valueAndLabel = (args: Stash, valueKey = "value") => {
        if (args[valueKey] === undefined || args[valueKey] === null) args[valueKey] = args.default;
        const label = args.label;
        const labelclass = args.labelclass;
        const noescape = args.noescape;
        delete args.label;
        delete args.labelclass;
        delete args.noescape;
        if (label === undefined || label === null) return "";
        return labelfy(str(args.id), truthy(noescape) ? str(label) : ehtml(label), str(labelclass));
    };
    const hint = (args: Stash) => {
        const text = args.hint;
        delete args.hint;
        if (!truthy(text)) return "";
        const describedby = args.id ? `${str(args.id)}-hint` : "";
        args["aria-describedby"] = describedby;
        return `<span class="form-hint" id='${describedby}'>${str(text)}</span>`;
    };
    const errors = (args: Stash) => {
        if (args.error === undefined || !str(args.error).length) return "";
        args.class = `${str(args.class)} error`;
        return `<small class="error">${str(args.error)}</small>`;
    };
    const check = (type: string) => (named: Value) => {
        const args: Stash = { ...(named as Stash), ...(type === "radio" ? { type } : {}) };
        args.labelclass ||= `${type}label`;
        args.class ||= type;
        args.id = id(args);
        const label = valueAndLabel(args, "selected");
        return htmlCheck(args) + label;
    };
    const text = (defaults: Stash, valueKey?: string) => (named: Value) => {
        const args: Stash = { ...(named as Stash), ...defaults };
        args.class ||= "text";
        args.id = id(args);
        const hinted = hint(args);
        const error = errors(args);
        return valueAndLabel(args, valueKey) + htmlText(args) + error + hinted;
    };
    return {
        hidden: (named: Value) => {
            const args: Stash = { ...(named as Stash) };
            valueAndLabel(args);
            return htmlHidden(args);
        },
        submit: (named: Value) => {
            const args: Stash = { ...(named as Stash) };
            args.class ||= "submit";
            valueAndLabel(args);
            const { name, value, ...rest } = args;
            return htmlSubmit(name, value, rest);
        },
        checkbox: check("checkbox"),
        radio: check("radio"),
        textbox: text({}),
        password: text({ type: "password" }),
        select: (named: Value) => {
            const args: Stash = { ...(named as Stash) };
            const items = Array.isArray(args.items) ? args.items : [];
            delete args.items;
            args.class ||= "select";
            args.id = id(args);
            const error = errors(args);
            const hinted = hint(args);
            return valueAndLabel(args, "selected") + htmlSelect(args, items) + error + hinted;
        },
    };
};

const attrs = (args: Stash, skip: RegExp, value = (v: Value) => ehtml(v)) =>
    Object.entries(args).filter(([key]) => !skip.test(key)).map(([key, v]) => ` ${key}="${value(v)}"`).join("");

// LJ::labelfy
function labelfy(id: string, text: string, cls: string): string {
    const classAttr = cls ? `class="${ehtml(cls)}"` : "";
    return text.replace(/^([^<]+)/, (_, label) =>
        `\n        <label for="${id}" ${classAttr}>\n            ${label}\n        </label>\n        `);
}

// LJ::html_text
function htmlText(args: Stash): string {
    const type = args.type === "password" || args.type === "search" ? args.type : "text";
    return `<input type="${type}"${attrs(args, /^(type|disabled|raw|noescape)$/)}${args.raw ? ` ${str(args.raw)}` : ""}` +
        `${truthy(args.disabled) ? " disabled='disabled'" : ""} />`;
}

// LJ::html_check
function htmlCheck(args: Stash): string {
    return `<input type='${args.type === "radio" ? "radio" : "checkbox"}'${truthy(args.selected) ? " checked='checked'" : ""}` +
        `${args.raw ? ` ${str(args.raw)}` : ""}${attrs(args, /^(disabled|type|selected|raw|noescape|label)$/)}` +
        `${truthy(args.disabled) ? " disabled='disabled'" : ""} />`;
}

// LJ::html_hidden, for one field.
function htmlHidden(args: Stash): string {
    const { name, value } = args;
    return `<input type='hidden'${truthy(name) ? ` name="${ehtml(name)}"` : ""}` +
        `${value === undefined || value === null ? "" : ` value="${ehtml(value)}"`}` +
        `${attrs(args, /^(name|value|raw|noescape)$/)}${args.raw ? ` ${str(args.raw)}` : ""} />`;
}

// LJ::html_submit
function htmlSubmit(name: Value, value: Value, args: Stash): string {
    const type = args.type === "reset" || args.type === "button" ? args.type : "submit";
    return `<input type='${type}'${truthy(name) ? ` name="${ehtml(name)}"` : ""}` +
        `${value === undefined || value === null ? "" : ` value="${ehtml(value)}"`}` +
        `${attrs(args, /^(raw|disabled|noescape|type)$/)}${args.raw ? ` ${str(args.raw)}` : ""}` +
        `${truthy(args.disabled) ? " disabled='disabled'" : ""} />`;
}

// LJ::html_select, for value and text pairs.
function htmlSelect(args: Stash, items: Value[]): string {
    let out = `<select${args.raw ? ` ${str(args.raw)}` : ""}${truthy(args.disabled) ? " disabled='disabled'" : ""}` +
        `${attrs(args, /^(raw|disabled|selected|noescape|multiple)$/, v => ehtml(truthy(v) ? v : ""))}>\n`;
    let selected = false;
    for (let i = 0; i < items.length; i += 2) {
        const value = str(items[i]);
        const isSelected = !selected && args.selected !== undefined && args.selected !== null && str(args.selected) === value;
        if (isSelected) selected = true;
        out += `<option value="${ehtml(value)}"${isSelected ? " selected='selected'" : ""}>${ehtml(items[i + 1])}</option>\n`;
    }
    return `${out}</select>`;
}
