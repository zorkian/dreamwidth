// session.ts
//
// Who the viewer is, as LJ::Session finds a logged-in session from the
// request's cookies. Read-only: renewing a session, and sending a visitor
// without a journal domain cookie to get one, are left to Perl.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { SiteConfig } from "../server/config";
import { type Databases, type Row, int, text } from "./db";
import { User } from "./user";

// LJ::Session::VERSION
const VERSION = 1;

export interface SessionRequest {
    // The Host header and the path, from which LJ::Session::domain_cookie names
    // the cookie to read.
    readonly host: string;
    readonly path: string;
    readonly cookie: string;
    // LJ::get_remote_ip, or undefined when this server cannot tell it.
    readonly remoteIp?: string;
}

export class Session {
    readonly sessid: number;
    readonly auth: string;
    readonly exptype: string;
    readonly timeexpire: number;
    readonly ipfixed: string;
    // Set when the session is bound to an IP address this server could not
    // check; such a session is logged in for all this server can tell, but
    // not one it may act on.
    ipUnverified = false;

    private constructor(readonly owner: User, row: Row) {
        this.sessid = int(row.sessid);
        this.auth = text(row.auth);
        this.exptype = text(row.exptype);
        this.timeexpire = int(row.timeexpire);
        this.ipfixed = text(row.ipfixed);
    }

    // LJ::Session::instance
    static async instance(db: Databases, u: User | null | undefined, sessid: number): Promise<Session | undefined> {
        if (!u || u.isExpunged() || !sessid) return undefined;
        const [row] = await u.cluster(db, `SELECT sessid, auth, exptype, timeexpire, ipfixed
            FROM sessions WHERE userid = ? AND sessid = ?`, [u.userid, sessid]);
        return row ? new Session(u, row) : undefined;
    }

    // LJ::Session::session_from_cookies, without the redirect Perl gives
    // a journal visitor who has no domain cookie yet.
    static async fromCookies(db: Databases, config: SiteConfig, request: SessionRequest): Promise<Session | null> {
        const cookies = parseCookies(request.cookie);
        const domcook = Session.domainCookie(config, request.host, request.path);
        if (domcook) return Session.fromDomainCookie(db, config, request, cookies, domcook);
        let values = cookies.get("ljmastersession") ?? [];
        // Old clients send the "ljsession" cookie LJ::Protocol's generatesession made.
        const oldCookie = !values.length;
        if (oldCookie) values = cookies.get("ljsession") ?? [];
        return Session.fromMasterCookie(db, config, request, cookies, values, oldCookie);
    }

    // LJ::Session::session_from_master_cookie
    private static async fromMasterCookie(db: Databases, config: SiteConfig, request: SessionRequest,
        cookies: Cookies, values: readonly string[][], oldCookie: boolean): Promise<Session | null> {
        const loggedIn = cookies.get("ljloggedin")?.[0]?.[0];
        for (const value of values) {
            const parsed = parseSessionCookie(value[0] ?? "", "vusaf");
            if (!parsed || !validCookieGeneration(config, parsed.gen)) continue;
            if (perlNumber(parsed.fields.v) !== VERSION) continue;
            const u = await loadUserid(db, parsed.fields.u);
            // Locked accounts can't be logged in.
            if (!u || u.isLocked()) continue;
            const sess = await Session.instance(db, u, int(parsed.fields.s));
            if (!sess || !sameSecret(sess.auth, parsed.fields.a ?? "")) continue;
            if (!await sess.valid(db, request.remoteIp)) continue;
            if (!oldCookie && sess.loggedinCookieString() !== loggedIn) continue;
            return sess;
        }
        return null;
    }

    // LJ::Session::session_from_domain_cookie and valid_domain_cookie
    private static async fromDomainCookie(db: Databases, config: SiteConfig, request: SessionRequest,
        cookies: Cookies, domcook: string): Promise<Session | null> {
        const loggedIn = cookies.get("ljloggedin")?.[0]?.[0];
        if (!loggedIn) return null;
        for (const value of cookies.get(domcook) ?? []) {
            const parsed = parseSessionCookie(value[0] ?? "", "vustgf");
            if (!parsed || !validCookieGeneration(config, parsed.gen)) continue;
            const { v, u: uid, s, t, g } = parsed.fields;
            if (perlNumber(v) !== VERSION) continue;
            // These are refreshed daily, so one over a week old is stale.
            if (!(perlNumber(t) > Date.now() / 1000 - 86400 * 7)) continue;
            const u = await loadUserid(db, uid);
            const sess = await Session.instance(db, u, int(s));
            if (!sess || !await sess.valid(db, request.remoteIp)) continue;
            if (sess.loggedinCookieString() !== loggedIn) continue;
            if (!sameSecret(await domsessSignature(db, t ?? "", sess, domcook), g ?? "")) continue;
            return sess;
        }
        return null;
    }

    // LJ::Session::domain_cookie: the cookie a journal subdomain keeps its
    // session in, or undefined on the main site, which uses the master cookie.
    static domainCookie(config: SiteConfig, host: string, path: string): string | undefined {
        const name = host.toLowerCase();
        if (name === config.domainWeb.toLowerCase() || name === config.domain.toLowerCase()) return undefined;
        const domain = config.userDomain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const match = new RegExp(`^([-\\w.]{1,50})\\.${domain}$`).exec(name);
        if (!match) return undefined;
        const subdomain = match[1]!.toLowerCase();
        if (config.subdomainFunction[subdomain] !== "journal") return `ljdomsess.${subdomain}`;
        const user = new RegExp(`^/(\\w{1,${config.siteTemplates.constants.maxlength_user ?? 25}})\\b`).exec(path)?.[1];
        return user ? `ljdomsess.${subdomain}.${user.toLowerCase()}` : undefined;
    }

    // LJ::Session::loggedin_cookie_string
    loggedinCookieString(): string {
        return `u${this.owner.userid}:s${this.sessid}`;
    }

    // LJ::Session::valid: not expired, from the IP address it is bound to,
    // and past any second factor the account requires.
    async valid(db: Databases, remoteIp: string | undefined): Promise<boolean> {
        if (this.timeexpire < Date.now() / 1000) return false;
        if (this.ipfixed) {
            if (remoteIp === undefined) this.ipUnverified = true;
            else if (this.ipfixed !== remoteIp) return false;
        }
        return sessionVerified(db, this);
    }

    // The viewer this session logs in, unless its IP address went unchecked.
    remote(): User | null {
        return this.ipUnverified ? null : this.owner;
    }
}

// DW::Auth::TOTP::session_verified: an account with a second factor needs a
// session that has proven it.
async function sessionVerified(db: Databases, sess: Session): Promise<boolean> {
    // MySQL hashes the stored (encrypted) secret, so it never reaches this process.
    const [password] = await db.global("SELECT SHA2(totp_secret, 256) AS factor FROM password2 WHERE userid = ?",
        [sess.owner.userid]);
    if (password?.factor === null || password?.factor === undefined) return true;
    const factor = text(password.factor);
    const [proof] = await sess.owner.cluster(db, "SELECT factor, expires FROM mfa_sessions WHERE userid = ? AND sessid = ?",
        [sess.owner.userid, sess.sessid]);
    return !!proof && int(proof.expires) > Date.now() / 1000 && sameSecret(text(proof.factor), factor);
}

// Equality for auth values and signatures that takes the same time however
// much of the input matches.
export function sameSecret(a: string, b: string): boolean {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
}

// LJ::Session::domsess_signature. A time with no secret signs with an empty
// key, as LJ::get_secret then gives none.
async function domsessSignature(db: Databases, time: string, sess: Session, domcook: string): Promise<string> {
    const [row] = await db.global("SELECT secret FROM secrets WHERE stime = ?", [Math.trunc(perlNumber(time))]);
    return createHmac("sha1", text(row?.secret))
        .update([sess.auth, domcook, sess.owner.userid, sess.sessid, time].join("-")).digest("hex");
}

// LJ::Session::valid_cookie_generation
function validCookieGeneration(config: SiteConfig, gen: string): boolean {
    const decoded = unescape(gen);
    return config.trustCookie.generations.some(okay => gen === okay || decoded === okay);
}

// LJ::load_userid, for an id from a cookie.
async function loadUserid(db: Databases, id: string | undefined): Promise<User | undefined> {
    const userid = Math.trunc(perlNumber(id));
    return userid > 0 ? (await User.byIds(db, [userid])).get(userid) : undefined;
}

// A cookie's "x1:y2//gen" fields, as LJ::Session reads them: undefined when
// one is not a known letter followed by a value.
function parseSessionCookie(value: string, letters: string):
    { fields: Record<string, string | undefined>; gen: string } | undefined {
    const [cookie = "", gen = ""] = value.split("//");
    const parts = cookie.split(":");
    while (parts.length && parts.at(-1) === "") parts.pop();
    const fields: Record<string, string | undefined> = {};
    for (const part of parts) {
        const match = /^(\w)(.+)$/.exec(part);
        if (!match || !letters.includes(match[1]!)) return undefined;
        fields[match[1]!] = match[2];
    }
    return { fields, gen };
}

// Perl's numeric value of a string: its leading number, or 0.
function perlNumber(value: string | undefined): number {
    return Number.parseFloat(value ?? "") || 0;
}

type Cookies = Map<string, string[][]>;

// DW::Request::Base::parse: every value of each cookie, as cookie_multi
// gives them, each split on & and ; and unescaped.
export function parseCookies(header: string): Cookies {
    const cookies: Cookies = new Map();
    for (const pair of header.split(/[;,] ?/)) {
        const trimmed = pair.replace(/^\s*/, "");
        const at = trimmed.indexOf("=");
        if (at < 0) continue;
        const value = trimmed.slice(at + 1);
        const values = value === "" ? [] : value.split(/[&;]/).map(unescape);
        const key = unescape(trimmed.slice(0, at));
        cookies.set(key, [...cookies.get(key) ?? [], values]);
    }
    return cookies;
}

// CGI::Util::unescape
function unescape(value: string): string {
    const bytes = Buffer.from(value.replaceAll("+", " ").replace(/%([0-9a-fA-F]{2})/g,
        (_, hex: string) => String.fromCharCode(parseInt(hex, 16))), "latin1");
    return bytes.toString("utf8");
}
