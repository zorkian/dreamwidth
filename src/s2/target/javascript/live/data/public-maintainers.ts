// public-maintainers.ts
//
// Parent-only current community-maintainer authority and complete read witnesses.
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
// Semantic ports from LJ::Entry::admin_post and LJ::User::can_manage, forked
// from the LiveJournal project owned and operated by Live Journal, Inc., and
// modified and expanded by Dreamwidth Studios, LLC. The original license is at:
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
// Adapted portions and their modifications are under the GNU General Public
// License. See LICENSE in this distribution.
//

import {createHash} from "node:crypto";
import {sql} from "kysely";
import {PrimaryDatabases,requireTransactionalTables,type SqlRow} from "./primary";
import type {ConfiguredDatabase} from "../startup-types";
import {SnapshotError} from "./errors";

export interface PublicMaintainerSnapshot {
    readonly journalId:number;
    readonly posterId:number;
    readonly canManage:boolean;
    readonly fingerprint:string;
}
class MaintainerIdentityChanged extends Error {}
function id(value:unknown):number {
    if(typeof value!=="number"||!Number.isSafeInteger(value)||value<1)throw new SnapshotError("unavailable");
    return value;
}

/** No relationship row or account fields are projected into the worker. */
export class MysqlPublicMaintainers {
    private readonly issued=new WeakSet<object>();
    private readonly databases:PrimaryDatabases;
    constructor(database:ConfiguredDatabase){this.databases=PrimaryDatabases.create(database);}
    async close():Promise<void>{await this.databases.close();}
    async snapshot(journalId:number,posterId:number):Promise<PublicMaintainerSnapshot> {
        id(journalId);id(posterId);
        const facts=await this.databases.snapshot(undefined,["user","useridmap"],async connection=>{
            const load=async (userid:number):Promise<SqlRow[]>=>{
                const rows=(await sql<SqlRow>`SELECT userid,user,journaltype,status,statusvis,clusterid,dversion,
                    CAST(caps AS CHAR) AS caps FROM user WHERE userid=${userid} LIMIT 2`.execute(connection)).rows;
                if(rows.length>1)throw new SnapshotError("unavailable");
                return rows;
            };
            const journalRows=await load(journalId),journal=journalRows[0];
            // Entry::admin_post short-circuits before poster/relationship lookup
            // for every non-community journal, independently of the stored prop.
            const community=journal?.journaltype==="C";
            const posterRows=community?(posterId===journalId?journalRows:await load(posterId)):[];
            const poster=posterRows[0],users=posterId===journalId?journalRows:[...journalRows,...posterRows];
            const mappings:SqlRow[]=[];
            for(const user of users) {
                const rows=(await sql<SqlRow>`SELECT userid,user FROM useridmap WHERE userid=${id(user.userid)}
                    OR BINARY user=BINARY ${user.user as string} LIMIT 3`.execute(connection)).rows;
                if(rows.length!==1||rows[0]!.userid!==user.userid||rows[0]!.user!==user.user)
                    throw new MaintainerIdentityChanged();
                mappings.push(...rows);
            }
            let relationships:SqlRow[]=[];
            if(community&&poster&&posterId!==journalId) {
                // get_reluser_id returns zero for every one-character type,
                // BEFORE its hook. Native 'A' therefore always uses global reluser.
                await requireTransactionalTables(connection,["reluser"]);
                relationships=(await sql<SqlRow>`SELECT userid,targetid,type FROM reluser
                    WHERE userid=${journalId} AND targetid=${posterId} AND type='A'`.execute(connection)).rows;
            }
            return {journalRows,posterRows,mappings,relationships,
                canManage:!!(community&&poster&&(posterId===journalId||relationships.length))};
        });
        const result=Object.freeze({journalId,posterId,canManage:facts.canManage,
            fingerprint:createHash("sha256").update(JSON.stringify([journalId,posterId,facts])).digest("hex")});
        this.issued.add(result);return result;
    }
    async revalidate(snapshot:PublicMaintainerSnapshot):Promise<boolean> {
        if(!this.issued.has(snapshot))return false;
        try{return (await this.snapshot(snapshot.journalId,snapshot.posterId)).fingerprint===snapshot.fingerprint;}
        catch(error){if(error instanceof MaintainerIdentityChanged)return false;throw error;}
    }
}
