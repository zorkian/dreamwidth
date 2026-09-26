// primary.ts
//
// Configured primary connections; every read uses a read-only snapshot.
//
// Portions adapted from DBI::Role and LJ::DB, forked from the LiveJournal
// project owned and operated by Live Journal, Inc., and modified and expanded
// by Dreamwidth Studios, LLC. The original license is available at:
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
// In accordance with that license, this code and its modifications are provided
// under the GNU General Public License. See LICENSE in this distribution.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//

import { randomBytes } from "node:crypto";
import { Kysely, MysqlDialect, sql } from "kysely";
import mysql from "mysql2";
import type { ConfiguredDatabase, ConfiguredDatabaseSource } from "../startup-types";
import { SnapshotError } from "./errors";

export type ReadConnection = Kysely<Record<string, never>>;
export type SqlRow = Record<string, unknown>;

function invalid(): never { throw new SnapshotError("unsupported"); }
function record(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value) &&
        [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function text(value: unknown, max: number, empty = false): value is string {
    return typeof value === "string" && (empty || value.length > 0) &&
        value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
}

// DBI::Role::get_dbh selects the literal DBINFO master for the global role;
// cluster roles come from LJ::DB::master_role, never def_reader or a slave role.
export function primarySources(config: ConfiguredDatabase, cluster?: number):
readonly ConfiguredDatabaseSource[] {
    if (!record(config) || !text(config.defaultDatabase, 64) ||
        !Array.isArray(config.sources) || config.sources.length === 0 ||
        config.sources.length > 256 || !Array.isArray(config.clusters) ||
        config.clusters.length > 256 || !record(config.clusterPairActive)) invalid();
    const ids = new Set<string>();
    for (const source of config.sources) {
        if (!record(source) || !text(source.id, 128) || ids.has(source.id) ||
            !text(source.database, 64) || !text(source.user, 256, true) ||
            typeof source.password !== "string" || source.password.length > 65536 ||
            !record(source.roles)) invalid();
        ids.add(source.id);
        if (source.host !== null && !text(source.host, 1024, true)) invalid();
        if (source.port !== null && (typeof source.port !== "number" || !Number.isInteger(source.port) ||
            source.port < 1 || source.port > 65535)) invalid();
        if (source.socketPath !== null && (!text(source.socketPath, 4096) ||
            !source.socketPath.startsWith("/"))) invalid();
        for (const [role, weight] of Object.entries(source.roles)) {
            if (!text(role, 128) || typeof weight !== "number" ||
                !Number.isFinite(weight) || weight < 0) invalid();
        }
    }
    const clusters = new Set<number>();
    for (const id of config.clusters) {
        if (!Number.isSafeInteger(id) || id < 1 || clusters.has(id)) invalid();
        clusters.add(id);
    }
    for (const [id, side] of Object.entries(config.clusterPairActive)) {
        if (!/^[1-9][0-9]*$/.test(id) || !clusters.has(Number(id)) ||
            (side !== "a" && side !== "b")) invalid();
    }
    if (cluster === undefined) {
        const master = config.sources.find(source => source.id === "master");
        if (!master) invalid();
        return [master];
    }
    if (!clusters.has(cluster)) invalid();
    const role = `cluster${cluster}${config.clusterPairActive[String(cluster)] ?? ""}`;
    const sources = config.sources.filter(source => !source.id.startsWith("_") &&
        Object.hasOwn(source.roles, role) && source.roles[role]! > 0);
    if (!sources.length || !Number.isFinite(sources.reduce((n, s) => n + s.roles[role]!, 0))) {
        invalid();
    }
    return sources;
}

// Native host/socket precedence differs from mysql2's socketPath precedence.
// An unresolved native local default requires an explicit startup socket path.
export function primaryTransport(source: Pick<ConfiguredDatabaseSource, "host" | "port" | "socketPath">):
{socketPath: string} | {host: string; port?: number} {
    if (source.host === null || source.host === "" || source.host === "localhost") {
        if (source.socketPath === null) invalid();
        return {socketPath: source.socketPath};
    }
    return {host: source.host, ...(source.port === null ? {} : {port: source.port})};
}

export class PrimaryDatabases {
    private readonly pools = new Map<string, ReadConnection>();
    private closed = false;
    private constructor(private readonly config: ConfiguredDatabase) {}

    static create(config: ConfiguredDatabase): PrimaryDatabases {
        // Clone private startup input so callers cannot switch endpoints after
        // validation. The clone never appears in errors, snapshots or workers.
        try {
            const frozen = structuredClone(config);
            primarySources(frozen);
            for (const cluster of frozen.clusters) primarySources(frozen, cluster);
            return new PrimaryDatabases(frozen);
        } catch { throw new SnapshotError("unsupported"); }
    }

    private connection(source: ConfiguredDatabaseSource): ReadConnection {
        if (this.closed) throw new SnapshotError("unavailable");
        const transport = primaryTransport(source);
        const previous = this.pools.get(source.id);
        if (previous) return previous;
        const pool = mysql.createPool({
            ...transport,
            user: source.user, password: source.password, database: source.database,
            charset: "utf8mb4", dateStrings: true, supportBigNumbers: true,
            bigNumberStrings: true, connectionLimit: 2, waitForConnections: true,
            queueLimit: 4, connectTimeout: 3000, enableKeepAlive: false,
            multipleStatements: false,
        });
        const db = new Kysely<Record<string, never>>({dialect: new MysqlDialect({pool})});
        this.pools.set(source.id, db);
        return db;
    }

    async snapshot<T>(cluster: number | undefined, tables: readonly string[],
        read: (connection: ReadConnection) => Promise<T>): Promise<T> {
        const candidates = [...primarySources(this.config, cluster)];
        const role = cluster === undefined ? "master" :
            `cluster${cluster}${this.config.clusterPairActive[String(cluster)] ?? ""}`;
        while (candidates.length) {
            const total = candidates.reduce((n, s) => n + (cluster === undefined ? 1 : s.roles[role]!), 0);
            let choice = randomBytes(6).readUIntBE(0, 6) / 2 ** 48 * total;
            let index = 0;
            for (; index < candidates.length - 1; index++) {
                choice -= cluster === undefined ? 1 : candidates[index]!.roles[role]!;
                if (choice < 0) break;
            }
            const source = candidates.splice(index, 1)[0]!;
            try {
                return await this.connection(source).connection().execute(async connection => {
                    await sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`.execute(connection);
                    await sql`SET SESSION MAX_EXECUTION_TIME = 2000`.execute(connection);
                    await sql`START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY`.execute(connection);
                    try {
                        const database = (await sql<SqlRow>`SELECT DATABASE() AS dbname`.execute(connection)).rows[0];
                        if (database?.dbname !== source.database) invalid();
                        if (tables.length) {
                            const engines = (await sql<SqlRow>`SELECT TABLE_NAME AS name, ENGINE AS engine
                                FROM information_schema.TABLES WHERE TABLE_SCHEMA = ${source.database}
                                AND TABLE_NAME IN (${sql.join(tables)}) AND TABLE_TYPE = 'BASE TABLE'
                            `.execute(connection)).rows;
                            if (engines.length !== tables.length || engines.some(row => row.engine !== "InnoDB")) {
                                invalid();
                            }
                        }
                        return await read(connection);
                    } finally { await sql`ROLLBACK`.execute(connection); }
                });
            } catch (error) {
                if (error instanceof SnapshotError) throw error;
                // Only configured providers of this exact primary role may be
                // retried. Never fall back to a reader/slave role or cache.
                if (!candidates.length) throw new SnapshotError("unavailable");
            }
        }
        throw new SnapshotError("unavailable");
    }

    async close(): Promise<void> {
        this.closed = true;
        const outcomes = await Promise.allSettled([...this.pools.values()].map(db => db.destroy()));
        if (outcomes.some(outcome => outcome.status === "rejected")) throw new SnapshotError("unavailable");
    }
}
