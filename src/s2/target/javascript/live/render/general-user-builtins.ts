// general-user-builtins.ts
//
// Installed native UserLite constructor using the fixed parent helper.
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

import type {BuiltinFunction} from "../../runtime/s2runtime";
import {scalarPV} from "../../runtime/native-scalar";
import type {GeneralWorkerChannel} from "./general-worker-channel";
import {GeneralUserBindings} from "./general-user-bindings";
import {workerLoadUser,workerUserEquals} from "./general-user-client";

export function generalUserConstructor(channel:GeneralWorkerChannel,
    bindings:GeneralUserBindings):Record<string,BuiltinFunction> {
    const equals:BuiltinFunction=(_ctx,left,right)=>workerUserEquals(channel,bindings,left,right);
    return {_UserLite:(_ctx,name)=>workerLoadUser(channel,bindings,scalarPV(name)),
        _UserLite__equals:equals,_User__equals:equals,_Friend__equals:equals};
}
