// general-user-client.ts
//
// Credential-free public UserLite delivery with private account binding.
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

import {NativeString,encodeScalar} from "../../runtime/native-scalar";
import {decodeGeneralModel} from "./general-model-wire";
import type {GeneralWorkerChannel} from "./general-worker-channel";
import {GeneralUserBindings} from "./general-user-bindings";
import {PrivateTransportError} from "./private-transport";
import {decodeGeneralString} from "./general-site-url-client";
import {generalNativeHostValue} from "./general-native-host-result";

export function workerUserUrl(channel:GeneralWorkerChannel,name:NativeString,view:NativeString):NativeString {
    return channel.host("user-url",{name:encodeScalar(name),view:encodeScalar(view)},
        value=>generalNativeHostValue(value,decodeGeneralString));
}

export function decodePreparedUser(input:unknown,bindings:GeneralUserBindings):unknown {
    if(input===null)return undefined;
    if(!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).length!==2||
        !Object.hasOwn(input,"model")||!Object.hasOwn(input,"account"))throw new PrivateTransportError();
    const row=input as Record<string,unknown>;
    const model=decodeGeneralModel(row.model);
    if(!model||typeof model!=="object"||(model as Record<string,unknown>)[".type"]!=="UserLite"||
        typeof row.account!=="string")throw new PrivateTransportError();
    bindings.bind(model,row.account);
    return model;
}
export function workerLoadUser(channel:GeneralWorkerChannel,bindings:GeneralUserBindings,
    name:NativeString):unknown {
    if(!NativeString.is(name))throw new PrivateTransportError();
    return channel.host("user-lite",{name:encodeScalar(name)},value=>decodePreparedUser(value,bindings));
}

/** Only installed binding state supplies account references to this fixed operation. */
export function workerUserEquals(channel:GeneralWorkerChannel,bindings:GeneralUserBindings,
    left:unknown,right:unknown):boolean {
    return channel.host("user-lite",{left:bindings.account(left)??null,right:bindings.account(right)??null},value=>{
        if(typeof value!=="boolean")throw new PrivateTransportError();
        return value;
    });
}
