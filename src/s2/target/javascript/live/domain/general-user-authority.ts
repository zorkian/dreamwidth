// general-user-authority.ts
//
// Request-private issuance of native UserLite account references.
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

import {randomBytes} from "node:crypto";
import type {PublicUserFacts} from "../data/public-users";
import type {GeneralPublicSession} from "./general-public-session";
import {SnapshotError} from "../data/errors";
import {prepareGeneralUserLite,type GeneralUserLiteModel,type PublicUserLiteOperations} from "./general-user-model";
import {NativeString} from "../../runtime/native-string";
import {concatStrings} from "../../runtime/native-string";
import {compareStrings} from "../../runtime/native-string";

export interface PreparedPublicUser {
    readonly model: GeneralUserLiteModel;
    readonly account: string;
}
interface SelectedPosterNode {
    readonly show:boolean;readonly posterLoaded:boolean;readonly posterSuspended:boolean;
    readonly posterId:number;readonly posterUsername:NativeString|undefined;
    readonly children:readonly SelectedPosterNode[];
}
/** Handles are issued by this request, never reconstructed from editable S2 fields. */
export class GeneralUserAuthority {
    private readonly accounts = new Map<string,PublicUserFacts>();
    private selectedPosters = new Map<string,number>();
    constructor(private readonly session: GeneralPublicSession,
        private readonly operations: PublicUserLiteOperations) {}
    /** Bind only selected, visible poster names to the source-selected ids. */
    bindSelectedCommentPosters(page:{readonly roots:readonly SelectedPosterNode[]}):void {
        const next=new Map(this.selectedPosters);
        const work=[...page.roots];
        while(work.length) {
            const node=work.pop()!;
            work.push(...node.children);
            if(!node.show||node.posterSuspended||!node.posterLoaded)continue;
            const name=node.posterUsername?.bytes().toString("latin1");
            if(!name||!/^[a-z0-9_]+$/.test(name)||!Number.isSafeInteger(node.posterId)||
                node.posterId<1)throw new SnapshotError("unavailable");
            const prior=next.get(name);
            if(prior!==undefined&&prior!==node.posterId)throw new SnapshotError("unavailable");
            next.set(name,node.posterId);
        }
        this.selectedPosters=next;
    }
    async load(name: NativeString): Promise<PreparedPublicUser | undefined> {
        const snapshot = await this.session.user(name);
        const selected=snapshot&&this.selectedPosters.get(snapshot.requestedName);
        if(selected!==undefined&&snapshot?.user?.userid!==selected)
            throw new SnapshotError("unavailable");
        if (!snapshot?.user) return undefined;
        const model = prepareGeneralUserLite(snapshot.user,this.operations)!;
        const account = randomBytes(32).toString("hex");
        this.accounts.set(account,snapshot.user);
        return Object.freeze({model,account});
    }
    /** get_url reloads the editable public name, rather than using private _u. */
    async url(name:NativeString,view:NativeString):Promise<NativeString> {
        const snapshot=await this.session.user(name);
        if(!snapshot?.user)return NativeString.bytes(Buffer.alloc(0));
        const pv=NativeString.hostUtf8Bytes;
        if(compareStrings(view,pv("userinfo"))===0)view=pv("profile");
        if(compareStrings(view,pv("recent"))===0)view=pv("");
        return concatStrings(concatStrings(this.operations.journalBase(snapshot.user),pv("/")),view);
    }
    /** Native equality reads private userid, never editable public names. */
    equals(left: string | null, right: string | null): boolean {
        const id = (handle: string | null) => handle === null ? 0 : this.account(handle).userid;
        return id(left) === id(right);
    }
    /** Trusted named host handlers alone use this parent-private account record. */
    account(handle: unknown): PublicUserFacts {
        if (typeof handle !== "string") throw new Error("Invalid private user account reference");
        const user = this.accounts.get(handle);
        if (!user) throw new Error("Unissued private user account reference");
        return user;
    }
}
