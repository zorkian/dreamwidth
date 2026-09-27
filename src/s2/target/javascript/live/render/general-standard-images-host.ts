// general-standard-images-host.ts
//
// Private installed standard-image source and fixed public-message operation.
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

import {NativeString} from "../../runtime/native-scalar";
import {GeneralStandardImages,type GeneralStandardImageReply} from "../domain/general-standard-images";
import {generalNativeHostResult,type GeneralNativeHostResult} from "./general-native-host-result";
import {PrivateTransportError} from "./private-transport";
import type {GeneralPublicSession} from "../domain/general-public-session";
/** Installed SELECT-only ML binding; all reached values are final-reread witnesses. */
export function parentInstalledStandardImages(parameters:unknown,source:GeneralStandardImages,
    session:GeneralPublicSession):Promise<GeneralNativeHostResult<GeneralStandardImageReply>> {
    return parentStandardImages(parameters,source,async key=>(await session.imageTranslation(key)).value);
}
export async function parentStandardImages(parameters:unknown,source:GeneralStandardImages,
    localize:(key:NativeString|undefined)=>Promise<NativeString|undefined>):Promise<GeneralNativeHostResult<GeneralStandardImageReply>> {
    if(!parameters||typeof parameters!=="object"||Array.isArray(parameters)||
        Object.keys(parameters).length!==1||(parameters as Record<string,unknown>).version!==1)
        throw new PrivateTransportError();
    return generalNativeHostResult(()=>source.reply(localize));
}
