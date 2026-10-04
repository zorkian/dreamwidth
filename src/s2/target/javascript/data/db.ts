// db.ts
//
// Read-only connections to the global database and the user clusters.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import { gunzipSync } from "node:zlib";
import mysql from "mysql2/promise";
import type { DatabaseInfo, SiteConfig } from "../server/config";

export type Row = Record<string, unknown>;

// Perl connects with a latin1 connection charset and stores UTF-8 bytes, so
// reading text over latin1 as raw bytes returns exactly what Perl sees.
const TEXT_TYPES = new Set(["STRING", "VAR_STRING", "BLOB", "TINY_BLOB", "MEDIUM_BLOB", "LONG_BLOB"]);

export class Databases {
    private readonly pools = new Map<string, mysql.Pool>();

    constructor(private readonly config: SiteConfig) {}

    // LJ::get_db_reader
    async global(sql: string, params: unknown[] = []): Promise<Row[]> {
        return this.query(["slave", "master"], sql, params);
    }

    // LJ::get_cluster_reader
    async cluster(clusterId: number, sql: string, params: unknown[] = []): Promise<Row[]> {
        const pair = this.config.clusterPairActive[String(clusterId)];
        const roles = pair === "a" || pair === "b" ? [`cluster${clusterId}${pair}`]
            : [`cluster${clusterId}slave`, `cluster${clusterId}`];
        return this.query(roles, sql, params);
    }

    async close(): Promise<void> {
        await Promise.all([...this.pools.values()].map(pool => pool.end()));
    }

    private async query(roles: string[], sql: string, params: unknown[]): Promise<Row[]> {
        const [rows] = await this.pool(roles).query(sql, params);
        return rows as Row[];
    }

    private pool(roles: string[]): mysql.Pool {
        for (const role of roles) {
            const id = Object.keys(this.config.databases).find(key =>
                key === role || this.config.databases[key]!.roles.includes(role));
            if (id) return this.pools.get(id) ?? this.open(id, this.config.databases[id]!);
        }
        throw new Error(`No database for roles ${roles.join(", ")}`);
    }

    private open(id: string, info: DatabaseInfo): mysql.Pool {
        const pool = mysql.createPool({
            ...(info.socket && !info.host ? { socketPath: info.socket } : { host: info.host ?? "localhost", port: info.port ?? 3306 }),
            user: info.user, password: info.password, database: info.database,
            charset: "latin1", dateStrings: true, supportBigNumbers: true, connectionLimit: 8,
            typeCast: (field, next) => TEXT_TYPES.has(field.type) ? field.buffer() : next(),
        });
        // Writes stay with Perl; MySQL refuses any that reach these connections.
        pool.pool.on("connection", connection => connection.query("SET SESSION TRANSACTION READ ONLY"));
        this.pools.set(id, pool);
        return pool;
    }
}

// Decode a text column. LJ::text_uncompress marks compressed values with a
// gzip header.
export function text(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (!Buffer.isBuffer(value)) return String(value);
    const bytes = value[0] === 0x1f && value[1] === 0x8b ? gunzipSync(value) : value;
    return bytes.toString("utf8");
}

export function int(value: unknown): number {
    return value === null || value === undefined ? 0 : Number(Buffer.isBuffer(value) ? value.toString() : value);
}
