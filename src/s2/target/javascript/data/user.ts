// user.ts
//
// Journal accounts, as LJ::User loads them.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import type { SiteConfig } from "../server/config";
import { type Databases, type Row, int, text } from "./db";
import { truthy } from "./entry";

interface PropInfo {
    readonly id: number;
    readonly name: string;
    readonly indexed: boolean;
    readonly cldversion: number;
    readonly multihomed: boolean;
    readonly blob: boolean;
}

const propLists = new WeakMap<Databases, Promise<Map<string, PropInfo>>>();

function propList(db: Databases): Promise<Map<string, PropInfo>> {
    let list = propLists.get(db);
    if (!list) {
        list = db.global("SELECT upropid, name, indexed, cldversion, multihomed, datatype FROM userproplist")
            .then(rows => new Map(rows.map(row => {
                const name = text(row.name);
                return [name, {
                    id: int(row.upropid), name, indexed: int(row.indexed) === 1,
                    cldversion: int(row.cldversion), multihomed: int(row.multihomed) === 1,
                    blob: text(row.datatype) === "blobchar",
                }];
            })));
        propLists.set(db, list);
    }
    return list;
}

// A trust group, as DW::User::Edges::WatchTrust::trust_groups gives one.
export interface TrustGroup {
    readonly groupnum: number;
    readonly groupname: string;
    readonly sortorder: number;
    readonly isPublic: boolean;
}

// LJ::check_rel for a one-letter relationship: whether `target` has
// relationship `type` with `user`, such as A for an administrator or E for
// a member of a community.
async function checkRel(db: Databases, user: User, target: User, type: string): Promise<boolean> {
    const rows = await db.global("SELECT 1 FROM reluser WHERE userid = ? AND targetid = ? AND type = ?",
        [user.userid, target.userid, type]);
    return rows.length > 0;
}

// LJ::calc_age for a YYYY-MM-DD date, in UTC; 0 when unknown.
function calcAge(date: string): number {
    const match = /^(\d{4})-(\d\d)-(\d\d)/.exec(date);
    if (!match) return 0;
    const [year, month, day] = match.slice(1).map(Number) as [number, number, number];
    if (!year) return 0;
    const now = new Date();
    let age = now.getUTCFullYear() - year;
    if (month) {
        if (now.getUTCMonth() + 1 < month) age -= 1;
        else if (day && now.getUTCMonth() + 1 === month && now.getUTCDate() < day) age -= 1;
    }
    return age > 0 ? age : 0;
}

// The request host, which devcontainer journal URLs are built from.
export interface Site {
    readonly config: SiteConfig;
    readonly host: string;
}

export class User {
    readonly userid: number;
    readonly user: string;
    readonly name: string;
    readonly clusterid: number;
    readonly journaltype: string;
    readonly statusvis: string;
    // The email status: A when validated.
    readonly status: string;
    readonly bdate: string;
    readonly allowContactshow: string;
    readonly allowInfoshow: string;
    readonly dversion: number;
    readonly caps: number;
    readonly defaultpicid: number;
    readonly moodthemeid: number;
    readonly optShowtalklinks: string;
    readonly optForcemoodtheme: string;
    readonly optWhocanreply: string;
    readonly props: Record<string, string> = {};

    constructor(row: Row) {
        this.userid = int(row.userid);
        this.user = text(row.user);
        this.name = text(row.name);
        this.clusterid = int(row.clusterid);
        this.journaltype = text(row.journaltype);
        this.statusvis = text(row.statusvis);
        this.status = text(row.status);
        this.bdate = text(row.bdate);
        this.allowContactshow = text(row.allow_contactshow);
        this.allowInfoshow = text(row.allow_infoshow);
        this.dversion = int(row.dversion);
        this.caps = int(row.caps);
        this.defaultpicid = int(row.defaultpicid);
        this.moodthemeid = int(row.moodthemeid);
        this.optShowtalklinks = text(row.opt_showtalklinks);
        this.optForcemoodtheme = text(row.opt_forcemoodtheme);
        this.optWhocanreply = text(row.opt_whocanreply);
    }

    static async byName(db: Databases, user: string): Promise<User | null> {
        const rows = await db.global("SELECT * FROM user WHERE user = ?", [user]);
        return rows[0] ? new User(rows[0]) : null;
    }

    static async byIds(db: Databases, ids: readonly number[]): Promise<Map<number, User>> {
        const rows = ids.length ? await db.global("SELECT * FROM user WHERE userid IN (?)", [ids]) : [];
        return new Map(rows.map(row => [int(row.userid), new User(row)]));
    }

    // LJ::get_cap: the largest value any of the user's classes grants.
    getCap(config: SiteConfig, name: string): unknown {
        let max: unknown;
        for (const [bit, caps] of Object.entries(config.capBits)) {
            if (!(this.caps & (1 << Number(bit)))) continue;
            const value = caps[name];
            if (value === undefined || value === null) continue;
            if (max !== undefined && Number(max) > Number(value)) continue;
            max = value;
        }
        return max ?? config.capDefaults[name];
    }

    // LJ::User::should_block_robots. Needs opt_blockrobots and adult_content loaded.
    shouldBlockRobots(config: SiteConfig): boolean {
        return this.journaltype === "Y" || this.journaltype === "I" 
            || !!this.props.opt_blockrobots && this.props.opt_blockrobots !== "0"
            || config.robotBlockingContent.includes(this.props.adult_content ?? "");
    }

    // LJ::User::equals
    equals(other: User | null | undefined): boolean {
        return !!other && other.userid === this.userid;
    }

    // LJ::User::is_visible
    isVisible(): boolean {
        return this.statusvis === "V";
    }

    // LJ::User::is_suspended
    isSuspended(): boolean {
        return this.statusvis === "S";
    }

    // LJ::User::is_locked
    isLocked(): boolean {
        return this.statusvis === "L";
    }

    // LJ::User::is_memorial
    isMemorial(): boolean {
        return this.statusvis === "M";
    }

    // LJ::User::is_readonly
    isReadonly(config: SiteConfig): boolean {
        return this.statusvis === "O" || truthy(this.getCap(config, "readonly"));
    }

    // LJ::User::is_expunged
    isExpunged(): boolean {
        return this.statusvis === "X" || this.clusterid === 0;
    }

    // LJ::User::is_inactive: deleted, expunged or suspended.
    isInactive(): boolean {
        return this.statusvis === "D" || this.statusvis === "X" || this.statusvis === "S";
    }

    // LJ::User::is_validated
    isValidated(): boolean {
        return this.status === "A";
    }

    // LJ::User::is_person
    isPerson(): boolean {
        return this.journaltype === "P";
    }

    // LJ::User::is_identity
    isIdentity(): boolean {
        return this.journaltype === "I";
    }

    // LJ::User::is_community
    isCommunity(): boolean {
        return this.journaltype === "C";
    }

    // LJ::User::is_individual
    isIndividual(): boolean {
        return this.isPerson() || this.isIdentity();
    }

    // DW::User::Edges::WatchTrust::trustmask: the groups this user puts `other`
    // in, bit 0 being general access, without the reserved and watch bits.
    async trustmask(db: Databases, other: User): Promise<bigint> {
        const [row] = await db.global(
            "SELECT CAST(groupmask AS CHAR) AS groupmask FROM wt_edges WHERE from_userid = ? AND to_userid = ?",
            [this.userid, other.userid]);
        return BigInt(text(row?.groupmask) || "0") & ~(7n << 61n);
    }

    // DW::User::Edges::WatchTrust::trusts
    async trusts(db: Databases, other: User): Promise<boolean> {
        if (this.userid === other.userid) return true;
        return (await this.trustmask(db, other) & 1n) === 1n;
    }

    // DW::User::Edges::WatchTrust::trust_groups, sorted by sort order and then name.
    async trustGroups(db: Databases): Promise<TrustGroup[]> {
        const rows = await db.global(
            "SELECT groupnum, groupname, sortorder, is_public FROM trust_groups WHERE userid = ?", [this.userid]);
        return rows.map(row => ({
            groupnum: int(row.groupnum), groupname: text(row.groupname), sortorder: int(row.sortorder),
            isPublic: text(row.is_public) === "1",
        })).sort((a, b) => a.sortorder - b.sortorder
            || (a.groupname < b.groupname ? -1 : a.groupname > b.groupname ? 1 : 0));
    }

    // DW::User::Edges::CommMembership::member_of
    async isMemberOf(db: Databases, community: User): Promise<boolean> {
        if (!this.isIndividual() || !community.isCommunity()) return false;
        return checkRel(db, community, this, "E");
    }

    // LJ::User::trusts_or_has_member
    async trustsOrHasMember(db: Databases, other: User): Promise<boolean> {
        return this.isCommunity() ? other.isMemberOf(db, this) : this.trusts(db, other);
    }

    // LJ::User::can_manage
    async canManage(db: Databases, target: User): Promise<boolean> {
        if (this.equals(target)) return true;
        if (/^[PYR]$/.test(target.journaltype)) return false;
        return checkRel(db, target, this, "A");
    }

    // LJ::User::has_priv: whether the user has the privilege, with `arg`
    // or with "*" when one is given.
    async hasPriv(db: Databases, priv: string, arg?: string): Promise<boolean> {
        const rows = await db.global(`SELECT pm.arg FROM priv_map pm JOIN priv_list pl ON pm.prlid = pl.prlid
            WHERE pm.userid = ? AND pl.privcode = ?`, [this.userid, priv]);
        if (!rows.length) return false;
        if (arg === undefined) return true;
        return rows.some(row => text(row.arg) === arg || text(row.arg) === "*");
    }

    // LJ::User::best_guess_age: from the age given at signup, else the birthdate.
    async bestGuessAge(db: Databases): Promise<number> {
        if (!this.isPerson() && !this.isIdentity()) return 0;
        await this.loadProps(db, ["init_bdate"]);
        return calcAge(this.props.init_bdate ?? "") || calcAge(this.bdate);
    }

    // LJ::User::is_minor: known to be under 18.
    async isMinor(db: Databases): Promise<boolean> {
        const age = await this.bestGuessAge(db);
        return age > 0 && age < 18;
    }

    // LJ::User::is_syndicated
    isSyndicated(): boolean {
        return this.journaltype === "Y";
    }

    // LJ::User::opt_showcontact: who may see contact details, N, Y, R
    // (logged-in users) or F (trusted users).
    async optShowcontact(db: Databases): Promise<string> {
        if (/^[NYRF]$/.test(this.allowContactshow)) return this.allowContactshow;
        return await this.isMinor(db) ? "F" : "Y";
    }

    // LJ::User::share_contactinfo
    async shareContactinfo(db: Databases, remote: User | null): Promise<boolean> {
        if (this.isSyndicated()) return false;
        const show = await this.optShowcontact(db);
        if (show === "N" || show === "R" && !remote) return false;
        if (show === "F" && !(remote && await this.trusts(db, remote))) return false;
        return true;
    }

    // LJ::User::can_have_email_alias
    canHaveEmailAlias(config: SiteConfig): boolean {
        return config.userEmail && truthy(this.getCap(config, "useremail"));
    }

    // LJ::User::opt_whatemailshow: which addresses to show, A (actual), D
    // (display), L (site alias), B (actual and alias), V (display and
    // alias) or N (none).
    async optWhatemailshow(db: Databases, config: SiteConfig): Promise<string> {
        await this.loadProps(db, ["opt_whatemailshow"]);
        let value = this.props.opt_whatemailshow ?? "";
        if (!this.canHaveEmailAlias(config)) value = value.replace(/[BVL]/g, c => ({ B: "A", V: "D", L: "N" })[c]!);
        return /^[ALBNDV]$/.test(value) ? value : "N";
    }

    // LJ::User::emails_visible
    async emailsVisible(db: Databases, config: SiteConfig, remote: User | null): Promise<string[]> {
        if (this.isIdentity() || this.isSyndicated()) return [];
        if (!await this.shareContactinfo(db, remote)) return [];
        const what = await this.optWhatemailshow(db, config);
        if (what === "N" || await this.hidesContactinfo(db, config)) return [];
        await this.loadProps(db, ["opt_profileemail", "no_mail_alias"]);
        const emails: string[] = [];
        if (what === "A" || what === "B") {
            const [row] = await db.global("SELECT email FROM email WHERE userid = ?", [this.userid]);
            if (text(row?.email)) emails.push(text(row!.email));
        } else if ((what === "D" || what === "V") && this.props.opt_profileemail) {
            emails.push(this.props.opt_profileemail);
        }
        if (/^[BVL]$/.test(what) && !truthy(this.props.no_mail_alias)) emails.push(`${this.user}@${config.userDomain}`);
        return emails;
    }

    // LJ::User::emails_visible's rule that some accounts hide their contact
    // details once inactive for longer than their hide_email_after cap.
    private async hidesContactinfo(db: Databases, config: SiteConfig): Promise<boolean> {
        if (config.isDevServer) return false;
        const hideAfter = Number(this.getCap(config, "hide_email_after")) || 0;
        if (!hideAfter) return false;
        const [row] = await this.cluster(db, "SELECT timeactive FROM clustertrack2 WHERE userid = ?", [this.userid]);
        const active = int(row?.timeactive);
        return !!active && Date.now() / 1000 - active > hideAfter * 86400;
    }

    // LJ::User::email_for_feeds. Its opt_mangleemail check is left out, as
    // there is no such userprop here, so Perl never hides the address for it.
    async emailForFeeds(db: Databases, config: SiteConfig, remote: User | null): Promise<string | undefined> {
        return (await this.emailsVisible(db, config, remote))[0];
    }

    // LJ::User::adult_content_calculated. Needs adult_content loaded.
    adultContentCalculated(): string {
        return this.props.adult_content || "none";
    }

    // LJ::User::hide_adult_content: none, concepts or explicit.
    async hideAdultContent(db: Databases): Promise<string> {
        await this.loadProps(db, ["hide_adult_content"]);
        const value = this.props.hide_adult_content ?? "";
        if (!await this.bestGuessAge(db)) return "concepts";
        if (await this.isMinor(db) && value !== "concepts") return "explicit";
        return value || "none";
    }

    // LJ::User::preload_props
    async loadProps(db: Databases, names: readonly string[]): Promise<void> {
        const list = await propList(db);
        const sources = new Map<string, number[]>();
        for (const name of names) {
            const info = list.get(name);
            if (!info) throw new Error(`Unknown userprop ${name}`);
            const table = info.blob ? "userpropblob"
                : (info.cldversion && this.dversion >= info.cldversion) || info.multihomed ? "userproplite2"
                    : info.indexed ? "userprop" : "userproplite";
            sources.set(table, [...(sources.get(table) ?? []), info.id]);
        }
        const byId = new Map([...list.values()].map(info => [info.id, info.name]));
        for (const [table, ids] of sources) {
            const sql = `SELECT upropid, value FROM ${table} WHERE userid = ? AND upropid IN (?)`;
            const rows = table === "userproplite2" || table === "userpropblob"
                ? await this.cluster(db, sql, [this.userid, ids])
                : await db.global(sql, [this.userid, ids]);
            for (const row of rows) this.props[byId.get(int(row.upropid))!] = text(row.value);
        }
        // Multihomed props not yet copied to the cluster still live globally.
        const missing = names.filter(name => list.get(name)!.multihomed && !(name in this.props));
        if (missing.length) {
            const rows = await db.global("SELECT upropid, value FROM userprop WHERE userid = ? AND upropid IN (?)",
                [this.userid, missing.map(name => list.get(name)!.id)]);
            for (const row of rows) this.props[byId.get(int(row.upropid))!] = text(row.value);
        }
    }

    cluster(db: Databases, sql: string, params: unknown[] = []): Promise<Row[]> {
        return db.cluster(this.clusterid, sql, params);
    }

    journalBase(site: Site): string {
        return journalBase(site, this.user, this.journaltype);
    }
}

// LJ::journal_base, which treats a user that does not exist as personal.
export function journalBase(site: Site, user: string, journaltype = "P"): string {
    const { config } = site;
    const rule = config.subdomainRules[journaltype] ?? config.subdomainRules.P!;
    if (rule[0] && !/^_|_$/.test(user)) return `${config.protocol}://${user.replaceAll("_", "-")}.${config.domain}`;
    if (!rule[1] && config.isDevServer) return `${config.protocol}://${site.host}/~${user}`;
    return `${config.protocol}://${rule[1]}/${user}`;
}
