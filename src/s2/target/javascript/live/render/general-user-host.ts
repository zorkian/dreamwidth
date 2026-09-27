// general-user-host.ts
//
// Parent-issued public UserLite responses for the fixed private helper.
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

import type {GeneralUserAuthority} from "../domain/general-user-authority";
import {decodeGeneralString} from "./general-site-url-client";
import {encodeGeneralModel} from "./general-model-wire";
import {PrivateTransportError} from "./private-transport";
import {generalNativeHostResult} from "./general-native-host-result";
import {encodeScalar} from "../../runtime/native-scalar";

export async function parentUserUrl(parameters:unknown,authority:GeneralUserAuthority):Promise<unknown> {
    if(!parameters||typeof parameters!=="object"||Array.isArray(parameters)||
        Object.keys(parameters).length!==2||!Object.hasOwn(parameters,"name")||
        !Object.hasOwn(parameters,"view"))throw new PrivateTransportError();
    const row=parameters as Record<string,unknown>;
    const name=decodeGeneralString(row.name),view=decodeGeneralString(row.view);
    return generalNativeHostResult(async()=>encodeScalar(await authority.url(name,view)));
}

export async function parentLoadUser(parameters:unknown,authority:GeneralUserAuthority):Promise<unknown> {
    if(parameters && typeof parameters==="object" && !Array.isArray(parameters) &&
        Object.keys(parameters).length===2 && Object.hasOwn(parameters,"left") && Object.hasOwn(parameters,"right")) {
        const row=parameters as Record<string,unknown>;
        if((row.left!==null && typeof row.left!=="string") ||
            (row.right!==null && typeof row.right!=="string"))throw new PrivateTransportError();
        return authority.equals(row.left as string|null,row.right as string|null);
    }
    if(!parameters||typeof parameters!=="object"||Array.isArray(parameters)||
        Object.keys(parameters).length!==1||!Object.hasOwn(parameters,"name"))throw new PrivateTransportError();
    const name=decodeGeneralString((parameters as Record<string,unknown>).name);
    const prepared=await authority.load(name);
    return prepared?{model:encodeGeneralModel(prepared.model),account:prepared.account}:null;
}
