// general-subject-adapter.ts
//
// Installed Context bridge for the accepted credential-free subject cleaner.
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

import {cleanGeneralSubject} from "@dreamwidth/content/general-subject";
import {nativeCharacterClass} from "../../runtime/native-profile";
import {NativeString} from "../../runtime/native-string";
import type {Context} from "../../runtime/s2runtime";

type Options=Parameters<typeof cleanGeneralSubject>[1];
type Effect=ReturnType<typeof cleanGeneralSubject>["exceptionEffect"];
export type GeneralSubjectHelpers=Omit<Options,"characterClass"|"mode"|"limits">;

/** Named installed helpers supply authority; no generic callback from S2 input. */
export function generalSubjectAdapter(context:Context,limits:Options["limits"],
    helpers:GeneralSubjectHelpers,applyEffect:(effect:Effect)=>void):{
        clean(input:NativeString,mode:"subject"|"all"):NativeString} {
    const profile=context.scalarProfile;
    if(!profile)throw Error("Installed native character profile is required");
    return Object.freeze({clean(input:NativeString,mode:"subject"|"all"):NativeString {
        if(!NativeString.is(input))throw Error("Invalid original subject scalar");
        const result=cleanGeneralSubject(input.frame(),{...helpers,mode,limits,
            characterClass:(kind,codepoint,utf8)=>nativeCharacterClass(profile,kind,codepoint,utf8)});
        applyEffect(result.exceptionEffect);
        return NativeString.fromFrame(result.value);
    }});
}
