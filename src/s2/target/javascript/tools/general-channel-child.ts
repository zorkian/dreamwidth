// general-channel-child.ts
//
// Credential-free fixed private-channel test worker.
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

import {NativeString} from "../runtime/native-string";
import {workerExpandSiteUrl} from "../live/render/general-site-url-client";
import {GeneralWorkerChannel} from "../live/render/general-worker-channel";

const channel = new GeneralWorkerChannel(process.env.S2_PRIVATE_JOB!);
const start = channel.start(value => {
    if (value !== "fixed-channel-test" && value !== "fixed-preparation-error-test" && value !== "fixed-site-helper-test") throw new Error("Unexpected test start");
    return value;
});
if (start === "fixed-preparation-error-test") {
    channel.preparationResult({bytes: Buffer.from("<b>Error preparing to run:</b> &lt;author&gt;"), utf8: false});
    process.exit(0);
}
if (start === "fixed-site-helper-test") {
    const value = workerExpandSiteUrl(channel,NativeString.bytes(Buffer.from("user/mixed-name/", "ascii")));
    channel.resume({kind: "number", number: {mode: "iv", value: "3"}}, value => {
        if(value !== "fixed-selected-data") throw Error("Unexpected test resume");
    });
    channel.result(value.frame());
    process.exit(0);
}
channel.host("expand-site-url", {path: "fixed-test-path"}, value => {
    if (value !== "fixed-test-reply") throw new Error("Unexpected test reply");
});
channel.resume({kind: "number", number: {mode: "iv", value: "3"}}, value => {
    if (value !== "fixed-selected-data") throw new Error("Unexpected test resume");
});
channel.result({bytes: Uint8Array.from([0xff, 0x00, 0x61]), utf8: false});
