// public-users.ts
//
// Primary public UserLite facts, absence and complete identity witnesses.
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

import {createHash} from "node:crypto";
import {sql} from "kysely";
import {PrimaryDatabases, requireTransactionalTables, type SqlRow} from "./primary";
import {SnapshotError} from "./errors";
import {decodeLegacyBytes} from "./legacy-text";
import type {ConfiguredDatabase} from "../startup-types";
import {NativeString} from "../../runtime/native-string";

export interface PublicUserFacts {
    readonly userid: number;
    readonly username: string;
    readonly clusterid: number;
    readonly status: string;
    readonly statusvis: string;
    readonly journaltype: string;
    readonly dversion: number;
    readonly caps: string;
    readonly name: NativeString;
    // Identity facts stay parent-private until a source-derived public display
    // helper projects them. They are never treated as regular usernames.
    readonly identity: {readonly type: string; readonly value: NativeString} | null;
}
export interface PublicUserSnapshot {
    readonly requestedName: string;
    readonly user: PublicUserFacts | null;
    readonly fingerprint: string;
}
function integer(value: unknown, minimum = 0): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) throw new SnapshotError("unavailable");
    return value;
}
function text(value: unknown): string {
    if (typeof value !== "string") throw new SnapshotError("unavailable");
    return value;
}
function pv(row: SqlRow, name: string): NativeString {
    return NativeString.bytes(decodeLegacyBytes(row[name + "_stored"], row[name + "_original"],
        row[name + "_roundtrip"], 262144, 65536).originalBytes);
}
const tables = ["user", "useridmap"] as const;
class PublicIdentityChanged extends Error {}

export class MysqlPublicUsers {
    private readonly issued = new WeakSet<object>();
    private readonly databases: PrimaryDatabases;
    constructor(database: ConfiguredDatabase) {this.databases = PrimaryDatabases.create(database);}
    async close(): Promise<void> {await this.databases.close();}
    /** Source canonicalization belongs to the installed helper, not SQL. */
    async snapshot(username: string): Promise<PublicUserSnapshot> {
        // canonical_username uses configured USERNAME_MAXLENGTH, which may
        // exceed the storage width. Query exact names rather than guessing a
        // shorter alias or rejecting an ordinary native absence result.
        if (!/^[a-z0-9_]+$/.test(username) || username.length > 262144) throw new SnapshotError("unavailable");
        const facts = await this.databases.snapshot(undefined, tables, async connection => {
            const rows = (await sql<SqlRow>`SELECT userid,user,clusterid,status,statusvis,journaltype,dversion,
                CAST(caps AS CHAR) AS caps,HEX(name) AS name_stored,
                HEX(CONVERT(name USING latin1)) AS name_original,
                HEX(CONVERT(CONVERT(name USING latin1) USING utf8mb4)) AS name_roundtrip
                FROM user WHERE BINARY user=BINARY ${username} LIMIT 2`.execute(connection)).rows;
            if (rows.length > 1) throw new SnapshotError("unavailable");
            const owner = rows[0];
            const mapping = (await sql<SqlRow>`SELECT userid,user FROM useridmap
                WHERE BINARY user=BINARY ${username} ${owner ? sql`OR userid=${integer(owner.userid, 1)}` : sql``}
                ORDER BY userid,user LIMIT 3`.execute(connection)).rows;
            if (!owner) {
                return {rows, mapping, identityRows: [], user: null, changed: mapping.length !== 0};
            }
            const userid = integer(owner.userid, 1);
            if (mapping.length !== 1 || mapping[0]!.userid !== userid || mapping[0]!.user !== username) {
                return {rows, mapping, identityRows: [], user: null, changed: true};
            }
            const journaltype = text(owner.journaltype);
            if (journaltype === "I") await requireTransactionalTables(connection, ["identitymap"]);
            const identityRows = journaltype === "I" ? (await sql<SqlRow>`SELECT idtype,
                HEX(identity) AS identity_stored,HEX(CONVERT(identity USING latin1)) AS identity_original,
                HEX(CONVERT(CONVERT(identity USING latin1) USING utf8mb4)) AS identity_roundtrip
                FROM identitymap WHERE userid=${userid} LIMIT 2`.execute(connection)).rows : [];
            if (identityRows.length > 1) throw new SnapshotError("unavailable");
            const caps = text(owner.caps);
            if (!/^(?:0|[1-9][0-9]*)$/.test(caps)) throw new SnapshotError("unavailable");
            const user: PublicUserFacts = Object.freeze({userid, username: text(owner.user),
                clusterid: integer(owner.clusterid), status: text(owner.status), statusvis: text(owner.statusvis),
                journaltype, dversion: integer(owner.dversion), caps, name: pv(owner, "name"),
                identity: identityRows.length ? Object.freeze({type: text(identityRows[0]!.idtype),
                    value: pv(identityRows[0]!, "identity")}) : null});
            return {rows, mapping, identityRows, user, changed: false};
        });
        if (facts.changed) throw new PublicIdentityChanged();
        const snapshot = Object.freeze({requestedName: username, user: facts.user,
            fingerprint: createHash("sha256").update(JSON.stringify([username, facts.rows, facts.mapping,
                facts.identityRows])).digest("hex")});
        this.issued.add(snapshot);
        return snapshot;
    }
    async revalidate(snapshot: PublicUserSnapshot): Promise<boolean> {
        if (!this.issued.has(snapshot)) return false;
        try {return (await this.snapshot(snapshot.requestedName)).fingerprint === snapshot.fingerprint;}
        catch (error) {
            if (error instanceof PublicIdentityChanged) return false;
            throw error;
        }
    }
}
