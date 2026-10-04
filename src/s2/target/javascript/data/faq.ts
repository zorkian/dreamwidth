// faq.ts
//
// The site's FAQs, as LJ::Faq loads them in the default language and expands
// their mark-up.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import { ehtml } from "@dreamwidth/content";
import { type Databases, type Row, int, text } from "./db";
import { type Site, User } from "./user";

const COLUMNS = "faqid, question, summary, answer, faqcat, lastmoduserid, "
    + "DATE_FORMAT(lastmodtime, '%M %D, %Y') AS lastmodtime, sortorder";

export interface FaqCategory {
    readonly faqcat: string;
    readonly faqcatname: string;
    readonly catorder: number;
}

export class Faq {
    readonly faqid: number;
    readonly faqcat: string;
    readonly lastmoduserid: number;
    readonly lastmodtime: string;
    readonly sortorder: number;
    question: string;
    summary: string;
    answer: string;

    private constructor(row: Row) {
        this.faqid = int(row.faqid);
        this.question = text(row.question);
        this.summary = text(row.summary);
        this.answer = text(row.answer);
        this.faqcat = text(row.faqcat);
        this.lastmoduserid = int(row.lastmoduserid);
        this.lastmodtime = text(row.lastmodtime);
        this.sortorder = int(row.sortorder);
    }

    // LJ::Faq::load
    static async load(db: Databases, faqid: number): Promise<Faq | undefined> {
        const [row] = await db.global(`SELECT ${COLUMNS} FROM faq WHERE faqid = ?`, [faqid]);
        return row ? new Faq(row) : undefined;
    }

    // LJ::Faq::load_all: those in a category, or in any.
    static async loadAll(db: Databases, faqcat?: string): Promise<Faq[]> {
        const rows = faqcat
            ? await db.global(`SELECT ${COLUMNS} FROM faq WHERE faqcat = ?`, [faqcat])
            : await db.global(`SELECT ${COLUMNS} FROM faq WHERE faqcat != ''`);
        return rows.map(row => new Faq(row));
    }

    // The FAQ categories, as DW::Controller::Support::Faq lists them publicly.
    static async categories(db: Databases): Promise<FaqCategory[]> {
        return (await db.global("SELECT faqcat, faqcatname, catorder FROM faqcat WHERE faqcat <> 'int-abuse'"))
            .map(row => ({ faqcat: text(row.faqcat), faqcatname: text(row.faqcatname), catorder: int(row.catorder) }));
    }

    static async categoryName(db: Databases, faqcat: string): Promise<string | undefined> {
        const [row] = await db.global("SELECT faqcatname FROM faqcat WHERE faqcat = ?", [faqcat]);
        return row ? text(row.faqcatname) : undefined;
    }

    // LJ::Faq::question_html
    questionHtml(): string {
        return ehtml(this.question);
    }

    // LJ::Faq::has_summary
    hasSummary(): boolean {
        return !(this.summary === "" || this.summary === "-");
    }

    // LJ::Faq::render_in_place: expands [[username]], [[journalurl]],
    // [[faqtitle:N]] and [[gmlitem:code]] (and fmlitem, wmlitem) mark-up.
    static async renderInPlace(db: Databases, site: Site, faqs: readonly Faq[],
        { user, url }: { user: string; url: string }): Promise<void> {
        const domains: Record<string, string> = { g: "general", f: "faq", w: "widget" };
        const load: Record<string, Set<string>> = { g: new Set(), f: new Set(), w: new Set() };
        const names = new Set<string>();
        const collect = (source: string) => {
            for (const [, id] of source.matchAll(/\[\[faqtitle:(\d+)\]\]/g)) load.f!.add(`${id}.1question`);
            for (const [, dom, code] of source.matchAll(/\[\[([gfw])mlitem:([\w/.-]+)\]\]/g)) load[dom!]!.add(code!);
            for (const [, , arg] of source.matchAll(/\[\[(username|journalurl):([\w/.-]+?)\]\]/g)) names.add(arg!);
        };
        for (const faq of faqs) {
            collect(faq.question);
            if (faq.hasSummary()) collect(faq.summary);
            collect(faq.answer);
        }
        const res: Record<string, Map<string, string>> = {};
        for (const [key, codes] of Object.entries(load)) {
            res[key] = await mlTexts(db, site.config.defaultLang, domains[key]!, [...codes]);
        }
        const users = new Map<string, User>();
        for (const name of names) {
            const u = await User.byName(db, name);
            if (u) users.set(name, u);
        }
        const bad = (name: string) => `<b>[Unknown or improper variable: ${ehtml(name)}]</b>`;
        const replace = (name: string, arg: string | undefined, skipfaqs: boolean): string => {
            if (name === "journalurl" || name === "username") {
                if (!arg) return name === "journalurl" ? url : user;
                const u = users.get(arg);
                if (!u) return `<b>[Unknown username: ${ehtml(arg)}]</b>`;
                return name === "journalurl" ? u.journalBase(site) || bad(`${name}:${arg}`) : u.user;
            }
            if (arg && name === "faqtitle") {
                if (skipfaqs) return `[[faqtitle:${arg}]]`;
                return ehtml(res.f!.get(`${arg}.1question`) ?? "") || `<b>[Unknown FAQ id: ${ehtml(arg)}]</b>`;
            }
            const dom = arg ? /^([gfw])mlitem$/.exec(name)?.[1] : undefined;
            if (arg && dom) {
                return res[dom]!.get(arg)
                    || `<b>[Unknown item code: ${ehtml(arg)} in domain ${ehtml(domains[dom]!)}]</b>`;
            }
            return bad(arg ? `${name}:${arg}` : name);
        };
        const replaceAll = (source: string, skipfaqs: boolean) =>
            source.replace(/\[\[(\w+)(?::([\w/.-]+?))?\]\]/g,
                (_, name: string, arg?: string) => replace(name, arg, skipfaqs));
        for (const faq of faqs) {
            faq.question = replaceAll(faq.question, true);
            if (faq.hasSummary()) faq.summary = replaceAll(faq.summary, false);
            faq.answer = replaceAll(faq.answer, false);
        }
    }
}

// LJ::Lang::get_text_multi for one domain, read from the database alone.
async function mlTexts(db: Databases, lang: string, domain: string, codes: readonly string[]): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    if (!codes.length) return found;
    const rows = await db.global(`SELECT i.itcode, t.text FROM ml_text t, ml_latest l, ml_items i, ml_domains d, ml_langs n
        WHERE d.type = ? AND n.lncode = ? AND t.dmid = d.dmid AND t.txtid = l.txtid AND l.dmid = d.dmid
        AND l.lnid = n.lnid AND l.itid = i.itid AND i.dmid = d.dmid AND i.itcode IN (${codes.map(() => "?").join(",")})`,
    [domain, lang, ...codes]);
    const byLower = new Map(rows.map(row => [text(row.itcode).toLowerCase(), text(row.text)]));
    for (const code of codes) found.set(code, byLower.get(code.toLowerCase()) ?? "");
    return found;
}
