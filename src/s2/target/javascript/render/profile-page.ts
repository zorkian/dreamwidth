// profile-page.ts
//
// An account's profile page, as DW::Controller::Profile and
// DW::Logic::ProfilePage show it to an anonymous visitor: everything the
// owner keeps from anonymous visitors is left out, as Perl leaves it out.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import { canonicalUsername, eurl } from "@dreamwidth/content";
import { type Databases, int, text } from "../data/db";
import { truthy } from "../data/entry";
import { type Site, User } from "../data/user";
import { Userpics } from "../data/userpic";
import { type Stash, type Value, isHash, str } from "../template";
import { ljuserTag } from "./chrome";
import { ContentCleaner } from "./content";
import { expandEmbeds } from "./embedded";
import { ehtml } from "./objects";
import { robotMetaTags } from "./pages";
import type { RenderResult } from "./render";
import { currentSecret } from "./reply-page";
import { standardResources } from "./resources";
import { type SiteRequest, deletedJournalVars, imgTag, mlText, renderSitePage, templateUser } from "./site-page";

// $LJ::OLD_RES_PRIORITY
const OLD_PRIORITY = 5;
const SCOPE = "/profile/main.tt";

export interface ProfileRequest {
    readonly site: Site;
    // The path and query as requested.
    readonly url: string;
    readonly args: Readonly<Record<string, string>>;
    readonly cookie: string;
    readonly uniq: string;
    // The Host header, which the profile's own URL must match.
    readonly host: string;
    // The journal a journal URL's /profile is for, which stands in for ?user=.
    readonly journal?: string;
}

// DW::Controller::Profile::profile_handler, for an anonymous visitor.
export async function renderProfile(db: Databases, request: ProfileRequest): Promise<RenderResult> {
    const { site, args } = request;
    const config = site.config;
    const isFull = args.mode === "full";
    // Scripts are told of the journal only on its own URLs, where
    // DW::Controller::Journal has made it the active one.
    const siteRequest = async (journal?: User): Promise<SiteRequest> => ({
        site, url: request.url, args, cookie: request.cookie, uniq: request.uniq,
        journal: request.journal !== undefined ? journal : undefined, secret: await currentSecret(db),
    });
    const errorMl = async (code: string, vars: Stash = {}) =>
        renderSitePage(await siteRequest(), "error.tt", { message: mlText(config, code, vars) });
    const redirect = (location: string): RenderResult => ({ status: 303, body: "", location });

    let u: User | undefined;
    const username = canonicalUsername(args.user || request.journal || "");
    const userid = Math.trunc(Number.parseFloat(args.userid ?? "")) || 0;
    if (userid) {
        u = (await User.byIds(db, [userid])).get(userid);
        // Only finduser may look profiles up by id, except OpenID accounts'.
        if (!(args.t === "I" && u?.isIdentity())) return errorMl(`${SCOPE}.error.reqfinduser`);
    } else if (username) {
        u = await User.byName(db, username) ?? undefined;
        if (u?.isIdentity()) return redirect(u.profileUrl(site, isFull));
    } else {
        // DW::Controller::needlogin
        const [pathname, query] = request.url.split(/\?(.*)/s);
        const returnto = eurl(query ? `${pathname}?${query}` : pathname!);
        return { status: 302, body: "", location: `${config.siteRoot}/login?returnto=${returnto}` };
    }
    if (!u) return errorMl(`${SCOPE}.error.nonexist`, { user: username });
    await User.loadIdentities(db, [u]);

    if (u.isExpunged()) return renderSitePage(await siteRequest(u), "error/purged.tt", {});
    if (!u.isIdentity()) {
        const url = u.profileUrl(site, isFull);
        if (request.host !== url.replace(/^https?:\/\//, "").replace(/\/.*/s, "")) return redirect(url);
    }
    const renamed = await renamedUser(db, u);
    if (renamed && !renamed.equals(u)) {
        const query = `${isFull ? "mode=full&" : ""}user=${eurl(renamed.user)}`;
        return redirect(`${config.protocol}://${request.host.toLowerCase()}/profile?${query}`);
    }
    if (u.isSuspended()) return renderSitePage(await siteRequest(u), "error/suspended.tt", { u: templateUser(site, u) });
    if (u.statusvis === "D") {
        return renderSitePage(await siteRequest(u), "journal/deleted.tt", await deletedJournalVars(db, site, u), 404);
    }

    const resources = standardResources(config);
    resources.group = undefined;
    resources.need({}, "js/profile.js");
    resources.need({ priority: OLD_PRIORITY }, "stc/profile.css");
    const vars = await profileVars(db, site, u, isFull);
    return renderSitePage({ ...await siteRequest(u), resources }, "profile/main.tt", vars);
}

// LJ::User::get_renamed_user: the account a renamed one now is, following
// up to five renames.
async function renamedUser(db: Databases, u: User): Promise<User | undefined> {
    let current: User | undefined = u;
    for (let hops = 5; current && current.journaltype === "R" && hops > 0; hops--) {
        await current.loadProps(db, ["renamedto"]);
        const to: string = current.props.renamedto ?? "";
        if (!to) break;
        current = await User.byName(db, to) ?? undefined;
    }
    return current;
}

// The template variables DW::Controller::Profile sets.
async function profileVars(db: Databases, site: Site, u: User, isFull: boolean): Promise<Stash> {
    const config = site.config;
    await u.loadProps(db, ["journaltitle", "journalsubtitle", "opt_blockrobots", "adult_content", "opt_rpacct",
        "opt_showmutualfriends", "opt_hidefriendofs", "opt_hidememberofs"]);
    const profile = await ProfilePage.load(db, site, u);
    const edgeUsers = profile.edgeUsers;
    const userStash = (id: Value) => {
        const user = edgeUsers.get(int(id));
        return user ? profileUser(site, user) : undefined;
    };
    const showMutual = u.isIndividual() && truthy(u.props.opt_showmutualfriends);

    const linkify = (l: Value): Value => {
        if (!isHash(l)) return l;
        if (truthy(l.text)) {
            return (l.secimg ? str(l.secimg) : "") +
                (l.url ? `<a href="${str(l.url)}" rel="nofollow">${str(l.text)}</a>` : str(l.text));
        }
        if (truthy(l.email)) {
            // LJ::CleanHTML::mangle_email_address
            const mangled = ehtml(l.email).replace(/^(.+)@(.+)$/s, "<span>$1</span><span><em>&#64;</em></span>$2");
            return (l.secimg ? str(l.secimg) : "") + mangled;
        }
        return mlText(config, `${SCOPE}.error.linkify`);
    };
    const inactiveOk = (user: Value) => isFull || !profileOf(user)?.isInactive();
    const individual = (user: Value) => !!profileOf(user)?.isIndividual();
    return {
        u: {
            ...profileUser(site, u),
            prop: (name: Value) => u.props[str(name)],
            is_rp_account: truthy(u.props.opt_rpacct) ? 1 : "",
            show_mutualfriends: showMutual ? 1 : "",
            last_updated: profile.lastUpdated,
            opt_showcontact: profile.showContact,
            community_manage_members_url: `${config.siteRoot}/communities/${u.user}/members/edit`,
        },
        remote: undefined, is_full: isFull ? 1 : "",
        profile: profile.stash(),
        robot_meta_tags: !u.isVisible() || u.shouldBlockRobots(config) ? robotMetaTags() : undefined,
        force_empty: config.forceEmptySubscriptions.includes(u.userid) ? 1 : 0,
        load_userids: (ids: Value) =>
            Object.fromEntries((Array.isArray(ids) ? ids : []).map(id => [str(id), userStash(id)])),
        sort_by_username: (list: Value, us: Value) => {
            const name = (item: Value) =>
                str((isHash(us) ? (us[str(item)] as Stash | undefined) : item as Stash)?.display_name);
            return (Array.isArray(list) ? [...list] : []).map(item => [name(item), item] as const)
                .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0).map(([, item]) => item);
        },
        createdate: mysqlTime(profile.timecreate),
        accttype: profile.accountType,
        linkify,
        linkify_multiple: (r: Value) => {
            if (!Array.isArray(r)) return r;
            if (r.length <= 1) return linkify(r[0]);
            const [join, ...links] = r;
            r.shift();
            return links.filter(truthy).map(linkify).map(str).join(str(join));
        },
        // Links to edit a section are only for its managers.
        cb_links: (opts: Value) => isHash(opts) && Array.isArray(opts.extra) ? [...opts.extra] : [],
        parse_openids: (openids: Value) => parseOpenids(config, openids),
        includeuser: {
            trusted: () => 1, trusted_by: inactiveOk, mutually_trusted: individual, not_mutually_trusted: () => 1,
            not_mutually_trusted_by: inactiveOk,
            watched: (user: Value, types: Value) => {
                const other = profileOf(user);
                if (!other || !str(types).includes(other.journaltype)) return "";
                return str(types) === "C" ? inactiveOk(user) : 1;
            },
            watched_by: inactiveOk, mutually_watched: individual, not_mutually_watched: individual,
            not_mutually_watched_by: inactiveOk, members: () => 1, member_of: inactiveOk, admin_of: inactiveOk,
            posting_access_to: inactiveOk, posting_access_from: () => 1,
        },
    };
}

// A user as the profile templates call it.
function profileUser(site: Site, u: User): Stash {
    const config = site.config;
    const flag = (value: boolean) => value ? 1 : "";
    return {
        ...templateUser(site, u),
        _u: u,
        id: u.userid, userid: u.userid, journaltype: u.journaltype,
        is_community: flag(u.isCommunity()), is_syndicated: flag(u.isSyndicated()), is_identity: flag(u.isIdentity()),
        is_personal: flag(u.isPerson()), is_individual: flag(u.isIndividual()), is_inactive: flag(u.isInactive()),
        display_name: u.displayName(config), display_username: u.displayName(config),
        profile_url: (...args: Value[]) => u.profileUrl(site, args[0] === "full" && truthy(args[1])),
        ljuser_display: (opts: Value) => ljuserDisplay(site, u, isHash(opts) && truthy(opts.no_ljuser_class)),
    };
}

const profileOf = (user: Value): User | undefined => isHash(user) ? user._u as User | undefined : undefined;

// LJ::User::ljuser_display: an OpenID account's own form of LJ::ljuser.
function ljuserDisplay(site: Site, u: User, noLjuserClass: boolean): string {
    if (!u.isIdentity()) return ljuserTag(site, u, { noLjuserClass });
    const config = site.config;
    const id = (u as unknown as { identityRow?: { typeid: string; value: string } | null }).identityRow;
    if (!id) return "<b>????</b>";
    if (id.typeid !== "O") return "<b>????</b>";
    const deleted = !(u.isVisible() || u.isMemorial() || u.isLocked() || u.isReadonly(config));
    const name = ehtml(u.displayName(config) || "[no_name]");
    const url = ehtml(id.value || "about:blank");
    const profile = `${config.siteRoot}/profile?userid=${u.userid}&amp;t=I`;
    const strike = deleted ? " text-decoration: line-through;" : "";
    return `<span${noLjuserClass ? "" : ` lj:user='${name}'`} style='white-space: nowrap;${strike}'` +
        `${noLjuserClass ? "" : " class='ljuser'"}><a href='${profile}'>` +
        `<img src='${config.imgPrefix}/silk/identity/openid.png' alt='[identity profile] ' width='16' height='16'` +
        " style='vertical-align: text-bottom; border: 0; padding-right: 1px;' />" +
        `</a><a href='${url}' rel='nofollow'><b>${name}</b></a></span>`;
}

// DW::Controller::Profile's parse_openids: OpenID accounts by site.
function parseOpenids(config: Site["config"], openids: Value): Stash | undefined {
    if (!truthy(openids) || !Array.isArray(openids)) return undefined;
    const sites: Record<string, Value[]> = {}, shortnames: Record<string, string[]> = {};
    const store = (site: string, user: Value, name: string) => {
        (sites[site] ??= []).push(user);
        (shortnames[site] ??= []).push(name);
    };
    for (const user of openids) {
        const id = str((user as Stash).display_name);
        const parts = id.split(".");
        if (parts.length < 2) {
            store("unknown", user, id);
            continue;
        }
        const last = /\/([^/]+)\/?$/.exec(parts.at(-1)!);
        if (last) {
            store(/([^/.]+\.[^/]+)/.exec(id)?.[1] ?? "", user, last[1]!);
        } else {
            const host = parts.shift()!;
            store(parts.join("."), user, /([^/]+)$/.exec(host)?.[1] ?? "");
        }
    }
    return { sites, shortnames };
}

// LJ::mysql_time in UTC.
function mysqlTime(time: number): string {
    return new Date(time * 1000).toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

// DW::Logic::ProfilePage for an anonymous visitor, loaded ahead of the
// template, which cannot wait on the database.
class ProfilePage {
    timecreate = 0;
    lastUpdated?: string;
    accountType = "";
    showContact = "";
    readonly edgeUsers = new Map<number, User>();
    private data: Stash = {};

    private constructor(private readonly db: Databases, private readonly site: Site, private readonly u: User) {}

    static async load(db: Databases, site: Site, u: User): Promise<ProfilePage> {
        const page = new ProfilePage(db, site, u);
        await page.prepare();
        return page;
    }

    stash(): Stash {
        return {
            ...this.data,
            // DW::Logic::ProfilePage::hide_list
            hide_list: (list: Value) => {
                const name = str(list);
                if (name.startsWith("posting_access")) return 1;
                if (/of_comms$/.test(name)) return this.u.props.opt_hidememberofs ?? "";
                return truthy(this.u.props.opt_hidefriendofs) ? 1 : 0;
            },
            security_image: (code: Value) => this.securityImage(str(code)),
        };
    }

    private ml(code: string, vars: Stash = {}): string {
        return mlText(this.site.config, `/profile/logic.tt${code}`, vars);
    }

    private async prepare(): Promise<void> {
        const { db, site, u } = this;
        const config = site.config;
        const { timecreate, timeupdate } = await u.usage(db);
        this.timecreate = timecreate;
        if (u.isPerson() || u.isCommunity()) {
            this.lastUpdated = timeupdate
                ? mlText(config, "lastupdated.ago",
                    { timestamp: mysqlTime(timeupdate).slice(0, 10), agotext: agoText(config, timeupdate) })
                : mlText(config, "lastupdated.never");
        }
        const paid = await u.paidStatus(db, config);
        this.accountType = str(config.capBits[paid.typeid]?._visible_name);
        this.showContact = await u.optShowcontact(db);

        const [actionLinks, userpic, stats, basicInfo, contacts, bio, interests, services, edges, admins] =
            await Promise.all([
            this.actionLinks(paid), this.userpic(), this.stats(), this.basicInfoRows(), this.contactRows(), this.bio(),
            this.interests(), this.externalServices(), this.populateEdges(), this.admins(),
            ]);
        const ids = [...new Set([...Object.values(edges).flat(), ...admins.maintainers, ...admins.moderators])];
        const users = await User.byIds(db, ids);
        await User.loadIdentities(db, [...users.values()]);
        for (const [id, user] of users) this.edgeUsers.set(id, user);
        this.data = {
            action_links: actionLinks, userpic, ...stats, warnings: this.warnings(), basic_info_rows: basicInfo,
            contact_rows: contacts, bio, interests, external_services: services, populate_edges: edges,
            maintainer_userids: admins.maintainers, moderator_userids: admins.moderators,
        };
    }

    // DW::Logic::ProfilePage::action_links, through DW::Logic::UserLinkBar
    // for a logged-out visitor.
    private async actionLinks(paid: { typeid: string; expires: number }): Promise<Stash[]> {
        const { db, site, u } = this;
        const config = site.config;
        const strings = config.strings;
        const links: Stash[] = [];
        // DW::Logic::UserLinkBar::fix_link
        const add = (link: { url?: string; title: string; image: string; text: string; class?: string }) => {
            const rooted = new RegExp(`^(?:${escapeRe(config.siteRoot)}|${escapeRe(config.siteTemplates.shopRoot)})`);
            links.push({
                url: link.url && !rooted.test(link.url) ? `${config.siteRoot}/${link.url}` : link.url,
                title: strings[link.title] ?? "", text: strings[link.text] ?? "",
                image: link.image.startsWith(config.imgPrefix) && config.imgPrefix ? link.image
                    : `${config.imgPrefix}/silk/profile/${link.image}`,
                class: link.class ? `profile_${link.class}` : undefined, width: 20, height: 18,
            });
        };
        if (u.isCommunity()) {
            const closed = (await u.getCommSettings(db)).membership === "closed";
            add({ text: "userlinkbar.joincomm", image: "community_join_disabled.png", class: "join_disabled disabled",
                title: closed ? "userlinkbar.joincomm.title.closed" : "userlinkbar.joincomm.title.loggedout" });
        }
        if (u.isIndividual()) {
            add({ text: "userlinkbar.addtrust", title: "userlinkbar.addtrust.title.loggedout",
                class: "addtrust_disabled disabled", image: "access_grant_disabled.png" });
        }
        const kind = u.isCommunity() ? "comm" : u.isSyndicated() ? "feed" : "person";
        add({ text: "userlinkbar.addsub", title: "userlinkbar.addsub.title.loggedout",
            class: `addsub_${kind}_disabled disabled`, image: "subscription_add_disabled.png" });
        if (u.isCommunity()) {
            add({ text: "userlinkbar.post", title: "userlinkbar.post.title.loggedout",
                class: "postentry_disabled disabled", image: "post_disabled.png" });
        }
        if (config.enabled.esn) {
            add({
                text: u.isCommunity() ? "userlinkbar.track"
                    : u.isSyndicated() ? "userlinkbar.tracksyn" : "userlinkbar.trackuser",
                title: "userlinkbar.trackuser.title.loggedout", class: "trackuser_disabled disabled",
                image: "track_disabled.png",
            });
        }
        if (u.isIndividual()) {
            add({ text: "userlinkbar.sendmessage", title: "userlinkbar.sendmessage.title.loggedout",
                class: "sendmessage_disabled disabled", image: "message_disabled.png" });
        }
        // The search link needs a logged-in searcher, so is never shown here.
        const type = str(config.capBits[paid.typeid]?._account_type);
        if (config.enabled.payments && (u.isPerson() || u.isCommunity()) && type !== "seed"
            && paid.expires - Date.now() / 1000 < 86400 * 30) {
            const who = u.isCommunity() ? "comm" : "other";
            add({ url: `${config.siteTemplates.shopRoot}/account?for=gift&user=${u.user}`, image: "buy_account.png",
                text: `userlinkbar.buyaccount.${who}`, title: `userlinkbar.buyaccount.title.${who}`, class: "buyaccount" });
        }
        return links;
    }

    // DW::Logic::ProfilePage::userpic
    private async userpic(): Promise<Stash> {
        const { db, site, u } = this;
        const config = site.config;
        const pics = (await Userpics.loadAll(db, [u])).get(u.userid)!;
        const count = pics.all().length;
        let fallback = { src: "", width: "", height: "", alt: "" };
        if (u.isSyndicated()) fallback = { ...fallback, src: `${config.imgPrefix}/profile_icons/feed.png` };
        else {
            const kind = u.isPerson() ? "user" : u.isCommunity() ? "comm" : u.isIdentity() ? "openid" : undefined;
            if (kind) {
                fallback = { src: `${config.imgPrefix}/profile_icons/${kind}.png`, width: "100", height: "100",
                    alt: this.ml(`.userpic.${kind}.alt`) };
            }
        }
        const pic = u.defaultpicid ? pics.get(u.defaultpicid) : undefined;
        let img: string;
        if (pic) {
            // LJ::Userpic::imgtag, with its keywords standing for the keyword.
            const keyword = pic.keywords.length ? pic.keywords.join(", ") : `pic#${pic.picid}`;
            const desc = pic.description;
            const alt = ehtml(`${u.user}:${desc ? ` ${desc}` : ""} (${keyword})`);
            const title = ehtml(`${u.user}: ${keyword}${desc ? ` (${desc})` : ""}`);
            img = `<img src="${config.userpicRoot}/${pic.picid}/${u.userid}" width="${pic.width}" height="${pic.height}"` +
                ` alt="${alt}" title="${title}" class="userpic-img" />`;
        } else {
            img = `<img src="${fallback.src}" height=${fallback.height} width=${fallback.width} alt="${fallback.alt}" />`;
        }
        const link = !u.isSyndicated() && count ? `${u.journalBase(site)}/icons` : undefined;
        return { imgtag: link ? `<a href='${ehtml(link)}'>${img}</a>` : img };
    }

    // DW::Logic::ProfilePage::warnings
    private warnings(): Stash[] {
        const { u, site } = this;
        const out: Stash[] = [];
        const ml = (code: string) => mlText(site.config, code);
        if (u.isLocked()) out.push({ class: "statusvis_msg", text: ml("statusvis_message.locked") });
        else if (u.isMemorial()) out.push({ class: "statusvis_msg", text: ml("statusvis_message.memorial") });
        else if (u.isReadonly(site.config)) out.push({ class: "statusvis_msg", text: ml("statusvis_message.readonly") });
        if (!u.isIdentity()) {
            const level = u.adultContentCalculated();
            if (level === "explicit" || level === "concepts") {
                out.push({ class: "journal_adult_warning", text: this.ml(`.details.warning.${level}`) });
            }
        }
        return out;
    }

    // DW::Logic::ProfilePage's comment, support, entry, tag, memory and icon statistics.
    private async stats(): Promise<Stash> {
        const { db, site, u } = this;
        const config = site.config;
        const counts = await u.counts(db);
        const comma = (n: number) => commafy(config, n);
        const base = u.journalBase(site);
        const comment: string[] = [], support: string[] = [], entry: string[] = [], tag: string[] = [],
            memory: string[] = [], userpic: string[] = [];
        if (!u.isIdentity()) {
            comment.push(this.ml(".details.comments.received2",
                { num_raw: counts.received, num_comma: comma(counts.received) }));
        }
        if (config.enabled["show-talkleft"] && u.isIndividual()) {
            comment.push(this.ml(".details.comments.posted2", { num_raw: counts.posted, num_comma: comma(counts.posted) }));
        }
        if (counts.supportPoints) {
            support.push(this.ml(".details.supportpoints2",
                { aopts: `href="${config.siteRoot}/support/"`, num: comma(counts.supportPoints) }));
        }
        if (!u.isIdentity()) {
            entry.push(this.ml(".details.entries3",
                { num_raw: counts.entries, num_comma: comma(counts.entries), aopts: `href="${base}"` }));
        }
        const tags = config.enabled.tags ? counts.tags : 0;
        if (!u.isIdentity() && !u.isSyndicated()) {
            tag.push(this.ml(".details.tags2", { num_raw: tags, num_comma: comma(tags), aopts: `href="${base}/tag/"` }));
        }
        if (!u.isSyndicated()) {
            memory.push(this.ml(".details.memories2", { num_raw: counts.memories, num_comma: comma(counts.memories),
                aopts: `href='${config.siteRoot}/tools/memories?user=${u.user}'` }));
            const icons = (await Userpics.loadAll(db, [u])).get(u.userid)!.all().length;
            userpic.push(this.ml(".details.userpics.others",
                { uploaded_raw: icons, uploaded_comma: comma(icons), aopts: `href='${base}/icons'` }));
        }
        return { comment_stats: comment, support_stats: support, entry_stats: entry, tag_stats: tag,
            memory_stats: memory, userpic_stats: userpic };
    }

    // DW::Logic::ProfilePage::basic_info_rows
    private async basicInfoRows(): Promise<Value[][]> {
        const u = this.u;
        const rows: Value[][] = [await this.displayNameRow()];
        if (u.isCommunity()) {
            rows.push(await this.locationRow(), await this.websiteRow(), ...await this.communityRows());
        } else if (u.isSyndicated()) {
            rows.push(...await this.syndicationRows());
        } else {
            rows.push(await this.birthdayRow(), await this.locationRow(), await this.websiteRow());
        }
        return rows;
    }

    // DW::Logic::ProfilePage::_basic_info_display_name
    private async displayNameRow(): Promise<Value[]> {
        const { db, site, u } = this;
        const name = ehtml(u.name);
        if (!u.isSyndicated()) return [this.ml(".label.name"), name];
        const url = await u.url(db);
        const [synd] = await db.global("SELECT synurl FROM syndicated WHERE userid = ?", [u.userid]);
        return [this.ml(".label.syndicatedfrom"), " ", url ? { url: ehtml(url), text: name } : { text: name },
            { url: ehtml(text(synd?.synurl)), text: imgTag(site.config, "xml", "", { align: "absmiddle" }) }];
    }

    // DW::Logic::ProfilePage::_basic_info_birthday
    private async birthdayRow(): Promise<Value[]> {
        const { db, site, u } = this;
        if (!u.isIndividual()) return [];
        const bday = await u.bdayString(db, site.config, null);
        if (!bday || !await u.canShareBday(db, null)) return [];
        if (!u.bdate || u.bdate === "0000-00-00") return [];
        const [year, month, day] = u.bdate.split("-");
        const monthName = mlText(site.config, `date.month.${MONTHS[Number(month) - 1] ?? ""}.short`);
        let value = this.securityImage(await u.optSharebday(db));
        if (/\d+-\d+-\d+/.test(bday)) value += `${monthName} ${Number(day)}, ${year}`;
        else if (/\d+-\d+/.test(bday)) value += `${monthName} ${Number(day)}`;
        else value += bday;
        return [this.ml(".label.birthdate"), value];
    }

    // DW::Logic::ProfilePage::_basic_info_location
    private async locationRow(): Promise<Value[]> {
        const { db, site, u } = this;
        const config = site.config;
        if (u.isSyndicated()) return [];
        await u.loadProps(db, ["city", "state", "country"]);
        const { city = "", country = "" } = u.props;
        let state = u.props.state ?? "";
        if (!(city || state || country) || !await u.canShowLocation(db, config, null)) return [];
        const secimg = this.securityImage(await u.optShowlocation(db, config) ?? "");
        const dirurl = `${config.siteRoot}/directorysearch?opt_sort=ut&amp;s_loc=1`;
        const ecountry = eurl(country), ecity = eurl(city);
        let estate = "";
        let cityRet: Stash | undefined, stateRet: Stash | undefined, countryRet: Stash | undefined;
        if (country) {
            countryRet = { text: config.countries[country] };
            if (config.enabled.directory) countryRet.url = `${dirurl}&amp;loc_cn=${ecountry}`;
            if (!state && !city) countryRet.secimg = secimg;
        }
        if (state) {
            const type = config.countriesWithRegions[country];
            state = ehtml(state);
            if (type) {
                const [row] = await db.global("SELECT item FROM codes WHERE type = ? AND code = ?", [type, state]);
                if (row) state = text(row.item);
            }
            estate = eurl(state);
            stateRet = { text: ehtml(state) };
            if (country && config.enabled.directory) stateRet.url = `${dirurl}&amp;loc_cn=${ecountry}&amp;loc_st=${estate}`;
            if (!city) stateRet.secimg = secimg;
        }
        if (city) {
            cityRet = { text: ehtml(city), secimg };
            if (country && config.enabled.directory) {
                cityRet.url = `${dirurl}&amp;loc_cn=${ecountry}&amp;loc_st=${estate}&amp;loc_ci=${ecity}`;
            }
        }
        return [this.ml(".label.location"), ", ", cityRet, stateRet, countryRet];
    }

    // DW::Logic::ProfilePage::_basic_info_website: shown only once the account
    // is over ten days old.
    private async websiteRow(): Promise<Value[]> {
        const { db, u } = this;
        if (u.isSyndicated()) return [];
        let url = await u.url(db);
        if (!url || !(Date.now() / 1000 - 86400 * 10 > this.timecreate)) return [];
        await u.loadProps(db, ["urlname"]);
        url = ehtml(url);
        if (!/^https?:\/\//.test(url)) url = `http://${url.replace(/^http\W*/, "")}`;
        return [this.ml(".label.website"), { url, text: ehtml(u.props.urlname || url) }];
    }

    // DW::Logic::ProfilePage's community membership, posting level and theme rows.
    private async communityRows(): Promise<Value[][]> {
        const { db, u } = this;
        const { membership, postlevel } = await u.getCommSettings(db);
        await u.loadProps(db, ["nonmember_posting", "moderated", "comm_theme"]);
        const member = membership === "moderated" ? ".commsettings.membership.moderated"
            : membership === "closed" ? ".commsettings.membership.closed" : ".commsettings.membership.open";
        let post = this.ml(postlevel === "select" ? ".commsettings.postlevel.select"
            : truthy(u.props.nonmember_posting) ? ".commsettings.postlevel.anybody" : ".commsettings.postlevel.members");
        if (truthy(u.props.moderated)) post += this.ml(".commsettings.postlevel.moderated");
        const rows: Value[][] = [[this.ml(".commsettings.membership.header"), this.ml(member)],
            [this.ml(".commsettings.postlevel.header"), post]];
        rows.push(u.props.comm_theme ? [this.ml(".commdesc.header"), ehtml(u.props.comm_theme)] : []);
        return rows;
    }

    // DW::Logic::ProfilePage's feed status and readers rows.
    private async syndicationRows(): Promise<Value[][]> {
        const { db, site, u } = this;
        const [synd] = await db.global("SELECT lastcheck, laststatus, checknext FROM syndicated WHERE userid = ?",
            [u.userid]);
        const laststatus = text(synd?.laststatus) || "ok";
        let status = `${this.ml(".syn.lastcheck")} ${text(synd?.lastcheck) || this.ml(".syn.last.never")}`;
        const note = ({ parseerror: "Parse error", notmodified: "Not modified", toobig: "Too big",
            posterror: "Posting error" } as Record<string, string>)[laststatus];
        if (note) status += ` (${note})`;
        if (laststatus === "parseerror") {
            await u.loadProps(db, ["rssparseerror"]);
            status += `<br />${this.ml(".syn.parseerror")} ${ehtml(u.props.rssparseerror)}`;
        }
        status += `<br />${this.ml(".syn.nextcheck")} ${text(synd?.checknext)}`;
        const readers = (await u.wtUserids(db, site.config, "watch", true)).length;
        return [[this.ml(".label.syndicatedstatus"), status], [this.ml(".label.syndreadcount"), readers]];
    }

    // DW::Logic::ProfilePage::contact_rows: the addresses the owner shows to
    // anonymous visitors. Private messages need a logged-in sender.
    private async contactRows(): Promise<Stash[]> {
        const { db, site, u } = this;
        if (u.isSyndicated() || !await u.shareContactinfo(db, null)) return [];
        const emails = await u.emailsVisible(db, site.config, null);
        const secimg = emails.length ? this.securityImage(this.showContact) : undefined;
        return emails.map(email => ({ email, secimg }));
    }

    // DW::Logic::ProfilePage::bio
    private async bio(): Promise<string | undefined> {
        const { db, site, u } = this;
        let bio = await u.bio(db);
        if (!bio) return bio;
        if (u.isIdentity()) {
            bio = ehtml(bio).replaceAll("\n", "<br />");
        } else {
            const content = new ContentCleaner(site);
            await content.preload(db, [bio]);
            bio = content.userbio(bio, u.status === "N");
        }
        return expandEmbeds(db, new ContentCleaner(site).site, site.config, u, bio);
    }

    // DW::Logic::ProfilePage::interests: shared ones link to who else has them.
    private async interests(): Promise<Value[]> {
        const { db, site, u } = this;
        return (await u.interests(db)).map(([, name, count]) =>
            count > 1 ? { url: `${site.config.siteRoot}/interests?int=${eurl(name)}`, text: name } : name);
    }

    // DW::Logic::ProfilePage::external_services: other sites' accounts,
    // shown with the owner's contact details.
    private async externalServices(): Promise<Stash[]> {
        const { db, u } = this;
        if (!u.isPerson() || !await u.shareContactinfo(db, null)) return [];
        const services = (await db.global(
            "SELECT service_id, name, userprop, imgfile, title_ml, url_format FROM profile_services"))
            .map(row => ({
                id: int(row.service_id), name: text(row.name), image: text(row.imgfile), titleMl: text(row.title_ml),
                userprop: row.userprop === null ? undefined : text(row.userprop),
                urlFormat: row.url_format === null ? undefined : text(row.url_format),
            }))
            .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
        const info = (account: string, service: typeof services[number]): Stash => ({
            type: service.name, text: ehtml(account), image: service.image, title_ml: service.titleMl,
            url: service.urlFormat === undefined ? undefined : service.urlFormat.replace("%s", eurl(account)),
        });
        const accounts = await u.cluster(db,
            "SELECT service_id, value FROM user_profile_accts WHERE userid = ? ORDER BY value", [u.userid]);
        if (accounts.length) {
            return services.flatMap(service => accounts.filter(row => int(row.service_id) === service.id)
                .map(row => info(text(row.value), service)));
        }
        const props = services.flatMap(service => service.userprop ? [service.userprop] : []);
        await u.loadProps(db, props);
        return services.flatMap(service => service.userprop && u.props[service.userprop]
            ? [info(u.props[service.userprop]!, service)] : []);
    }

    // DW::Logic::ProfilePage::populate_edges for an anonymous visitor.
    private async populateEdges(): Promise<Record<string, number[]>> {
        const { db, site, u } = this;
        const config = site.config;
        const edges: Record<string, number[]> = {};
        const forceEmpty = config.forceEmptySubscriptions.includes(u.userid);
        const [watched, watchedBy, trusted, trustedBy] = await Promise.all([
            u.wtUserids(db, config, "watch"), u.wtUserids(db, config, "watch", true),
            u.wtUserids(db, config, "trust"), u.wtUserids(db, config, "trust", true),
        ]);
        const without = (list: number[], others: number[]) => list.filter(id => !others.includes(id));
        const both = (list: number[], others: number[]) => [...new Set(list.filter(id => others.includes(id)))];
        if (u.isIdentity()) edges.trusted_by = trustedBy;
        if (u.isIndividual() && truthy(u.props.opt_showmutualfriends)) {
            if (u.isPerson()) {
                edges.mutually_trusted = both(trustedBy, trusted);
                edges.not_mutually_trusted = without(trusted, trustedBy);
                edges.not_mutually_trusted_by = without(trustedBy, trusted);
            }
            edges.mutually_watched = both(watchedBy, watched);
            edges.not_mutually_watched = without(watched, watchedBy);
            edges.not_mutually_watched_by = without(watchedBy, watched);
            edges.watched = watched;
        } else {
            if (u.isPerson()) {
                edges.trusted = trusted;
                edges.trusted_by = trustedBy;
            }
            if (u.isIndividual()) edges.watched = watched;
            if (!forceEmpty && !truthy(u.props.opt_hidefriendofs)) edges.watched_by = watchedBy;
        }
        if (u.isCommunity() && !forceEmpty) {
            edges.members = await u.relUserids(db, "E");
            edges.posting_access_from = await u.relUserids(db, "P");
        }
        if (u.isPerson()) {
            edges.member_of = await u.relTargetUserids(db, "E");
            edges.admin_of = await u.relTargetUserids(db, "A");
            edges.posting_access_to = await u.relTargetUserids(db, "P");
        }
        const banned = new Set(await u.relUserids(db, "B"));
        for (const key of Object.keys(edges)) edges[key] = edges[key]!.filter(id => !banned.has(id));
        return edges;
    }

    // LJ::Community's maintainer_userids and moderator_userids.
    private async admins(): Promise<{ maintainers: number[]; moderators: number[] }> {
        const { db, u } = this;
        if (!u.isCommunity()) return { maintainers: [], moderators: [] };
        await u.loadProps(db, ["moderated"]);
        return {
            maintainers: await u.relUserids(db, "A"),
            moderators: truthy(u.props.moderated) ? await u.relUserids(db, "M") : [],
        };
    }

    // DW::Logic::ProfilePage::security_image: an icon for who may see a detail.
    private securityImage(code: string): string {
        const images: Record<string, [string, string]> = {
            R: ["registered", "identity/user.png"], F: ["trusted", "entry/locked.png"], N: ["private", "entry/private.png"],
        };
        const image = images[code];
        if (!image) return "";
        const label = `${mlText(this.site.config, "entryform.security")} ${image[0]}`;
        return `&nbsp;(<img alt='${label}' title='${label}' width='16' height='16' style='vertical-align: bottom'` +
            ` src='${this.site.config.siteRoot}/img/silk/${image[1]}' />)&nbsp;&nbsp;`;
    }
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
    "november", "december"];

// LJ::commafy
function commafy(config: Site["config"], n: number): string {
    const punctuation = config.strings["number.punctuation"] || ",";
    return String(n).replace(/(?<=\d)(?=(\d\d\d)+(?!\d))/g, punctuation);
}

// LJ::diff_ago_text and LJ::Lang::ago_text
function agoText(config: Site["config"], last: number): string {
    const seconds = Math.floor(Date.now() / 1000) - last || 1;
    const ml = (unit: string, num: number) => mlText(config, `time.ago.${unit}`, { num });
    if (seconds >= 604800) return ml("week", Math.floor(seconds / 604800));
    if (seconds >= 86400) return ml("day", Math.floor(seconds / 86400));
    if (seconds >= 3600) return ml("hour", Math.floor(seconds / 3600));
    if (seconds >= 60) return ml("minute", Math.floor(seconds / 60));
    return ml("second", seconds);
}

function escapeRe(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
