// public-encodings.ts
//
// SELECT-only native encoding codes and complete public table witnesses.
//
// Portions adapted from ljlib.pl load_codes and LJ/TextUtil.pm, forked from the
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

import {createHash} from "node:crypto";
import {sql} from "kysely";
import {PrimaryDatabases, type SqlRow} from "./primary";
import {SnapshotError} from "./errors";
import {decodeLegacyBytes} from "./legacy-text";
import type {ConfiguredDatabase} from "../startup-types";
import {NativeString} from "../../runtime/native-string";

export interface PublicEncodingSnapshot {
    readonly entries: readonly (readonly [NativeString, NativeString])[];
    readonly fingerprint: string;
}
const maximumRows = 100000;
function pv(row: SqlRow, field: string): NativeString {
    return NativeString.bytes(decodeLegacyBytes(row[field+"_stored"], row[field+"_original"],
        row[field+"_roundtrip"], 262144, 65536).originalBytes);
}
function sha(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
/** Native hash assignment after numeric sort: duplicate code's last row wins. */
export function encodingName(snapshot: PublicEncodingSnapshot, oldEncoding: number): NativeString | undefined {
    const key = Buffer.from(String(oldEncoding));
    let result: NativeString | undefined;
    for (const [code, name] of snapshot.entries) if (code.bytes().equals(key)) result = name;
    return result?.clone();
}

export class MysqlPublicEncodings {
    private readonly databases: PrimaryDatabases;
    private readonly issued = new WeakMap<PublicEncodingSnapshot, string>();
    constructor(database: ConfiguredDatabase) {this.databases = PrimaryDatabases.create(database);}
    async close(): Promise<void> {await this.databases.close();}
    async snapshot(): Promise<PublicEncodingSnapshot> {
        // ONLY codes/type=encoding is covered by the public-data engine exception.
        // Session READ ONLY remains enforced. No private authorization table is
        // read here and no native process/Memcache write is reproduced.
        const rows = await this.databases.snapshot(undefined, [], async connection =>
            (await sql<SqlRow>`SELECT HEX(code) AS code_stored,
                HEX(CONVERT(code USING latin1)) AS code_original,
                HEX(CONVERT(CONVERT(code USING latin1) USING utf8mb4)) AS code_roundtrip,
                HEX(item) AS item_stored, HEX(CONVERT(item USING latin1)) AS item_original,
                HEX(CONVERT(CONVERT(item USING latin1) USING utf8mb4)) AS item_roundtrip,
                sortorder FROM codes WHERE type='encoding' LIMIT ${maximumRows+1}`.execute(connection)).rows);
        if (rows.length > maximumRows) throw new SnapshotError("unavailable");
        for (const row of rows) if (typeof row.sortorder !== "number" || !Number.isSafeInteger(row.sortorder)) {
            throw new SnapshotError("unavailable");
        }
        // load_codes fetches without ORDER BY then uses stable numeric sort.
        // Retain equal-sort source order; do not invent code/name tie ordering.
        const sorted = [...rows].sort((a,b) => (a.sortorder as number)-(b.sortorder as number));
        const entries = Object.freeze(sorted.map(row => Object.freeze([pv(row,"code"),pv(row,"item")] as const)));
        const snapshot = Object.freeze({entries, fingerprint: sha(rows)});
        this.issued.set(snapshot, sha([snapshot.fingerprint, snapshot.entries.map(([code,name]) => [code.bytes().toString("base64"),name.bytes().toString("base64")])]));
        return snapshot;
    }
    async revalidate(snapshot: PublicEncodingSnapshot): Promise<boolean> {
        const issued = this.issued.get(snapshot);
        if (!issued || sha([snapshot.fingerprint, snapshot.entries.map(([code,name]) => [code.bytes().toString("base64"),name.bytes().toString("base64")])]) !== issued) return false;
        return (await this.snapshot()).fingerprint === snapshot.fingerprint;
    }
}
