// general-user-bindings.ts
//
// Worker-private native UserLite account references independent of editable public fields.
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

import {runtime} from "../../runtime/s2runtime";
import {PrivateTransportError} from "./private-transport";

/** Installed code binds once; no author field, property or integer grants a handle. */
export class GeneralUserBindings {
    private readonly accounts = new WeakMap<object,string>();
    bind(model: unknown, handle: string): void {
        if (!model || typeof model !== "object" || Array.isArray(model) || runtime.isContext(model) ||
            !/^[a-f0-9]{64}$/.test(handle) || this.accounts.has(model)) throw new PrivateTransportError();
        this.accounts.set(model,handle);
    }
    /** Native assignment preserves object references; fabricated/copy objects have no _u. */
    account(model: unknown): string | undefined {
        return model && typeof model === "object" ? this.accounts.get(model) : undefined;
    }
}
