// mysql.ts
//
// Bounded primary MySQL snapshot for the local live S2 journal.
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

import { createHash } from "node:crypto";
import { Kysely, MysqlDialect, sql } from "kysely";
import mysql from "mysql2";
import type {
    LocalSecret, LocalSecretSource, PublicSettingName, PublicSettings, RawEntry,
    RawFeatureCounts, RawJournalSnapshot, RawRecentRepository, RawStyle, RawUser,
} from "../contracts";
import { EntryRecord, UserRecord } from "../domain/records";
import { SnapshotError } from "./errors";
import { decodeLegacyText } from "./legacy-text";

type Connection = Kysely<Record<string, never>>;
type Row = Record<string, unknown>;

export interface MysqlStoreConfig {
    readonly host: "127.0.0.1";
    readonly port: number;
    readonly user: string;
    readonly password: string;
}

const PUBLIC_SETTINGS = [
    "stylesys", "s2_style", "journaltitle", "journalsubtitle",
    "url", "urlname", "adult_content", "adult_content_reason",
    "control_strip_display", "control_strip_color", "sticky_entry",
    "show_control_strip", "view_control_strip",
    "customtext_title", "customtext_url", "customtext_content",
    "opt_blockrobots", "opt_allowsearchby", "opt_blockglobalsearch",
    "opt_ctxpopup", "opt_no_quickreply", "opt_show_captcha_to",
    "opt_whoscreened", "opt_usermsg", "opt_usesharedpic", "opt_tagpermissions",
    "opt_embedplaceholders", "opt_imagelinks", "opt_imageundef",
    "opt_maxpicheight", "opt_maxpicwidth", "icbm", "timezone",
    "renamedto", "google_analytics", "ga4_analytics", "exclude_from_own_stats",
    "use_journalstyle_entry_page", "use_journalstyle_icons_page",
] as const satisfies readonly PublicSettingName[];

const GLOBAL_TABLES = [
    "user", "useridmap", "userprop", "userproplist", "s2styles", "s2layers",
    "s2compiled", "s2source_inno", "logproplist", "secrets",
] as const;
const CLUSTER_TABLES = [
    "userbio", "userproplite2", "s2stylelayers2", "log2", "logtext2", "logprop2",
    "usertags", "userkeywords", "logtags", "logtagsrecent", "logkwsum",
    "links", "userpic2", "talk2",
] as const;

function unsupported(): never { throw new SnapshotError("unsupported"); }

function number(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
    const parsed = typeof value === "number" ? value :
        typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) unsupported();
    return parsed;
}

function unsigned(value: unknown, bits: number): string {
    if ((typeof value !== "string" && typeof value !== "number" &&
        typeof value !== "bigint") || !/^\d+$/.test(String(value))) unsupported();
    const parsed = BigInt(value);
    if (parsed < 0n || parsed >= (1n << BigInt(bits))) unsupported();
    return parsed.toString(10);
}

function requiredString(value: unknown): string {
    if (typeof value !== "string") unsupported();
    return value;
}

function civilTime(value: unknown): string {
    const text = requiredString(value);
    if (!/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]) (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(text)) {
        unsupported();
    }
    return text;
}

function nullRecord<T extends string>(keys: readonly T[]): Record<T, string | null> {
    const record = Object.create(null) as Record<T, string | null>;
    for (const key of keys) record[key] = null;
    return record;
}

function sortedRecord(record: Readonly<Record<string, string | null>>): [string, string | null][] {
    return Object.keys(record).sort().map(key => [key, record[key] ?? null]);
}

function fingerprint(
    owner: RawUser, posters: readonly RawUser[], style: RawStyle | null,
    entries: readonly RawEntry[], features: RawFeatureCounts,
    rawText: ReadonlyMap<number, readonly [string, string, string, string]>,
    mapping: readonly [number, string],
): string {
    const userValue = (user: RawUser) => [
        user.userid, user.user, user.clusterid, user.status, user.statusvis,
        user.journaltype, user.name, user.optShowTalkLinks, user.optWhocanReply,
        user.optForceMoodtheme, user.moodthemeid, user.defaultpicid, user.dversion,
        user.caps, user.hasBio, user.bio, sortedRecord(user.publicSettings),
    ];
    const entryValue = (entry: RawEntry) => [
        entry.journalid, entry.jitemid, entry.anum, entry.posterid,
        entry.eventtime, entry.logtime, entry.rlogtime, entry.revttime,
        entry.year, entry.month, entry.day, entry.security, entry.allowmask,
        entry.replycount, entry.compressed, sortedRecord(entry.props),
        entry.subjectText, entry.eventText, rawText.get(entry.jitemid),
    ];
    const payload = [
        1, mapping, userValue(owner), posters.map(userValue), style,
        entries.length, entries.map(entryValue), features,
    ];
    return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export class MysqlLiveStore implements RawRecentRepository, LocalSecretSource {
    private constructor(private readonly db: Connection) {}

    static async open(config: MysqlStoreConfig): Promise<MysqlLiveStore> {
        if (config.host !== "127.0.0.1" || config.port !== 3306 ||
            config.user !== "s2js_slice3_ro" ||
            !/^[A-Za-z0-9]{40}$/.test(config.password)) {
            unsupported();
        }
        const pool = mysql.createPool({
            host: config.host, port: config.port, user: config.user,
            password: config.password, database: "dw_global", charset: "utf8mb4",
            dateStrings: true, supportBigNumbers: true, bigNumberStrings: true,
            connectionLimit: 2, waitForConnections: true, queueLimit: 4,
            connectTimeout: 3000, enableKeepAlive: false,
        });
        const db = new Kysely<Record<string, never>>({ dialect: new MysqlDialect({ pool }) });
        const store = new MysqlLiveStore(db);
        try {
            await store.verifyTopology();
            return store;
        } catch (error) {
            try { await db.destroy(); } catch { /* startup still fails closed */ }
            if (error instanceof SnapshotError) throw error;
            throw new SnapshotError("unavailable");
        }
    }

    private async verifyTopology(): Promise<void> {
        await this.db.connection().execute(async connection => {
            const system = (await sql<Row>`
                SELECT VERSION() AS version, DATABASE() AS dbname,
                    CURRENT_USER() AS principal,
                    @@global.read_only AS read_only,
                    @@global.super_read_only AS super_read_only
            `.execute(connection)).rows[0];
            if (!system || !/^8\./.test(requiredString(system.version)) ||
                system.dbname !== "dw_global" ||
                system.principal !== "s2js_slice3_ro@127.0.0.1" ||
                number(system.read_only) !== 0 ||
                number(system.super_read_only) !== 0) unsupported();
            const tables = (await sql<Row>`
                SELECT TABLE_SCHEMA AS schema_name, TABLE_NAME AS table_name,
                    ENGINE AS engine
                FROM information_schema.TABLES
                WHERE TABLE_SCHEMA IN ('dw_global', 'dw_cluster01')
                    AND TABLE_TYPE = 'BASE TABLE'
            `.execute(connection)).rows;
            const engines = new Map(tables.map(row => [
                `${requiredString(row.schema_name)}.${requiredString(row.table_name)}`,
                requiredString(row.engine),
            ]));
            for (const name of GLOBAL_TABLES) {
                if (engines.get(`dw_global.${name}`) !== "InnoDB") unsupported();
            }
            for (const name of CLUSTER_TABLES) {
                if (engines.get(`dw_cluster01.${name}`) !== "InnoDB") unsupported();
            }
        });
    }

    private async readSnapshot<T>(read: (connection: Connection) => Promise<T>): Promise<T> {
        try {
            return await this.db.connection().execute(async connection => {
                await sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`.execute(connection);
                await sql`SET SESSION MAX_EXECUTION_TIME = 2000`.execute(connection);
                await sql`START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY`.execute(connection);
                try {
                    return await read(connection);
                } finally {
                    await sql`ROLLBACK`.execute(connection);
                }
            });
        } catch (error) {
            if (error instanceof SnapshotError) throw error;
            throw new SnapshotError("unavailable");
        }
    }

    async loadRawSnapshot(username: string): Promise<RawJournalSnapshot | null> {
        if (!/^[a-z][a-z0-9_]{0,24}$/.test(username)) unsupported();
        return this.readSnapshot(connection => this.loadInSnapshot(connection, username));
    }

    async revalidateFingerprint(snapshot: RawJournalSnapshot): Promise<boolean> {
        try {
            const fresh = await this.loadRawSnapshot(snapshot.owner.user);
            return fresh !== null && fresh.fingerprint === snapshot.fingerprint;
        } catch (error) {
            if (error instanceof SnapshotError && error.kind === "unsupported") return false;
            throw error;
        }
    }

    async loadLatestSecret(nowSeconds: number, maxAgeSeconds: number): Promise<LocalSecret | null> {
        if (!Number.isSafeInteger(nowSeconds) || !Number.isSafeInteger(maxAgeSeconds) ||
            maxAgeSeconds < 0 || maxAgeSeconds > 86400) unsupported();
        const hour = nowSeconds - nowSeconds % 3600;
        try {
            const rows = (await sql<Row>`
                SELECT stime, HEX(secret) AS secret_hex
                FROM dw_global.secrets WHERE stime <= ${hour}
                ORDER BY stime DESC LIMIT 1
            `.execute(this.db)).rows;
            const row = rows[0];
            if (!row) return null;
            const stime = number(row.stime);
            if (stime % 3600 !== 0 || nowSeconds - stime > maxAgeSeconds) return null;
            const hex = requiredString(row.secret_hex);
            if (!/^(?:[0-9A-F]{2}){32}$/i.test(hex)) unsupported();
            const secret = Buffer.from(hex, "hex");
            if (!/^[A-Za-z0-9]{32}$/.test(secret.toString("ascii"))) unsupported();
            return { stime, secret };
        } catch (error) {
            if (error instanceof SnapshotError) throw error;
            throw new SnapshotError("unavailable");
        }
    }

    async close(): Promise<void> { await this.db.destroy(); }

    private async loadInSnapshot(
        connection: Connection, username: string,
    ): Promise<RawJournalSnapshot | null> {
        const owners = (await sql<Row>`
            SELECT userid FROM dw_global.user WHERE user = ${username} LIMIT 2
        `.execute(connection)).rows;
        if (owners.length === 0) return null;
        if (owners.length !== 1) unsupported();
        const ownerId = number(owners[0]?.userid, 1);
        const mappings = (await sql<Row>`
            SELECT userid, user FROM dw_global.useridmap WHERE userid = ${ownerId}
        `.execute(connection)).rows;
        if (mappings.length !== 1 || mappings[0]?.user !== username ||
            number(mappings[0]?.userid, 1) !== ownerId) unsupported();

        // No security or status predicate: policy must see every candidate.
        const logRows = (await sql<Row>`
            SELECT journalid, jitemid, anum, posterid, eventtime, logtime,
                rlogtime, revttime, year, month, day, security,
                CAST(allowmask AS CHAR) AS allowmask, replycount, compressed
            FROM dw_cluster01.log2 WHERE journalid = ${ownerId}
            ORDER BY revttime ASC, jitemid DESC LIMIT 201
        `.execute(connection)).rows;
        if (logRows.length > 200) unsupported();
        const itemIds = logRows.map(row => number(row.jitemid, 1));
        if (new Set(itemIds).size !== itemIds.length) unsupported();
        const posterIds = [...new Set([ownerId, ...logRows.map(row => number(row.posterid, 1))])];
        const users = await this.loadUsers(connection, posterIds);
        const owner = users.get(ownerId);
        if (!owner || owner.clusterid !== 1) unsupported();
        const posters = posterIds.sort((a, b) => a - b).map(id => {
            const user = users.get(id);
            if (!user || user.clusterid !== 1) unsupported();
            return user;
        });
        const style = await this.loadStyle(connection, owner);
        const { entries, rawText } = await this.loadEntries(connection, ownerId, logRows, itemIds);
        const features = await this.loadFeatures(connection, ownerId);
        const mapping: [number, string] = [ownerId, username];
        return {
            owner, posters, style, entries, features,
            fingerprint: fingerprint(owner, posters, style, entries, features, rawText, mapping),
        };
    }

    private async loadUsers(connection: Connection, ids: readonly number[]): Promise<Map<number, UserRecord>> {
        const users = (await sql<Row>`
            SELECT userid, user, clusterid, status, statusvis, journaltype, name,
                opt_showtalklinks, opt_whocanreply, opt_forcemoodtheme,
                moodthemeid, defaultpicid, dversion, CAST(caps AS CHAR) AS caps,
                has_bio
            FROM dw_global.user WHERE userid IN (${sql.join(ids)})
        `.execute(connection)).rows;
        if (users.length !== ids.length) unsupported();
        const bios = (await sql<Row>`
            SELECT userid, bio FROM dw_cluster01.userbio
            WHERE userid IN (${sql.join(ids)})
        `.execute(connection)).rows;
        const bioById = new Map<number, string | null>();
        for (const row of bios) {
            const id = number(row.userid, 1);
            if (bioById.has(id) || (row.bio !== null && typeof row.bio !== "string")) unsupported();
            bioById.set(id, row.bio as string | null);
        }
        const globalProps = (await sql<Row>`
            SELECT p.userid, names.name, p.value
            FROM dw_global.userprop AS p
            JOIN dw_global.userproplist AS names ON names.upropid = p.upropid
            WHERE p.userid IN (${sql.join(ids)})
                AND names.name IN (${sql.join(PUBLIC_SETTINGS)})
        `.execute(connection)).rows;
        const clusterProps = (await sql<Row>`
            SELECT p.userid, names.name, p.value
            FROM dw_cluster01.userproplite2 AS p
            JOIN dw_global.userproplist AS names ON names.upropid = p.upropid
            WHERE p.userid IN (${sql.join(ids)})
                AND names.name IN (${sql.join(PUBLIC_SETTINGS)})
        `.execute(connection)).rows;
        const propsById = new Map<number, Record<PublicSettingName, string | null>>();
        for (const id of ids) propsById.set(id, nullRecord(PUBLIC_SETTINGS));
        const allowed = new Set<string>(PUBLIC_SETTINGS);
        const seen = new Set<string>();
        for (const row of [...globalProps, ...clusterProps]) {
            const id = number(row.userid, 1);
            const name = requiredString(row.name);
            if (!propsById.has(id) || !allowed.has(name) ||
                (row.value !== null && typeof row.value !== "string")) unsupported();
            const key = `${id}/${name}`;
            if (seen.has(key)) unsupported();
            seen.add(key);
            propsById.get(id)![name as PublicSettingName] = row.value as string | null;
        }
        const result = new Map<number, UserRecord>();
        for (const row of users) {
            const id = number(row.userid, 1);
            if (result.has(id) || !propsById.has(id)) unsupported();
            const props = propsById.get(id)!;
            Object.freeze(props);
            result.set(id, new UserRecord({
                userid: id,
                user: requiredString(row.user),
                clusterid: number(row.clusterid),
                status: requiredString(row.status),
                statusvis: requiredString(row.statusvis),
                journaltype: requiredString(row.journaltype),
                name: requiredString(row.name),
                optShowTalkLinks: requiredString(row.opt_showtalklinks),
                optWhocanReply: requiredString(row.opt_whocanreply),
                optForceMoodtheme: requiredString(row.opt_forcemoodtheme),
                moodthemeid: number(row.moodthemeid),
                defaultpicid: row.defaultpicid === null ? 0 : number(row.defaultpicid),
                dversion: number(row.dversion),
                caps: unsigned(row.caps, 16),
                hasBio: requiredString(row.has_bio),
                bio: bioById.get(id) ?? null,
                publicSettings: props as PublicSettings,
            }));
        }
        return result;
    }

    private async loadStyle(connection: Connection, owner: RawUser): Promise<RawStyle | null> {
        const styleValue = owner.publicSettings.s2_style;
        if (styleValue === null) return null;
        const styleId = number(styleValue, 1);
        const rows = (await sql<Row>`
            SELECT styleid, userid, name, modtime
            FROM dw_global.s2styles WHERE styleid = ${styleId}
        `.execute(connection)).rows;
        if (rows.length !== 1) unsupported();
        const row = rows[0]!;
        const layerRows = (await sql<Row>`
            SELECT selected.type, selected.s2lid, source.userid AS ownerid,
                layer_owner.user AS owner_username,
                compiled.comptime AS compiled_time,
                SHA2(text.s2code, 256) AS source_hash
            FROM dw_cluster01.s2stylelayers2 AS selected
            LEFT JOIN dw_global.s2layers AS source ON source.s2lid = selected.s2lid
            LEFT JOIN dw_global.user AS layer_owner ON layer_owner.userid = source.userid
            LEFT JOIN dw_global.s2compiled AS compiled ON compiled.s2lid = selected.s2lid
            LEFT JOIN dw_global.s2source_inno AS text ON text.s2lid = selected.s2lid
            WHERE selected.userid = ${owner.userid} AND selected.styleid = ${styleId}
            ORDER BY selected.type, selected.s2lid
        `.execute(connection)).rows;
        if (layerRows.length > 8) unsupported();
        return {
            styleid: number(row.styleid, 1), ownerid: number(row.userid, 1),
            name: requiredString(row.name), modtime: number(row.modtime),
            layers: layerRows.map(layer => ({
                type: requiredString(layer.type),
                s2lid: number(layer.s2lid, 1),
                ownerid: number(layer.ownerid),
                ownerUsername: requiredString(layer.owner_username),
                compiledTime: number(layer.compiled_time),
                sourceHash: requiredString(layer.source_hash).toLowerCase(),
            })),
        };
    }

    private async loadEntries(
        connection: Connection, ownerId: number, logRows: readonly Row[],
        itemIds: readonly number[],
    ): Promise<{
        entries: EntryRecord[];
        rawText: Map<number, readonly [string, string, string, string]>;
    }> {
        const entries: EntryRecord[] = [];
        const rawText = new Map<number, readonly [string, string, string, string]>();
        if (itemIds.length === 0) return { entries, rawText };
        const lengths = (await sql<Row>`
            SELECT jitemid, OCTET_LENGTH(subject) AS subject_length,
                OCTET_LENGTH(event) AS event_length
            FROM dw_cluster01.logtext2 WHERE journalid = ${ownerId}
                AND jitemid IN (${sql.join(itemIds)})
        `.execute(connection)).rows;
        if (lengths.length !== itemIds.length) unsupported();
        let totalStored = 0;
        const lengthIds = new Set<number>();
        for (const row of lengths) {
            const id = number(row.jitemid, 1);
            if (lengthIds.has(id) || !itemIds.includes(id)) unsupported();
            lengthIds.add(id);
            const subjectLength = row.subject_length === null ? 0 : number(row.subject_length);
            const eventLength = number(row.event_length);
            if (subjectLength > 8192 || eventLength > 131072) unsupported();
            totalStored += subjectLength + eventLength;
            if (totalStored > 2097152) unsupported();
        }
        const texts = (await sql<Row>`
            SELECT jitemid,
                HEX(subject) AS subject_stored,
                HEX(CONVERT(subject USING latin1)) AS subject_original,
                HEX(CONVERT(CONVERT(subject USING latin1) USING utf8mb4)) AS subject_roundtrip,
                HEX(event) AS event_stored,
                HEX(CONVERT(event USING latin1)) AS event_original,
                HEX(CONVERT(CONVERT(event USING latin1) USING utf8mb4)) AS event_roundtrip
            FROM dw_cluster01.logtext2 WHERE journalid = ${ownerId}
                AND jitemid IN (${sql.join(itemIds)})
        `.execute(connection)).rows;
        if (texts.length !== itemIds.length) unsupported();
        const textById = new Map<number, { subject: string; event: string }>();
        let totalDecoded = 0;
        for (const row of texts) {
            const id = number(row.jitemid, 1);
            if (textById.has(id) || !lengthIds.has(id)) unsupported();
            const subjectNull = row.subject_stored === null;
            if (subjectNull !== (row.subject_original === null) ||
                subjectNull !== (row.subject_roundtrip === null)) unsupported();
            const subject = decodeLegacyText(
                subjectNull ? "" : row.subject_stored,
                subjectNull ? "" : row.subject_original,
                subjectNull ? "" : row.subject_roundtrip,
                8192, 1024, false,
            );
            const event = decodeLegacyText(
                row.event_stored, row.event_original, row.event_roundtrip,
                131072, 65536, true,
            );
            totalDecoded += Buffer.byteLength(subject.text) + Buffer.byteLength(event.text);
            if (totalDecoded > 2097152) unsupported();
            textById.set(id, { subject: subject.text, event: event.text });
            rawText.set(id, [
                subject.storedBytes.toString("hex"), subject.originalBytes.toString("hex"),
                event.storedBytes.toString("hex"), event.originalBytes.toString("hex"),
            ]);
        }
        const propRows = (await sql<Row>`
            SELECT p.jitemid, names.name, p.value
            FROM dw_cluster01.logprop2 AS p
            LEFT JOIN dw_global.logproplist AS names ON names.propid = p.propid
            WHERE p.journalid = ${ownerId}
                AND p.jitemid IN (${sql.join(itemIds)})
            LIMIT 2001
        `.execute(connection)).rows;
        if (propRows.length > 2000) unsupported();
        const propsById = new Map<number, Record<string, string | null>>();
        for (const id of itemIds) propsById.set(id, Object.create(null));
        for (const row of propRows) {
            const id = number(row.jitemid, 1);
            const name = requiredString(row.name);
            const props = propsById.get(id);
            if (!props || Object.hasOwn(props, name) ||
                (row.value !== null && typeof row.value !== "string")) unsupported();
            props[name] = row.value as string | null;
        }
        for (const row of logRows) {
            const id = number(row.jitemid, 1);
            const text = textById.get(id);
            const props = propsById.get(id);
            if (!text || !props || number(row.journalid, 1) !== ownerId) unsupported();
            Object.freeze(props);
            entries.push(new EntryRecord({
                journalid: ownerId, jitemid: id,
                anum: number(row.anum), posterid: number(row.posterid, 1),
                eventtime: civilTime(row.eventtime), logtime: civilTime(row.logtime),
                rlogtime: number(row.rlogtime), revttime: number(row.revttime),
                year: number(row.year), month: number(row.month), day: number(row.day),
                security: requiredString(row.security),
                allowmask: unsigned(row.allowmask, 64),
                replycount: number(row.replycount),
                compressed: requiredString(row.compressed),
                props, subjectText: text.subject, eventText: text.event,
            }));
        }
        return { entries, rawText };
    }

    private async loadFeatures(connection: Connection, ownerId: number): Promise<RawFeatureCounts> {
        const rows = (await sql<Row>`
            SELECT
                (SELECT COUNT(*) FROM dw_cluster01.usertags WHERE journalid = ${ownerId}) AS usertags,
                (SELECT COUNT(*) FROM dw_cluster01.userkeywords WHERE userid = ${ownerId}) AS userkeywords,
                (SELECT COUNT(*) FROM dw_cluster01.logtags WHERE journalid = ${ownerId}) AS logtags,
                (SELECT COUNT(*) FROM dw_cluster01.logtagsrecent WHERE journalid = ${ownerId}) AS logtagsrecent,
                (SELECT COUNT(*) FROM dw_cluster01.logkwsum WHERE journalid = ${ownerId}) AS logkwsum,
                (SELECT COUNT(*) FROM dw_cluster01.links WHERE journalid = ${ownerId}) AS links,
                (SELECT COUNT(*) FROM dw_cluster01.userpic2 WHERE userid = ${ownerId}) AS userpics,
                (SELECT COUNT(*) FROM dw_cluster01.talk2 WHERE journalid = ${ownerId}) AS comments
        `.execute(connection)).rows;
        if (rows.length !== 1) unsupported();
        const row = rows[0]!;
        return {
            usertags: number(row.usertags), userkeywords: number(row.userkeywords),
            logtags: number(row.logtags), logtagsrecent: number(row.logtagsrecent),
            logkwsum: number(row.logkwsum), links: number(row.links),
            userpics: number(row.userpics), comments: number(row.comments),
        };
    }
}
