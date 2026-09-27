// general-model-builtins.ts
//
// Installed native Date comparison callbacks for general model objects.
//
// Portions adapted from LJ::S2 object constructors, forked from the
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

import type {BuiltinFunction} from "../../runtime/s2runtime";
import {generalDateCompare,type GeneralModel} from "../domain/general-model-primitives";
export function generalModelCallbacks():Record<string,BuiltinFunction> {
    const compare:BuiltinFunction=(_ctx,thisDate,other)=>generalDateCompare(
        (thisDate??{}) as GeneralModel,(other??{}) as GeneralModel);
    return {_Date__compare:compare,_DateTime__compare:compare};
}
