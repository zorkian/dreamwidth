// faq-page.ts
//
// The FAQ index and FAQ entries, as DW::Controller::Support::Faq shows them
// to an anonymous visitor in the default language.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import { eurl } from "@dreamwidth/content";
import { Faq } from "../data/faq";
import type { Databases } from "../data/db";
import { type Site, User } from "../data/user";
import type { Stash } from "../template";
import { ContentCleaner } from "./content";
import { ehtml } from "./objects";
import type { RenderResult } from "./render";
import { currentSecret } from "./reply-page";
import { mlText, renderSitePage } from "./site-page";

export interface FaqRequest {
    readonly site: Site;
    readonly url: string;
    readonly args: Readonly<Record<string, string>>;
    readonly cookie: string;
    readonly uniq: string;
}

const render = async (db: Databases, request: FaqRequest, view: string, vars: Stash) => renderSitePage({
    site: request.site, url: request.url, args: request.args, cookie: request.cookie, uniq: request.uniq,
    secret: await currentSecret(db),
}, view, vars);

// What [[username]] and [[journalurl]] stand for: for an anonymous visitor,
// the example account.
async function exampleUser(db: Databases, site: Site): Promise<{ user: string; url: string }> {
    const u = site.config.exampleUser ? await User.byName(db, site.config.exampleUser) : null;
    const unknown = "<b>[Unknown or undefined example username]</b>";
    return u ? { user: u.user, url: u.journalBase(site) } : { user: unknown, url: unknown };
}

// A question as the FAQ pages show it.
const questionText = (faq: Faq) => faq.questionHtml().trim().replaceAll("\n", "<br />");

// DW::Controller::Support::Faq::faq_handler
export async function renderFaqIndex(db: Databases, request: FaqRequest): Promise<RenderResult> {
    const faqs = await Faq.loadAll(db);
    await Faq.renderInPlace(db, request.site, faqs, await exampleUser(db, request.site));
    const faqcats: Stash[] = [];
    const questions: Record<string, Stash> = {};
    const categories = (await Faq.categories(db)).sort((a, b) => a.catorder - b.catorder);
    for (const cat of categories) {
        const inCat = faqs.filter(faq => faq.faqcat === cat.faqcat).sort((a, b) => a.sortorder - b.sortorder);
        if (!inCat.length) continue;
        faqcats.push({ faqcat: cat.faqcat, faqcatname: cat.faqcatname });
        const faqqs = inCat.flatMap(faq => faq.question ? [{ q: questionText(faq), faqid: faq.faqid }] : []);
        if (faqqs.length) questions[cat.faqcat] = { faqqs };
    }
    return render(db, request, "support/faq.tt", { faqcats, questions });
}

// DW::Controller::Support::Faq::faqbrowse_handler, for one FAQ or a whole
// category. Undefined for requests left to Perl: none of either (a relative
// redirect), another language, or an id Perl rejects.
export async function renderFaqBrowse(db: Databases, request: FaqRequest): Promise<RenderResult | undefined> {
    const { site, args } = request;
    const config = site.config;
    const faqidarg = Math.trunc(Number.parseFloat(args.faqid ?? "")) || 0;
    const faqcatarg = args.faqcat ?? "";
    if (faqidarg < 0 || !faqidarg && !faqcatarg) return undefined;
    if (args.lang && args.lang !== config.defaultLang) return undefined;
    const vars: Stash = { altlang: 0, curlang: args.lang || config.defaultLang };
    const mode = args.view === "full" || faqidarg ? "answer" : "summary";
    const example = await exampleUser(db, site);

    let faqs: Faq[];
    if (faqidarg) {
        const faq = await Faq.load(db, faqidarg);
        if (!faq) {
            vars.title = mlText(config, "/support/faqbrowse.tt.error.title_nofaq", { faqid: faqidarg });
            return render(db, request, "support/faqbrowse.tt", vars);
        }
        faqs = [faq];
        await Faq.renderInPlace(db, site, faqs, example);
        vars.title = faq.questionHtml();
    } else {
        const catname = await Faq.categoryName(db, faqcatarg);
        vars.title = mlText(config, "/support/faqbrowse.tt.title_cat", { catname: ehtml(catname ?? "") });
        faqs = (await Faq.loadAll(db, faqcatarg)).sort((a, b) => a.sortorder - b.sortorder);
        await Faq.renderInPlace(db, site, faqs, example);
        vars.faqcatarg = 1;
    }

    const qterm = args.q ?? "";
    vars.q = qterm ? `&q=${eurl(qterm)}` : "";
    const content = new ContentCleaner(site);
    await content.preload(db, faqs.flatMap(faq => [faq.summary, faq.answer]));
    const lastmod = await User.byIds(db, faqs.map(faq => faq.lastmoduserid).filter(id => id > 0));
    const term = (match: string) =>
        /^https?:\/\//.test(match) ? match : `<span class='searchhighlight'>${ehtml(match)}</span>`;
    const quoted = qterm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    vars.faqs = await Promise.all(faqs.map(async faq => {
        let summary: string | undefined = faq.summary, answer = faq.answer;
        let displaySummary: boolean, displayAnswer: boolean;
        if (mode === "answer") {
            displayAnswer = true;
            displaySummary = faq.hasSummary();
        } else {
            displaySummary = faq.hasSummary();
            displayAnswer = !displaySummary;
        }
        if (!config.enabled.faq_summaries) {
            displayAnswer ||= displaySummary;
            displaySummary = false;
        }
        let question = questionText(faq);
        if (displaySummary) summary = content.faq(summary);
        if (displayAnswer) answer = content.faq(answer);
        if (qterm) {
            question = question.replace(new RegExp(`(${quoted})`, "gi"), term);
            summary ??= "";
            const inTag = new RegExp(`<[^>]*${quoted}[^>]*>`, "i");
            const highlight = new RegExp(`((?:https?://[^>]+)?${quoted})`, "gi");
            if (!inTag.test(summary)) summary = summary.replace(highlight, term);
            if (!inTag.test(answer)) answer = answer.replace(highlight, term);
        }
        const cleaned: Stash = {
            faqid: faq.faqid, question, answer, summary,
            display_summary: displaySummary ? 1 : 0, display_answer: displayAnswer ? 1 : "",
            lastmodwho: lastmod.get(faq.lastmoduserid)?.user, lastmodtime: faq.lastmodtime,
        };
        if (faqidarg) cleaned.categoryname = await Faq.categoryName(db, faq.faqcat);
        return cleaned;
    }));
    return render(db, request, "support/faqbrowse.tt", vars);
}
