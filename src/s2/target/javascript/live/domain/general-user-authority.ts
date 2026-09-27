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
import {prepareGeneralUserLite,type GeneralUserLiteModel,type PublicUserLiteOperations} from "./general-user-model";
import {NativeString} from "../../runtime/native-string";

export interface PreparedPublicUser {
    readonly model: GeneralUserLiteModel;
    readonly account: string;
}
/** Handles are issued by this request, never reconstructed from editable S2 fields. */
export class GeneralUserAuthority {
    private readonly accounts = new Map<string,PublicUserFacts>();
    constructor(private readonly session: GeneralPublicSession,
        private readonly operations: PublicUserLiteOperations) {}
    async load(name: NativeString): Promise<PreparedPublicUser | undefined> {
        const snapshot = await this.session.user(name);
        if (!snapshot?.user) return undefined;
        const model = prepareGeneralUserLite(snapshot.user,this.operations)!;
        const account = randomBytes(32).toString("hex");
        this.accounts.set(account,snapshot.user);
        return Object.freeze({model,account});
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
