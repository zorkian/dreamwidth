// general-image-url-client.ts
//
// Credential-free typed client for the installed image URL helper.
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
import type {GeneralWorkerChannel} from "./general-worker-channel";
import {decodeGeneralString} from "./general-site-url-client";
import {PrivateTransportError} from "./private-transport";

/** Native cleaner binds journal and ditemid to byte-empty, not child-selected identities. */
export function workerNormalizeImageUrl(channel:GeneralWorkerChannel,url:NativeString):NativeString {
    if(!NativeString.is(url))throw new PrivateTransportError();
    return channel.host("normalize-image-url",{url:encodeScalar(url)},decodeGeneralString);
}
