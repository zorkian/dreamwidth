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
    readonly dversion: number;
    readonly caps: number;
    readonly defaultpicid: number;
    readonly moodthemeid: number;
    readonly optShowtalklinks: string;
    readonly optForcemoodtheme: string;
    readonly props: Record<string, string> = {};

    constructor(row: Row) {
        this.userid = int(row.userid);
        this.user = text(row.user);
        this.name = text(row.name);
        this.clusterid = int(row.clusterid);
        this.journaltype = text(row.journaltype);
        this.statusvis = text(row.statusvis);
        this.dversion = int(row.dversion);
        this.caps = int(row.caps);
        this.defaultpicid = int(row.defaultpicid);
        this.moodthemeid = int(row.moodthemeid);
        this.optShowtalklinks = text(row.opt_showtalklinks);
        this.optForcemoodtheme = text(row.opt_forcemoodtheme);
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

    isVisible(): boolean {
        return this.statusvis === "V";
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

    // LJ::journal_base
    journalBase(site: Site): string {
        const { config } = site;
        const rule = config.subdomainRules[this.journaltype] ?? config.subdomainRules.P!;
        if (rule[0] && !/^_|_$/.test(this.user)) {
            return `${config.protocol}://${this.user.replaceAll("_", "-")}.${config.domain}`;
        }
        if (!rule[1] && config.isDevServer) return `${config.protocol}://${site.host}/~${this.user}`;
        return `${config.protocol}://${rule[1]}/${this.user}`;
    }
}
