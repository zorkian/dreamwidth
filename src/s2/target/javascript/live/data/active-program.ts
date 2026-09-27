// active-program.ts
//
// Read-only, dependency-bracketed authority for general active S2 programs.
//
// Portions adapted from LJ/S2.pm and LJ/User/Account.pm, forked from the
// LiveJournal project owned and operated by Live Journal, Inc., and modified
// and expanded by Dreamwidth Studios, LLC. The original license is available at:
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
// In accordance with that license, this code and its modifications are provided
// under the GNU General Public License. See LICENSE in this distribution.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.
// The inherited notice above applies to adapted LiveJournal portions.
//

import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {sql} from 'kysely';
import {PrimaryDatabases, requireTransactionalTables, type ReadConnection, type SqlRow} from './primary';
import {SnapshotError} from './errors';
import {decodeLegacyBytes} from './legacy-text';
import {ACTIVE_LAYER_ORDER, activeStyleId, publicLayerAliases, selectActiveStyle,
    type ActiveProgramRequest, type ActiveStyleSelection, type PublicLayerDefinition} from '../domain/active-style';
import type {LiveStoreConfig} from '../startup-types';
import type {ActiveLayerInput, ActiveStyleSnapshot, LayerType} from '../render/layer-artifact';

export interface ActiveJournalIdentity {
    readonly userid: number; readonly username: string; readonly clusterId: number;
    readonly status: string; readonly statusvis: string; readonly journaltype: string;
    readonly dversion: number; readonly caps: string;
}
export interface ActiveProgramSnapshot {
    readonly request: ActiveProgramRequest;
    readonly journal: ActiveJournalIdentity;
    readonly selection: ActiveStyleSelection;
    readonly program: ActiveStyleSnapshot;
    readonly fingerprint: string;
    // Parent dependency evidence, never projected into an HTML/public model.
    readonly dependencies: readonly ActiveLayerDependency[];
}
export interface ActiveLayerDependency {
    readonly id: number; readonly ownerId: number | null; readonly ownerCluster: number | null;
    readonly role: string; readonly storedSha256: string | null;
    readonly decodedSha256: string | null; readonly sourceSha256: string | null;
    readonly compiledTime: number | null;
}
const GLOBAL_TABLES = ['user', 'useridmap', 'userproplist', 's2layers', 's2info'] as const;
const STYLE_PROPS = ['stylesys', 's2_style', 'use_journalstyle_entry_page'] as const;
const INFO_KEYS = ['redist_uniq', 'type', 'name', 'langcode', 'majorversion', '_previews',
    'des', 'note', 'author', 'author_name', 'author_email', 'is_internal'] as const;
const digest = (value: Uint8Array | string): string => createHash('sha256').update(value).digest('hex');
const jsonDigest = (value: unknown): string => digest(JSON.stringify(value));
function invalid(): never {throw new SnapshotError('unsupported');}
function id(value: unknown, min = 0): number {
    const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > 4294967295) invalid();
    return parsed;
}
function text(value: unknown): string {if (typeof value !== 'string') invalid(); return value;}
function hex(value: unknown): Buffer {
    if (typeof value !== 'string' || !/^(?:[0-9A-F]{2})*$/i.test(value) || value.length > 33554430) invalid();
    return Buffer.from(value, 'hex');
}
function identity(row: SqlRow): ActiveJournalIdentity {
    return Object.freeze({userid: id(row.userid, 1), username: text(row.user), clusterId: id(row.clusterid),
        status: text(row.status), statusvis: text(row.statusvis), journaltype: text(row.journaltype),
        dversion: id(row.dversion), caps: text(row.caps)});
}
interface GlobalFacts {
    journal: ActiveJournalIdentity; system: ActiveJournalIdentity;
    rows: readonly SqlRow[]; definitions: readonly SqlRow[]; publicLayers: readonly PublicLayerDefinition[];
    globalProps: readonly SqlRow[];
}
interface ClusterFacts {rows: readonly SqlRow[]; settings: Readonly<Record<string, string | null>>; map: Readonly<Record<string, number>>;}
interface LayerFacts {rows: readonly SqlRow[]; definitions: ReadonlyMap<number, SqlRow>; owners: ReadonlyMap<number, ActiveJournalIdentity>;}

export class MysqlActivePrograms {
    private readonly databases: PrimaryDatabases;
    private readonly config: LiveStoreConfig;
    constructor(config: LiveStoreConfig) {
        this.config = structuredClone(config);
        this.databases = PrimaryDatabases.create(this.config.database);
    }
    async close(): Promise<void> {await this.databases.close();}
    private async user(db: ReadConnection, by: {name: string} | {id: number}): Promise<{value: ActiveJournalIdentity; rows: SqlRow[]}|null> {
        const predicate = 'name' in by ? sql`BINARY user = BINARY ${by.name}` : sql`userid = ${by.id}`;
        const rows = (await sql<SqlRow>`SELECT userid,user,clusterid,status,statusvis,journaltype,dversion,
            CAST(caps AS CHAR) AS caps FROM user WHERE ${predicate} LIMIT 2`.execute(db)).rows;
        if (!rows.length) return null;
        if (rows.length !== 1) invalid();
        const value = identity(rows[0]!);
        const mappings = (await sql<SqlRow>`SELECT userid,user FROM useridmap WHERE userid=${value.userid}
            OR BINARY user=BINARY ${value.username} ORDER BY userid,user LIMIT 3`.execute(db)).rows;
        if (mappings.length !== 1 || id(mappings[0]!.userid) !== value.userid || mappings[0]!.user !== value.username) invalid();
        if ((BigInt(value.caps) & BigInt(this.config.capabilities.moveInProgressMask)) !== 0n) {
            throw new SnapshotError('unavailable');
        }
        return {value, rows: [...rows, ...mappings]};
    }
    private async global(request: ActiveProgramRequest): Promise<GlobalFacts | null> {
        return this.databases.snapshot(undefined, GLOBAL_TABLES, async db => {
            const journal = await this.user(db, {name: request.username});
            if (!journal) return null;
            const system = await this.user(db, {name: 'system'});
            if (!system) invalid();
            const definitions = (await sql<SqlRow>`SELECT upropid,name,indexed,datatype,cldversion,multihomed
                FROM userproplist WHERE name IN (${sql.join(STYLE_PROPS)}) ORDER BY upropid`.execute(db)).rows;
            const globalProps: SqlRow[] = [];
            for (const table of ['userprop', 'userproplite']) {
                const selected = definitions.filter(row => row.datatype !== 'blobchar' &&
                    ((String(row.multihomed) === '1' && table === 'userprop') ||
                    (!(id(row.cldversion ?? 0) > 0 && journal.value.dversion >= id(row.cldversion ?? 0)) &&
                    String(row.multihomed) !== '1' && (String(row.indexed) === '1' ? 'userprop' : 'userproplite') === table)));
                if (!selected.length) continue;
                await requireTransactionalTables(db, [table]);
                const props = (await sql<SqlRow>`SELECT upropid, HEX(value) AS stored_bytes,
                    HEX(CONVERT(value USING latin1)) AS original,
                    HEX(CONVERT(CONVERT(value USING latin1) USING utf8mb4)) AS roundtrip
                    FROM ${sql.table(table)} WHERE userid=${journal.value.userid}
                    AND upropid IN (${sql.join(selected.map(row => id(row.upropid, 1)))}) ORDER BY upropid`.execute(db)).rows;
                globalProps.push(...props.map(row => ({...row, table})));
            }
            const publicRows = (await sql<SqlRow>`SELECT l.s2lid,l.b2lid,l.type,i.infokey,i.value
                FROM s2layers l JOIN s2info i ON i.s2lid=l.s2lid WHERE l.userid=${system.value.userid}
                AND i.infokey IN (${sql.join(INFO_KEYS)}) ORDER BY l.s2lid,i.infokey`.execute(db)).rows;
            const publicById = new Map<number, {id: number; parentId: number; info: Record<string, string>}>();
            for (const row of publicRows) {
                const layerId = id(row.s2lid, 1);
                let layer = publicById.get(layerId);
                if (!layer) {layer = {id: layerId, parentId: id(row.b2lid), info: {}}; publicById.set(layerId, layer);}
                if (row.infokey !== null) layer.info[text(row.infokey)] = text(row.value);
            }
            return {journal: journal.value, system: system.value, definitions, globalProps,
                publicLayers: [...publicById.values()], rows: [...journal.rows, ...system.rows, ...definitions, ...globalProps, ...publicRows]};
        });
    }
    private async cluster(global: GlobalFacts, requestedStyle?: number): Promise<ClusterFacts> {
        const cluster = global.journal.clusterId || undefined;
        return this.databases.snapshot(cluster, ['s2stylelayers2'], async db => {
            const rows: SqlRow[] = [];
            for (const table of ['userproplite2', 'userpropblob']) {
                const selected = global.definitions.filter(row => row.datatype === 'blobchar' ? table === 'userpropblob' :
                    table === 'userproplite2' && (String(row.multihomed) === '1' ||
                    (id(row.cldversion ?? 0) > 0 && global.journal.dversion >= id(row.cldversion ?? 0))));
                if (!selected.length) continue;
                await requireTransactionalTables(db, [table]);
                const values = (await sql<SqlRow>`SELECT upropid,HEX(value) AS stored_bytes,
                    HEX(CONVERT(value USING latin1)) AS original,
                    HEX(CONVERT(CONVERT(value USING latin1) USING utf8mb4)) AS roundtrip
                    FROM ${sql.table(table)} WHERE userid=${global.journal.userid}
                    AND upropid IN (${sql.join(selected.map(row => id(row.upropid, 1)))}) ORDER BY upropid`.execute(db)).rows;
                rows.push(...values.map(row => ({...row, table})));
            }
            const settings: Record<string, string | null> = {};
            for (const definition of global.definitions) {
                const propId = id(definition.upropid, 1);
                const clustered = id(definition.cldversion ?? 0) > 0 && global.journal.dversion >= id(definition.cldversion ?? 0);
                const multihomed = String(definition.multihomed) === '1';
                const preferred = definition.datatype === 'blobchar' ? 'userpropblob' : clustered || multihomed ? 'userproplite2' :
                    String(definition.indexed) === '1' ? 'userprop' : 'userproplite';
                let row = [...global.globalProps, ...rows].find(row => row.table === preferred && id(row.upropid) === propId);
                if (!row && multihomed) row = global.globalProps.find(row => row.table === 'userprop' && id(row.upropid) === propId);
                settings[text(definition.name)] = row && row.stored_bytes !== null ?
                    decodeLegacyBytes(row.stored_bytes, row.original, row.roundtrip, 16777215, 16777215).originalBytes.toString('latin1') : null;
            }
            const styleId = requestedStyle ?? activeStyleId(settings);
            const layerRows = styleId ? (await sql<SqlRow>`SELECT type,s2lid FROM s2stylelayers2
                WHERE userid=${global.journal.userid} AND styleid=${styleId} ORDER BY type,s2lid`.execute(db)).rows : [];
            const map: Record<string, number> = {};
            for (const row of layerRows) map[text(row.type)] = id(row.s2lid);
            return {rows: [...rows, ...layerRows], settings, map};
        });
    }
    private async layers(ids: readonly number[]): Promise<LayerFacts> {
        return this.databases.snapshot(undefined, ['user', 'useridmap', 's2layers', 's2source_inno'], async db => {
            const rows: SqlRow[] = [];
            const definitions = new Map<number, SqlRow>(), owners = new Map<number, ActiveJournalIdentity>();
            if (ids.length) {
                const found = (await sql<SqlRow>`SELECT l.s2lid,l.userid,l.b2lid,l.type,
                    HEX(s.s2code) AS source FROM s2layers l LEFT JOIN s2source_inno s ON s.s2lid=l.s2lid
                    WHERE l.s2lid IN (${sql.join(ids)}) ORDER BY l.s2lid`.execute(db)).rows;
                rows.push(...found);
                for (const row of found) definitions.set(id(row.s2lid, 1), row);
                for (const ownerId of [...new Set(found.map(row => id(row.userid, 1)))].sort((a,b) => a-b)) {
                    const owner = await this.user(db, {id: ownerId});
                    if (owner) {owners.set(ownerId, owner.value); rows.push(...owner.rows);}
                }
            }
            return {rows, definitions, owners};
        });
    }
    async load(requestInput: ActiveProgramRequest): Promise<ActiveProgramSnapshot | null> {
        const request = Object.freeze(structuredClone(requestInput));
        if (!/^[a-z0-9_]{1,25}$/.test(request.username) || !['recent', 'entry'].includes(request.view) ||
            !['journal', 'default', 'siteviews', 'sitefeeds'].includes(request.selection)) invalid();
        // Legacy configuration can serve its existing journal/default path,
        // but cannot authorize a guessed default SiteScheme inheritance.
        if (request.selection === 'siteviews' && this.config.styles.siteSchemeInheritance === undefined) {
            throw new SnapshotError('unavailable');
        }
        const global = await this.global(request);
        if (!global) return null;
        if ((request.selection === 'sitefeeds' || (request.selection === 'journal' && global.journal.journaltype === 'Y')) &&
            this.config.styles.defaultFeedStyle === undefined) throw new SnapshotError('unavailable');
        const sitefeeds = request.selection === 'sitefeeds' || (request.selection === 'journal' &&
            global.journal.journaltype === 'Y' && Object.keys(this.config.styles.defaultFeedStyle ?? {}).length > 0);
        const selectedRequest: ActiveProgramRequest = sitefeeds ? {...request, selection: 'sitefeeds'} : request;
        const mapStyle = sitefeeds || request.selection === 'default' ? 0 : undefined;
        const cluster = await this.cluster(global, mapStyle);
        const aliases = publicLayerAliases(global.publicLayers, this.config.styles);
        let selection = selectActiveStyle(activeStyleId(cluster.settings), cluster.map, aliases, this.config.styles, selectedRequest);
        const reads: unknown[] = [global.rows, cluster.rows];
        const dependencies: ActiveLayerDependency[] = [];
        const load = async (): Promise<ActiveLayerInput[]> => {
            const ids = [...new Set(ACTIVE_LAYER_ORDER.map(role => selection.effective[role]).filter((id): id is number => !!id))];
            const definitions = await this.layers(ids);
            reads.push(definitions.rows);
            const active = new Map<number, SqlRow>();
            const groups = new Map<number, {id: number; ownerId: number}[]>();
            for (const layerId of ids) {
                const definition = definitions.definitions.get(layerId);
                if (!definition) continue;
                const ownerId = id(definition.userid, 1), owner = definitions.owners.get(ownerId);
                if (!owner) continue;
                const cid = ownerId === global.system.userid ? 0 : owner.clusterId;
                const group = groups.get(cid) ?? []; group.push({id: layerId, ownerId}); groups.set(cid, group);
            }
            for (const [cid, group] of groups) {
                const table = cid ? 's2compiled2' : 's2compiled';
                const found = await this.databases.snapshot(cid || undefined, [table], async db => {
                    const predicate = cid ? sql.join(group.map(layer => sql`(userid=${layer.ownerId} AND s2lid=${layer.id})`), sql` OR `) :
                        sql`s2lid IN (${sql.join(group.map(layer => layer.id))})`;
                    return (await sql<SqlRow>`SELECT s2lid,comptime,HEX(compdata) AS stored_bytes FROM ${sql.table(table)}
                        WHERE ${predicate} ORDER BY s2lid`.execute(db)).rows;
                });
                reads.push({cid, group, found});
                for (const row of found) active.set(id(row.s2lid, 1), row);
            }
            const result: ActiveLayerInput[] = [];
            for (const role of ACTIVE_LAYER_ORDER) {
                const layerId = selection.effective[role];
                if (!layerId) continue;
                const definition = definitions.definitions.get(layerId), compiled = active.get(layerId);
                const ownerId = definition ? id(definition.userid, 1) : null;
                const owner = ownerId === null ? undefined : definitions.owners.get(ownerId);
                let stored: Buffer | null = null, decoded: Buffer | null = null;
                if (compiled && compiled.stored_bytes !== null) {
                    stored = hex(compiled.stored_bytes); decoded = stored;
                    const cid = ownerId === global.system.userid ? 0 : owner?.clusterId;
                    if (cid && stored[0] === 31 && stored[1] === 139) {
                        try {decoded = gunzipSync(stored, {maxOutputLength: 16777216});}
                        catch (error) {
                            // A native corrupt-stream miss is different from our
                            // explicit decoded-byte resource ceiling.
                            if ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') invalid();
                            decoded = null;
                        }
                    }
                    if (decoded && decoded.length > 16777215) invalid();
                }
                const source = definition?.source === null || definition?.source === undefined ? null : hex(definition.source);
                dependencies.push({id: layerId, role, ownerId, ownerCluster: owner?.clusterId ?? null,
                    storedSha256: stored === null ? null : digest(stored), decodedSha256: decoded === null ? null : digest(decoded),
                    sourceSha256: source === null ? null : digest(source), compiledTime: compiled ? id(compiled.comptime) : null});
                if (definition && owner && decoded?.length) result.push({id: layerId, ownerId: owner.userid,
                    parentId: id(definition.b2lid), type: text(definition.type) as LayerType, sourceBytes: source,
                    activeCompiledBytes: decoded, compiledTime: id(compiled!.comptime)});
            }
            const after = await this.layers(ids);
            if (jsonDigest(after.rows) !== jsonDigest(definitions.rows)) throw new SnapshotError('unavailable');
            return result;
        };
        let layers = await load();
        const criticalMissing = (): boolean => ['core', 'layout'].some(role => selection.effective[role] && !layers.some(layer => layer.id === selection.effective[role]));
        if (criticalMissing() && selection.origin !== 'default') {
            selection = selectActiveStyle(0, {}, aliases, this.config.styles, {...request, selection: 'default'});
            layers = await load();
        }
        if (criticalMissing()) throw new SnapshotError('unavailable');
        const afterGlobal = await this.global(request);
        if (!afterGlobal || jsonDigest(afterGlobal.rows) !== jsonDigest(global.rows)) throw new SnapshotError('unavailable');
        const afterCluster = await this.cluster(afterGlobal, mapStyle);
        if (jsonDigest(afterCluster.rows) !== jsonDigest(cluster.rows)) throw new SnapshotError('unavailable');
        const fingerprint = jsonDigest([request, this.config.styles, this.config.capabilities, selection, reads]);
        return Object.freeze({request, journal: global.journal, selection,
            program: Object.freeze({styleId: selection.styleId, systemUserId: global.system.userid,
                layers: Object.freeze(layers)}), dependencies: Object.freeze(dependencies), fingerprint});
    }
    async revalidate(snapshot: ActiveProgramSnapshot): Promise<boolean> {
        const fresh = await this.load(snapshot.request);
        return fresh !== null && fresh.fingerprint === snapshot.fingerprint;
    }
}
