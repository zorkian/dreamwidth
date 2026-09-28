// public-comment-authors.ts
//
// Parent-only identity Comment cleaner trust and complete read witnesses.
//
// Portions adapted from LJ::Talk::treat_as_anon, LJ::User::trusts_or_has_member,
// DW::User::Edges::WatchTrust and DW::User::Edges::CommMembership. The LJ
// portions are inherited from LiveJournal under its GNU General Public License;
// see LICENSE and the original terms at:
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
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

import {createHash} from "node:crypto";
import {sql} from "kysely";
import {PrimaryDatabases,type SqlRow} from "./primary";
import type {ConfiguredDatabase} from "../startup-types";
import {SnapshotError} from "./errors";

export interface PublicCommentAnonymitySnapshot {
    readonly ownerId:number;readonly posterId:number;readonly ownerType:string;
    readonly posterName:string;readonly anonymous:boolean;readonly fingerprint:string;
}
class CommentIdentityChanged extends Error {}
function id(value:unknown):number {
    if(typeof value!=="number"||!Number.isSafeInteger(value)||value<1)
        throw new SnapshotError("unavailable");
    return value;
}
function name(value:unknown):string {
    if(typeof value!=="string"||!/^[a-z0-9_]{1,25}$/.test(value))
        throw new SnapshotError("unavailable");
    return value;
}

/** Identity trust is never inferred from a public badge, name or S2 property. */
export class MysqlPublicCommentAuthors {
    private readonly issued=new WeakSet<object>();
    private readonly databases:PrimaryDatabases;
    constructor(database:ConfiguredDatabase){this.databases=PrimaryDatabases.create(database);}
    async close():Promise<void>{await this.databases.close();}
    async snapshot(ownerId:number,posterId:number,ownerType:string,
        posterName:string):Promise<PublicCommentAnonymitySnapshot> {
        id(ownerId);id(posterId);name(posterName);
        if(!/^[A-Z]$/.test(ownerType))throw new SnapshotError("unavailable");
        const facts=await this.databases.snapshot(undefined,
            ["user","useridmap","reluser","wt_edges"],async connection=>{
                const ids=ownerId===posterId?[ownerId]:[ownerId,posterId];
                const rows=(await sql<SqlRow>`SELECT userid,user,journaltype,status,statusvis,
                    clusterid,dversion,CAST(caps AS CHAR) AS caps FROM user
                    WHERE userid IN (${sql.join(ids)}) ORDER BY userid LIMIT 3`.execute(connection)).rows;
                const owner=rows.find(row=>row.userid===ownerId),poster=rows.find(row=>row.userid===posterId);
                if(rows.length!==ids.length||!owner||!poster||owner.journaltype!==ownerType||
                    poster.journaltype!=="I"||poster.user!==posterName)
                    return {changed:true,rows,mappings:[] as SqlRow[],relationship:[] as SqlRow[],
                        anonymous:true};
                const names=rows.map(row=>name(row.user));
                const mappings=(await sql<SqlRow>`SELECT userid,user FROM useridmap
                    WHERE userid IN (${sql.join(ids)}) OR BINARY user IN (${sql.join(names)})
                    ORDER BY userid,user LIMIT 5`.execute(connection)).rows;
                if(mappings.length!==rows.length||rows.some(row=>!mappings.some(mapping=>
                    mapping.userid===row.userid&&mapping.user===row.user)))
                    return {changed:true,rows,mappings,relationship:[] as SqlRow[],anonymous:true};
                let relationship:SqlRow[]=[];let trusted=false;
                if(ownerType==="C") {
                    // member_of(identity,journal) reads the journal->identity E edge.
                    relationship=(await sql<SqlRow>`SELECT userid,targetid,type FROM reluser
                        WHERE userid=${ownerId} AND targetid=${posterId} AND type='E'
                        LIMIT 2`.execute(connection)).rows;
                    if(relationship.length>1)throw new SnapshotError("unavailable");
                    trusted=relationship.length===1;
                } else if(ownerId===posterId)trusted=true;
                else {
                    // trusts(journal,identity) tests the low bit of the public
                    // wt_edges groupmask, independently of watch-only bits.
                    relationship=(await sql<SqlRow>`SELECT from_userid,to_userid,
                        CAST(groupmask AS CHAR) AS groupmask FROM wt_edges
                        WHERE from_userid=${ownerId} AND to_userid=${posterId}
                        LIMIT 2`.execute(connection)).rows;
                    if(relationship.length>1)throw new SnapshotError("unavailable");
                    const mask=relationship[0]?.groupmask;
                    if(mask!==undefined&&!(typeof mask==="string"&&/^\d{1,20}$/.test(mask)))
                        throw new SnapshotError("unavailable");
                    trusted=mask!==undefined&&!!(BigInt(mask as string)&1n);
                }
                return {changed:false,rows,mappings,relationship,anonymous:!trusted};
            });
        if(facts.changed)throw new CommentIdentityChanged();
        const result=Object.freeze({ownerId,posterId,ownerType,posterName,anonymous:facts.anonymous,
            fingerprint:createHash("sha256").update(JSON.stringify([ownerId,posterId,ownerType,
                posterName,facts])).digest("hex")});
        this.issued.add(result);return result;
    }
    async revalidate(snapshot:PublicCommentAnonymitySnapshot):Promise<boolean> {
        if(!this.issued.has(snapshot))return false;
        try{return (await this.snapshot(snapshot.ownerId,snapshot.posterId,snapshot.ownerType,
            snapshot.posterName)).fingerprint===snapshot.fingerprint;}
        catch(error){if(error instanceof CommentIdentityChanged)return false;throw error;}
    }
}
