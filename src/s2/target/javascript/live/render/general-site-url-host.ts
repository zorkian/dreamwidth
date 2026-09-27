// general-site-url-host.ts
//
// Typed private transport for the retained public lj/site URL helper.
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

import {NativeString, encodeScalar, type NativeScalarWire} from "../../runtime/native-scalar";
import type {NativeProfile} from "../../runtime/native-profile";
import type {PublicAppConfig} from "../contracts";
import {expandGeneralSiteUrl} from "../domain/general-site-url";
import {decodeGeneralString} from "./general-site-url-client";
import {PrivateTransportError} from "./private-transport";

/** Installed parent handler; request strings select no module, SQL or config key. */
export function parentExpandSiteUrl(parameters: unknown, config: Pick<PublicAppConfig,"siteRoot"|"usernameMaxLength">,
    profile: NativeProfile): NativeScalarWire {
    if (!parameters || typeof parameters !== "object" || Array.isArray(parameters) ||
        Object.keys(parameters).length !== 1 || !Object.hasOwn(parameters,"path")) throw new PrivateTransportError();
    const path = decodeGeneralString((parameters as Record<string,unknown>).path);
    return encodeScalar(expandGeneralSiteUrl(path,NativeString.hostUtf8Bytes(config.siteRoot),
        profile,config.usernameMaxLength));
}
