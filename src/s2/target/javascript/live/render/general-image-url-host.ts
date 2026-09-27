// general-image-url-host.ts
//
// Typed parent handler for the installed public image URL helper.
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

import {encodeScalar,type NativeScalarWire} from "../../runtime/native-scalar";
import type {NativeProfile} from "../../runtime/native-profile";
import {normalizeGeneralImageUrl,type GeneralImageUrlFacts} from "../domain/general-image-url";
import {decodeGeneralString} from "./general-site-url-client";
import {PrivateTransportError} from "./private-transport";

/** Fixed source helper, with configuration supplied only by the installed parent. */
export function parentNormalizeImageUrl(parameters:unknown,facts:GeneralImageUrlFacts,
    profile:NativeProfile):NativeScalarWire {
    if(!parameters||typeof parameters!=="object"||Array.isArray(parameters)||
        Object.keys(parameters).length!==1||!Object.hasOwn(parameters,"url"))throw new PrivateTransportError();
    const url=decodeGeneralString((parameters as Record<string,unknown>).url);
    return encodeScalar(normalizeGeneralImageUrl(url,facts,profile));
}
