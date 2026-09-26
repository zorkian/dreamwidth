// mysql.ts
//
// Configured-primary selected page snapshots for the standalone S2 viewer.
//
// Source ports: LJ/S2.pm get_style and YearMonth, and DW/Logic/LogItems.pm
// recent_items. The LJ code was forked from the LiveJournal project owned and
// operated by Live Journal, Inc., then modified by Dreamwidth Studios, LLC.
// Its inherited license is available at:
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
// Those ports and their modifications are provided under the GNU General
// Public License. See LICENSE in this distribution.
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
import { sql } from "kysely";
import { PrimaryDatabases, type ReadConnection, type SqlRow } from "./primary";
import type { LiveStoreConfig } from "../startup-types";
import {resolvePlaceholder} from "../domain/placeholder";
import type {
    LocalSecret, LocalSecretSource, PublicSettingName, PublicSettings, RawEntry,
    RawFeatureCounts, RawJournalSnapshot, RawRecentRepository, RawStyle, RawUser,
    RawPageRequest, RawPageSelection, RawEntryHeader, RawCalendarSummary, PlaceholderResolver,
    PlaceholderResolutionSpec, RawUserpics,
} from "../contracts";
import { EntryRecord, UserRecord } from "../domain/records";
import { SnapshotError } from "./errors";
import { decodeLegacyText } from "./legacy-text";

type Connection = ReadConnection;
type Row = SqlRow;
export type MysqlStoreConfig = LiveStoreConfig;

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
    "s2compiled", "s2source_inno", "s2info", "logproplist", "sysban",
] as const;
const CLUSTER_TABLES = [
    "userproplite2", "userpropblob", "s2stylelayers2",
    "log2", "logtext2", "logprop2",
    "usertags", "userkeywords", "logtags", "logtagsrecent", "logkwsum",
    "links", "userpic2", "userpicmap2", "userpicmap3", "talk2",
] as const;

function unsupported(): never { throw new SnapshotError("unsupported"); }

function number(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
    const parsed = typeof value === "number" ? value :
        typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) unsupported();
    return parsed;
}

function selectedStyleId(settings: PublicSettings): number {
    // User/Styles.pm590-600 chooses a persisted style only for stylesys2.
    // A stale s2_style or its incompatible layers must not override DEFAULT_STYLE.
    // Original property bytes still participate in the settings fingerprint.
    const system = settings.stylesys;
    if (system !== null && system !== "" && !/^[0-9]+$/.test(system)) unsupported();
    if (Number(system) !== 2) return 0;
    return settings.s2_style ? number(settings.s2_style) : 0;
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

type RawField = readonly [key: string, storedHex: string, originalHex: string];

function decodedColumn(
    row: Row, field: string, key: string, rawFields: RawField[],
    maxBytes: number, nullable: boolean, binary = false,
): string | null {
    const stored = row[field + "_stored"];
    const original = binary ? stored : row[field + "_original"];
    const roundtrip = binary ? stored : row[field + "_roundtrip"];
    if (stored === null && original === null && roundtrip === null) {
        if (!nullable) unsupported();
        rawFields.push([key, "<NULL>", "<NULL>"]);
        return null;
    }
    const decoded = decodeLegacyText(stored, original, roundtrip, maxBytes, maxBytes, false);
    rawFields.push([
        key, decoded.storedBytes.toString("hex"), decoded.originalBytes.toString("hex"),
    ]);
    return decoded.text;
}

function fingerprint(
    owner: RawUser, posters: readonly RawUser[], style: RawStyle | null,
    entries: readonly RawEntry[], features: RawFeatureCounts,
    rawText: ReadonlyMap<number, readonly [string, string, string, string]>,
    mapping: readonly [number, string],
    rawFields: readonly RawField[],
    request: RawPageRequest, selection: RawPageSelection, calendar: RawCalendarSummary,
    sourceFacts: unknown, userpics: RawUserpics,
): string {
    const userValue = (user: RawUser) => [
        user.userid, user.user, user.clusterid, user.status, user.statusvis,
        user.journaltype, user.name, user.optShowTalkLinks, user.optWhocanReply,
        user.optForceMoodtheme, user.moodthemeid, user.defaultpicid, user.dversion,
        user.caps, sortedRecord(user.publicSettings),
    ];
    const entryValue = (entry: RawEntry) => [
        entry.journalid, entry.jitemid, entry.anum, entry.posterid,
        entry.eventtime, entry.logtime, entry.rlogtime, entry.revttime,
        entry.year, entry.month, entry.day, entry.security, entry.allowmask,
        entry.replycount, entry.compressed, sortedRecord(entry.props),
        entry.subjectText, entry.eventText, rawText.get(entry.jitemid),
    ];
    const payload = [
        2, request, selection, calendar, sourceFacts, mapping, userValue(owner), posters.map(userValue), style,
        entries.length, entries.map(entryValue), features, userpics,
        [...rawFields].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
    ];
    return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}


interface GlobalFacts {
    owner: Row;
    mapping: readonly Row[];
    properties: readonly Row[];
    propertyNames: readonly Row[];
    logNames: readonly Row[];
    spamreportBans: number;
}
interface ClusterSettings { properties: readonly Row[]; layers: readonly Row[]; }
function digest(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function header(row: Row, journalid: number): RawEntryHeader {
    if (number(row.journalid, 1) !== journalid) unsupported();
    return {journalid, jitemid: number(row.jitemid, 1), anum: number(row.anum, 0, 255),
        posterid: number(row.posterid, 1), eventtime: civilTime(row.eventtime), logtime: civilTime(row.logtime),
        rlogtime: number(row.rlogtime), revttime: number(row.revttime),
        year: number(row.year, 1, 9999), month: number(row.month, 1, 12), day: number(row.day, 1, 31),
        security: requiredString(row.security), allowmask: unsigned(row.allowmask, 64),
        replycount: number(row.replycount), compressed: requiredString(row.compressed)};
}

export class MysqlLiveStore implements RawRecentRepository, LocalSecretSource, PlaceholderResolver {
    private constructor(private readonly databases: PrimaryDatabases,
        private readonly config: LiveStoreConfig) {}

    static async open(config: MysqlStoreConfig): Promise<MysqlLiveStore> {
        if (!Number.isSafeInteger(config.maxScrollback) || config.maxScrollback < 2 ||
            !Number.isSafeInteger(config.capabilities.moveInProgressMask) ||
            config.capabilities.moveInProgressMask < 0) unsupported();
        const frozen = structuredClone(config);
        return new MysqlLiveStore(PrimaryDatabases.create(frozen.database), frozen);
    }
    async close(): Promise<void> { await this.databases.close(); }
    async resolvePlaceholder(spec: PlaceholderResolutionSpec): Promise<{readonly alt: string; readonly title: string}> {
        // Only the startup public-language resolver uses an empty engine list.
        // MyISAM labels are a restart-lived value, never authorization dependencies.
        return this.databases.snapshot(undefined, [], connection => resolvePlaceholder(connection, spec));
    }
    async loadLatestSecret(nowSeconds: number, maxAgeSeconds: number): Promise<LocalSecret | null> {
        number(nowSeconds); number(maxAgeSeconds, 0, 86400);
        const hour = nowSeconds - nowSeconds % 3600;
        return this.databases.snapshot(undefined, ["secrets"], async connection => {
            const rows = (await sql<Row>`SELECT stime, HEX(secret) AS secret_hex
                FROM secrets WHERE stime <= ${hour} ORDER BY stime DESC LIMIT 1`.execute(connection)).rows;
            const row = rows[0];
            if (!row) return null;
            const stime = number(row.stime);
            if (stime % 3600 || nowSeconds - stime > maxAgeSeconds) return null;
            const hex = requiredString(row.secret_hex);
            if (!/^(?:[0-9A-F]{2}){32}$/i.test(hex)) unsupported();
            const secret = Buffer.from(hex, "hex");
            if (!/^[A-Za-z0-9]{32}$/.test(secret.toString("ascii"))) unsupported();
            return {stime, secret};
        });
    }

    private async globalFacts(connection: Connection, username: string): Promise<GlobalFacts | null> {
        const owners = (await sql<Row>`SELECT userid,user,clusterid,status,statusvis,journaltype,
            HEX(name) AS name_stored, HEX(CONVERT(name USING latin1)) AS name_original,
            HEX(CONVERT(CONVERT(name USING latin1) USING utf8mb4)) AS name_roundtrip,
            opt_showtalklinks,opt_whocanreply,opt_forcemoodtheme,moodthemeid,defaultpicid,dversion,
            CAST(caps AS CHAR) AS caps
            FROM user WHERE BINARY user = BINARY ${username} LIMIT 2`.execute(connection)).rows;
        if (!owners.length) return null;
        if (owners.length !== 1) unsupported();
        const owner = owners[0]!, id = number(owner.userid, 1);
        // Both directions expose incomplete rename/move mappings, rather than
        // treating a one-sided useridmap row as the current journal identity.
        const mapping = (await sql<Row>`SELECT userid,user FROM useridmap
            WHERE userid = ${id} OR BINARY user = BINARY ${username}
            ORDER BY userid,user LIMIT 3`.execute(connection)).rows;
        if (mapping.length !== 1 || number(mapping[0]!.userid, 1) !== id || mapping[0]!.user !== username) unsupported();
        const propertyNames = (await sql<Row>`SELECT upropid,name FROM userproplist
            WHERE name IN (${sql.join(PUBLIC_SETTINGS)}) ORDER BY upropid,name`.execute(connection)).rows;
        const logNames = (await sql<Row>`SELECT propid,name FROM logproplist ORDER BY propid LIMIT 4097`
            .execute(connection)).rows;
        if (logNames.length > 4096) unsupported();
        const properties = (await sql<Row>`SELECT p.upropid,
            HEX(p.value) AS value_stored, HEX(CONVERT(p.value USING latin1)) AS value_original,
            HEX(CONVERT(CONVERT(p.value USING latin1) USING utf8mb4)) AS value_roundtrip
            FROM userprop p WHERE p.userid = ${id} AND p.upropid IN
            (SELECT upropid FROM userproplist WHERE name IN (${sql.join(PUBLIC_SETTINGS)}))
            ORDER BY p.upropid`.execute(connection)).rows;
        const bans = (await sql<Row>`SELECT COUNT(*) AS matching FROM sysban
            WHERE BINARY what = BINARY 'spamreport' AND BINARY value = BINARY ${username}`.execute(connection)).rows;
        if (bans.length !== 1) unsupported();
        return {owner, mapping, properties, propertyNames, logNames, spamreportBans: number(bans[0]!.matching)};
    }
    private names(rows: readonly Row[], idKey: string): Map<number, string> {
        const result = new Map<number, string>(), names = new Set<string>();
        for (const row of rows) {
            const id = number(row[idKey], 1), name = requiredString(row.name);
            if (!name || name.length > 256 || result.has(id) || names.has(name)) unsupported();
            result.set(id, name); names.add(name);
        }
        return result;
    }
    private async clusterSettings(connection: Connection, id: number, facts: GlobalFacts): Promise<ClusterSettings> {
        const ids = facts.propertyNames.map(row => number(row.upropid, 1));
        const properties: Row[] = [];
        if (ids.length) {
            const lite = (await sql<Row>`SELECT upropid,
                HEX(value) AS value_stored, HEX(CONVERT(value USING latin1)) AS value_original,
                HEX(CONVERT(CONVERT(value USING latin1) USING utf8mb4)) AS value_roundtrip
                FROM userproplite2 WHERE userid = ${id} AND upropid IN (${sql.join(ids)})
                ORDER BY upropid`.execute(connection)).rows;
            const blob = (await sql<Row>`SELECT upropid, HEX(value) AS value_stored
                FROM userpropblob WHERE userid = ${id} AND upropid IN (${sql.join(ids)})
                ORDER BY upropid`.execute(connection)).rows;
            properties.push(...lite, ...blob);
        }
        const settings = this.settings(facts, {properties, layers: []}, []);
        const styleId = selectedStyleId(settings);
        const layers = styleId ? (await sql<Row>`SELECT type,s2lid FROM s2stylelayers2
            WHERE userid = ${id} AND styleid = ${styleId} ORDER BY type,s2lid LIMIT 9`.execute(connection)).rows : [];
        if (layers.length > 8) unsupported();
        return {properties, layers};
    }
    private settings(facts: GlobalFacts, cluster: ClusterSettings, raw: RawField[]): PublicSettings {
        const names = this.names(facts.propertyNames, "upropid");
        const result = nullRecord(PUBLIC_SETTINGS), seen = new Set<string>();
        for (const row of [...facts.properties, ...cluster.properties]) {
            const name = names.get(number(row.upropid, 1));
            if (!name || !PUBLIC_SETTINGS.includes(name as PublicSettingName) || seen.has(name)) unsupported();
            seen.add(name);
            result[name as PublicSettingName] = decodedColumn(row, "value",
                "user:" + facts.owner.userid + ":prop:" + name, raw,
                row.value_original === undefined ? 65536 : 8192, true, row.value_original === undefined);
        }
        return Object.freeze(result);
    }
    private user(row: Row, settings: PublicSettings, raw: RawField[]): UserRecord {
        const id = number(row.userid, 1);
        return new UserRecord({userid: id, user: requiredString(row.user), clusterid: number(row.clusterid, 1),
            status: requiredString(row.status), statusvis: requiredString(row.statusvis), journaltype: requiredString(row.journaltype),
            name: decodedColumn(row, "name", "user:" + id + ":name", raw, 1024, false)!,
            optShowTalkLinks: requiredString(row.opt_showtalklinks), optWhocanReply: requiredString(row.opt_whocanreply),
            optForceMoodtheme: requiredString(row.opt_forcemoodtheme), moodthemeid: number(row.moodthemeid),
            defaultpicid: row.defaultpicid === null ? 0 : number(row.defaultpicid), dversion: number(row.dversion),
            caps: unsigned(row.caps, 16), publicSettings: settings});
    }

    async loadRawSnapshot(request: RawPageRequest): Promise<RawJournalSnapshot | null> {
        if (!/^[a-z0-9_]{1,25}$/.test(request.username)) unsupported();
        number(request.calendarNow.year, 1, 9999); number(request.calendarNow.month, 1, 12);
        const frozenRequest = structuredClone(request);
        const initial = await this.databases.snapshot(undefined, GLOBAL_TABLES,
            connection => this.globalFacts(connection, request.username));
        if (!initial) return null;
        const ownerId = number(initial.owner.userid, 1), clusterId = number(initial.owner.clusterid, 1);
        const caps = BigInt(unsigned(initial.owner.caps, 16));
        if (caps & BigInt(this.config.capabilities.moveInProgressMask)) unsupported();
        // Planning reads only public settings/style IDs. A second cluster
        // snapshot below must match them; no private body is loaded in planning.
        const plan = await this.databases.snapshot(clusterId, CLUSTER_TABLES, async connection => {
            if (frozenRequest.page.kind === "entry" &&
                !await this.loadWindow(connection, ownerId, frozenRequest)) return null;
            return this.clusterSettings(connection, ownerId, initial);
        });
        if (!plan) return null;
        const before = await this.databases.snapshot(undefined, GLOBAL_TABLES, async connection => {
            const facts = await this.globalFacts(connection, request.username);
            if (!facts || digest(facts) !== digest(initial)) unsupported();
            const raw: RawField[] = [], owner = this.user(facts.owner, this.settings(facts, plan, raw), raw);
            const style = await this.loadStyle(connection, owner, plan, raw);
            return {facts, style, raw};
        });
        const selected = await this.databases.snapshot(clusterId, CLUSTER_TABLES, async connection => {
            const current = await this.clusterSettings(connection, ownerId, before.facts);
            if (digest(current) !== digest(plan)) unsupported();
            const window = await this.loadWindow(connection, ownerId, frozenRequest);
            if (!window) return null;
            const raw: RawField[] = [];
            const loaded = await this.loadEntries(connection, ownerId, window.rows,
                window.rows.map(row => number(row.jitemid, 1)), raw, this.names(before.facts.logNames, "propid"));
            const statusId = before.facts.logNames.find(row => row.name === "statusvis")?.propid;
            const calendar = await this.loadCalendar(connection, ownerId, frozenRequest,
                statusId === undefined ? 0 : number(statusId, 1), raw,
                window.selection.kind === "recent" ? window.selection.window.map(row => row.jitemid) :
                    [window.selection.target.jitemid]);
            const features = await this.loadFeatures(connection, ownerId, before.facts.spamreportBans);
            const userpics = await this.loadUserpics(connection, ownerId, number(before.facts.owner.dversion), raw);
            return {...loaded, selection: window.selection, calendar, features, userpics, raw};
        });
        if (!selected) return null;
        const after = await this.databases.snapshot(undefined, GLOBAL_TABLES, async connection => {
            const facts = await this.globalFacts(connection, request.username);
            if (!facts || digest(facts) !== digest(before.facts)) unsupported();
            const raw: RawField[] = [], owner = this.user(facts.owner, this.settings(facts, plan, raw), raw);
            const style = await this.loadStyle(connection, owner, plan, raw);
            if (digest(style) !== digest(before.style) || digest(raw) !== digest(before.raw)) unsupported();
            const posters = await this.loadPosters(connection, owner, selected.entries, raw);
            return {owner, style, posters, raw};
        });
        const rawFields = [...after.raw, ...selected.raw];
        if (rawFields.reduce((sum, field) => sum + (field[1].length + field[2].length) / 2, 0) > 2097152) unsupported();
        const sourceFacts = [before.facts.mapping, before.facts.propertyNames, before.facts.logNames,
            plan.layers, this.config.styles, this.config.capabilities];
        return {request: frozenRequest, selection: selected.selection, owner: after.owner, posters: after.posters,
            style: after.style, entries: selected.entries, calendar: selected.calendar, features: selected.features, userpics: selected.userpics,
            fingerprint: fingerprint(after.owner, after.posters, after.style, selected.entries, selected.features,
                selected.rawText, [ownerId, request.username], rawFields, frozenRequest, selected.selection, selected.calendar, sourceFacts, selected.userpics)};
    }
    async revalidateFingerprint(snapshot: RawJournalSnapshot): Promise<boolean> {
        try {
            const fresh = await this.loadRawSnapshot(snapshot.request);
            return fresh !== null && fresh.fingerprint === snapshot.fingerprint;
        } catch (error) {
            if (error instanceof SnapshotError && error.kind === "unsupported") return false;
            throw error;
        }
    }


    private async loadStyle(connection: Connection, owner: RawUser, selected: ClusterSettings,
        raw: RawField[]): Promise<RawStyle | null> {
        const styleId = selectedStyleId(owner.publicSettings);
        const rows = styleId ? (await sql<Row>`SELECT styleid,userid,modtime,
            HEX(name) AS name_stored, HEX(CONVERT(name USING latin1)) AS name_original,
            HEX(CONVERT(CONVERT(name USING latin1) USING utf8mb4)) AS name_roundtrip
            FROM s2styles WHERE styleid = ${styleId} LIMIT 2`.execute(connection)).rows : [];
        if (rows.length > 1) unsupported();
        let layerIds = rows.length ? selected.layers.map(row => ({type: requiredString(row.type),
            s2lid: number(row.s2lid, 1)})) : [];
        const persisted = layerIds.length > 0;
        if (!persisted) {
            layerIds = [];
            for (const [type, name] of Object.entries(this.config.styles.defaultStyle).sort()) {
                if (!name) continue;
                const matches = (await sql<Row>`SELECT l.s2lid,l.b2lid FROM s2layers l
                    JOIN user u ON u.userid = l.userid
                    JOIN useridmap system_map ON system_map.userid = u.userid
                        AND BINARY system_map.user = BINARY 'system'
                    JOIN s2info i ON i.s2lid = l.s2lid AND BINARY i.infokey = BINARY 'redist_uniq'
                    WHERE BINARY u.user = BINARY 'system' AND BINARY i.value = BINARY ${name}
                    AND (l.b2lid = 0 OR EXISTS (SELECT 1 FROM s2layers parent JOIN s2info parent_info ON parent_info.s2lid = parent.s2lid
                        WHERE parent.s2lid = l.b2lid AND parent.userid = l.userid
                        AND parent_info.infokey IN ('redist_uniq','type','name','langcode',
                            'majorversion','_previews','des','note','author','author_name','author_email','is_internal')))
                    ORDER BY l.s2lid LIMIT 2`.execute(connection)).rows;
                if (matches.length > 1) unsupported();
                if (matches.length) layerIds.push({type, s2lid: number(matches[0]!.s2lid, 1)});
            }
        } else {
            layerIds = layerIds.map(layer => ({...layer,
                s2lid: ["core","i18nc","i18n","layout","theme"].includes(layer.type) &&
                    Object.hasOwn(this.config.styles.layerRemap, String(layer.s2lid))
                    ? number(this.config.styles.layerRemap[String(layer.s2lid)], 1) : layer.s2lid}));
        }
        if (!layerIds.length) return null;
        if (layerIds.length > 8 || new Set(layerIds.map(layer => layer.type)).size !== layerIds.length) unsupported();
        const ids = [...new Set(layerIds.map(layer => layer.s2lid))];
        const definitions = (await sql<Row>`SELECT source.s2lid,source.userid AS ownerid,
            layer_owner.user AS owner_username, compiled.comptime AS compiled_time,
            SHA2(text.s2code,256) AS source_hash
            FROM s2layers source
            LEFT JOIN user layer_owner ON layer_owner.userid = source.userid
            LEFT JOIN s2compiled compiled ON compiled.s2lid = source.s2lid
            LEFT JOIN s2source_inno text ON text.s2lid = source.s2lid
            WHERE source.s2lid IN (${sql.join(ids)}) ORDER BY source.s2lid`.execute(connection)).rows;
        if (definitions.length !== ids.length) unsupported();
        const byId = new Map(definitions.map(row => [number(row.s2lid, 1), row]));
        if (byId.size !== ids.length) unsupported();
        const stored = rows[0];
        return {origin: persisted ? "persisted" : "default", styleid: persisted ? styleId : 0,
            ownerid: persisted ? number(stored!.userid, 1) : null,
            name: persisted ? decodedColumn(stored!, "name", "style:" + styleId + ":name", raw, 1024, false)! : null,
            modtime: persisted ? number(stored!.modtime) : 0,
            layers: layerIds.sort((a,b) => a.type.localeCompare(b.type)).map(layer => {
                const definition = byId.get(layer.s2lid)!;
                return {type: layer.type, s2lid: layer.s2lid, ownerid: number(definition.ownerid, 1),
                    ownerUsername: requiredString(definition.owner_username),
                    compiledTime: number(definition.compiled_time),
                    sourceHash: requiredString(definition.source_hash).toLowerCase()};
            })};
    }
    private async loadPosters(connection: Connection, owner: RawUser, entries: readonly RawEntry[],
        raw: RawField[]): Promise<RawUser[]> {
        const ids = [...new Set(entries.map(entry => entry.posterid))].sort((a,b) => a-b);
        if (!ids.includes(owner.userid)) ids.push(owner.userid);
        ids.sort((a,b) => a-b);
        const result: RawUser[] = [];
        for (const id of ids) {
            if (id === owner.userid) { result.push(owner); continue; }
            const identity = (await sql<Row>`SELECT user FROM user WHERE userid = ${id} LIMIT 2`.execute(connection)).rows;
            if (identity.length !== 1) unsupported();
            const facts = await this.globalFacts(connection, requiredString(identity[0]!.user));
            if (!facts || number(facts.owner.userid, 1) !== id) unsupported();
            // Foreign posters are exposed as facts and explicitly refused by
            // the personal-journal policy. No other journal body is queried.
            result.push(this.user(facts.owner, this.settings(facts, {properties: [], layers: []}, raw), raw));
        }
        return result;
    }

    private async loadWindow(connection: Connection, ownerId: number, request: RawPageRequest):
        Promise<{selection: RawPageSelection; rows: readonly Row[]} | null> {
        const columns = sql`journalid,jitemid,anum,posterid,eventtime,logtime,rlogtime,revttime,
            year,month,day,security,CAST(allowmask AS CHAR) AS allowmask,replycount,compressed`;
        if (request.page.kind === "entry") {
            const id = number(request.page.ditemid, 1, 4294967295);
            const rows = (await sql<Row>`SELECT ${columns} FROM log2
                WHERE journalid = ${ownerId} AND jitemid = ${Math.floor(id / 256)} LIMIT 2`.execute(connection)).rows;
            if (!rows.length) return null;
            if (rows.length !== 1) unsupported();
            const row = rows[0]!;
            if (number(row.anum, 0, 255) !== id % 256 || row.security === "private" || row.security === "usemask") return null;
            if (row.security !== "public") unsupported();
            const target = header(row, ownerId);
            return {selection: {kind: "entry", ditemid: id, target}, rows};
        }
        const itemshow = number(request.page.itemshow, 1, 200), skip = number(request.page.skip);
        const maximum = this.config.maxScrollback;
        if (itemshow >= maximum) unsupported();
        const pageSkip = Math.min(skip, maximum - itemshow);
        const loadSkip = Math.min(pageSkip, maximum - itemshow - 1);
        const rows = (await sql<Row>`SELECT ${columns} FROM log2 USE INDEX (revttime)
            WHERE journalid = ${ownerId} AND revttime <= 2147483647 AND security = 'public'
            ORDER BY revttime ASC,jitemid ASC LIMIT ${loadSkip},${itemshow + 1}`.execute(connection)).rows;
        const window = rows.map(row => header(row, ownerId));
        if (new Set(window.map(row => row.jitemid)).size !== window.length) unsupported();
        // Native "per-minute" buffer compares S2 alldatepart including seconds.
        // Reorder only equal full event times AFTER LIMIT, then pop lookahead.
        const reordered: Row[] = [];
        for (let index = 0; index < rows.length;) {
            let end = index + 1;
            while (end < rows.length && rows[end]!.eventtime === rows[index]!.eventtime) end++;
            reordered.push(...rows.slice(index,end).sort((a,b) => number(b.jitemid)-number(a.jitemid)));
            index = end;
        }
        const selected = reordered.slice(0,itemshow);
        return {selection: {kind: "recent", pageSkip, loadSkip, itemshow, maxScrollback: maximum,
            window, selectedJitemids: selected.map(row => number(row.jitemid, 1))}, rows: selected};
    }

    private async loadCalendar(connection: Connection, ownerId: number, request: RawPageRequest, statusId: number, raw: RawField[], witnessIds: readonly number[]): Promise<RawCalendarSummary> {
        const yearRows = (await sql<Row>`SELECT MAX(year) AS latest FROM log2
            WHERE journalid = ${ownerId} AND security = 'public' AND year <= ${request.calendarNow.year}`
            .execute(connection)).rows;
        const latest = yearRows[0]?.latest;
        const year = latest === null || latest === undefined ? request.calendarNow.year : number(latest,1,9999);
        let month = request.calendarNow.month;
        if (latest !== null && latest !== undefined) {
            const monthRows = (await sql<Row>`SELECT MAX(month) AS latest FROM log2
                WHERE journalid = ${ownerId} AND security = 'public' AND year = ${year}
                AND (${year} < ${request.calendarNow.year} OR month <= ${request.calendarNow.month})`
                .execute(connection)).rows;
            month = monthRows[0]?.latest === null ? 0 : number(monthRows[0]?.latest,1,12);
        }
        const days = month ? (await sql<Row>`SELECT day,COUNT(*) AS count FROM log2
            WHERE journalid = ${ownerId} AND security = 'public' AND year = ${year} AND month = ${month}
            GROUP BY day ORDER BY day LIMIT 32`.execute(connection)).rows : [];
        if (days.length > 31) unsupported();
        // YearMonth's retained neighbor predicates constrain BOTH year and month.
        const previousRows = (await sql<Row>`SELECT year,month FROM log2
            WHERE journalid = ${ownerId} AND security = 'public' AND year <= ${year} AND month < ${month}
            GROUP BY year,month ORDER BY year DESC,month DESC LIMIT 1`.execute(connection)).rows;
        const nextRows = (await sql<Row>`SELECT year,month FROM log2
            WHERE journalid = ${ownerId} AND security = 'public' AND year >= ${year} AND month > ${month}
            GROUP BY year,month ORDER BY year ASC,month ASC LIMIT 1`.execute(connection)).rows;
        const previous = previousRows[0] ? {year: number(previousRows[0].year,1,9999), month: number(previousRows[0].month,1,12)} : null;
        const next = nextRows[0] ? {year: number(nextRows[0].year,1,9999), month: number(nextRows[0].month,1,12)} : null;
        // Witnesses cover all selected/window IDs (including lookahead), shown
        // month, source neighbor months and a future-only latest-year witness.
        // Only aggregated statuses/posters are read here, never body text.
        const witness = sql`((log.jitemid IN (${sql.join(witnessIds.length ? witnessIds : [0])})) OR (year = ${year} AND month = ${month}) OR
            (year = ${year} AND ${month} = 0) OR
            ${previous ? sql`(year = ${previous.year} AND month = ${previous.month})` : sql`FALSE`} OR
            ${next ? sql`(year = ${next.year} AND month = ${next.month})` : sql`FALSE`})`;
        const statuses = (await sql<Row>`SELECT HEX(p.value) AS status_stored,
            HEX(CONVERT(p.value USING latin1)) AS status_original,
            HEX(CONVERT(CONVERT(p.value USING latin1) USING utf8mb4)) AS status_roundtrip,COUNT(*) AS count,
            SUM(log.posterid <> ${ownerId}) AS foreign_count
            FROM log2 log LEFT JOIN logprop2 p ON p.journalid = log.journalid AND p.jitemid = log.jitemid
                AND p.propid = ${statusId}
            WHERE log.journalid = ${ownerId} AND log.security = 'public' AND ${witness}
            GROUP BY HEX(p.value),HEX(CONVERT(p.value USING latin1)),
                HEX(CONVERT(CONVERT(p.value USING latin1) USING utf8mb4))
            ORDER BY HEX(p.value) LIMIT 17`.execute(connection)).rows;
        if (statuses.length > 16) unsupported();
        return {current: {year,month}, days: days.map(row => ({day: number(row.day,1,31),count: number(row.count,1)})),
            previous,next, entryStatusCounts: statuses.map((row,index) => ({statusvis: decodedColumn(row, "status",
                "calendar:status:" + index, raw, 8192, true), count: number(row.count,1)})), otherPosterCount: statuses.reduce((sum,row) => sum+number(row.foreign_count),0)};
    }
    private async loadUserpics(connection: Connection, ownerId: number, dversion: number,
        raw: RawField[]): Promise<RawUserpics> {
        // Include directly requested X/S rows: native default skeleton/get can
        // read them even though keyword selection excludes them.
        const rows = (await sql<Row>`SELECT userid,picid,width,height,state,
            HEX(description) AS description_stored,
            HEX(CONVERT(description USING latin1)) AS description_original,
            HEX(CONVERT(CONVERT(description USING latin1) USING utf8mb4)) AS description_roundtrip
            FROM userpic2 WHERE userid=${ownerId} ORDER BY picid LIMIT 10001`.execute(connection)).rows;
        if (rows.length > 10000) unsupported();
        const pictures = rows.map(row => ({userid:number(row.userid,1),picid:number(row.picid,1),
            width:number(row.width),height:number(row.height),state:requiredString(row.state),
            description:decodedColumn(row,"description",`picture:${ownerId}:${row.picid}`,raw,4096,false)!}));
        const mappings = dversion >= 9 ?
            (await sql<Row>`SELECT m.mapid,m.picid,m.redirect_mapid,
                HEX(k.keyword) AS keyword_stored,
                HEX(CONVERT(k.keyword USING latin1)) AS keyword_original,
                HEX(CONVERT(CONVERT(k.keyword USING latin1) USING utf8mb4)) AS keyword_roundtrip
                FROM userpicmap3 m LEFT JOIN userkeywords k ON m.userid=k.userid AND m.kwid=k.kwid
                WHERE m.userid=${ownerId} ORDER BY m.mapid LIMIT 10001`.execute(connection)).rows :
            (await sql<Row>`SELECT NULL AS mapid,m.picid,NULL AS redirect_mapid,
                HEX(k.keyword) AS keyword_stored,
                HEX(CONVERT(k.keyword USING latin1)) AS keyword_original,
                HEX(CONVERT(CONVERT(k.keyword USING latin1) USING utf8mb4)) AS keyword_roundtrip
                FROM userpicmap2 m JOIN userkeywords k ON m.userid=k.userid AND m.kwid=k.kwid
                WHERE m.userid=${ownerId} ORDER BY m.kwid LIMIT 10001`.execute(connection)).rows;
        if (mappings.length > 10000) unsupported();
        return {pictures,mappings:mappings.map((row,index)=>({
            mapid:row.mapid===null?null:number(row.mapid),picid:row.picid===null?null:number(row.picid),
            redirectMapid:row.redirect_mapid===null?null:number(row.redirect_mapid),
            keyword:decodedColumn(row,"keyword",`picture-map:${ownerId}:${index}`,raw,4096,true)}))};
    }

    private async loadFeatures(connection: Connection, ownerId: number, spamreportBans: number): Promise<RawFeatureCounts> {
        const rows = (await sql<Row>`SELECT
            (SELECT COUNT(*) FROM usertags WHERE journalid = ${ownerId}) AS usertags,
            (SELECT COUNT(*) FROM userkeywords WHERE userid = ${ownerId}) AS userkeywords,
            (SELECT COUNT(*) FROM logtags WHERE journalid = ${ownerId}) AS logtags,
            (SELECT COUNT(*) FROM logtagsrecent WHERE journalid = ${ownerId}) AS logtagsrecent,
            (SELECT COUNT(*) FROM logkwsum WHERE journalid = ${ownerId}) AS logkwsum,
            (SELECT COUNT(*) FROM links WHERE journalid = ${ownerId}) AS links,
            (SELECT COUNT(*) FROM userpic2 WHERE userid = ${ownerId}) AS userpics,
            (SELECT COUNT(*) FROM talk2 WHERE journalid = ${ownerId}) AS comments`.execute(connection)).rows;
        if (rows.length !== 1) unsupported();
        const row = rows[0]!;
        return {spamreportBans,usertags: number(row.usertags),userkeywords: number(row.userkeywords),
            logtags: number(row.logtags),logtagsrecent: number(row.logtagsrecent),logkwsum: number(row.logkwsum),
            links: number(row.links),userpics: number(row.userpics),comments: number(row.comments)};
    }

    private async loadEntries(
        connection: Connection, ownerId: number, logRows: readonly Row[],
        itemIds: readonly number[], rawFields: RawField[], logNames: ReadonlyMap<number, string>,
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
            FROM logtext2 WHERE journalid = ${ownerId}
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
            FROM logtext2 WHERE journalid = ${ownerId}
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
            SELECT p.jitemid, p.propid,
                HEX(p.value) AS value_stored,
                HEX(CONVERT(p.value USING latin1)) AS value_original,
                HEX(CONVERT(CONVERT(p.value USING latin1) USING utf8mb4)) AS value_roundtrip
            FROM logprop2 AS p
            WHERE p.journalid = ${ownerId}
                AND p.jitemid IN (${sql.join(itemIds)})
            LIMIT 2001
        `.execute(connection)).rows;
        if (propRows.length > 2000) unsupported();
        const propsById = new Map<number, Record<string, string | null>>();
        for (const id of itemIds) propsById.set(id, Object.create(null));
        for (const row of propRows) {
            const id = number(row.jitemid, 1);
            const name = logNames.get(number(row.propid, 1));
            if (name === undefined) unsupported();
            const props = propsById.get(id);
            if (!props || Object.hasOwn(props, name)) unsupported();
            props[name] = decodedColumn(
                row, "value", "entry:" + id + ":prop:" + name,
                rawFields, 8192, true,
            );
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


}
