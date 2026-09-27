// general-site-url-client.ts
//
// Credential-free typed client for the public lj/site URL helper.
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

import {NativeString, encodeScalar, decodeScalar, type NativeScalarWire} from "../../runtime/native-scalar";
import type {GeneralWorkerChannel} from "./general-worker-channel";
import {PrivateTransportError} from "./private-transport";

export function decodeGeneralString(input: unknown): NativeString {
    try {
        const value = decodeScalar(input as NativeScalarWire);
        if (!NativeString.is(value) || JSON.stringify(encodeScalar(value)) !== JSON.stringify(input)) {
            throw new PrivateTransportError();
        }
        return value;
    } catch {throw new PrivateTransportError();}
}
/** Source URL expansion is not itself a sanitizer or a navigation grant. */
export function workerExpandSiteUrl(channel: GeneralWorkerChannel, path: NativeString): NativeString {
    if (!NativeString.is(path)) throw new PrivateTransportError();
    return channel.host("expand-site-url",{path:encodeScalar(path)},decodeGeneralString);
}
