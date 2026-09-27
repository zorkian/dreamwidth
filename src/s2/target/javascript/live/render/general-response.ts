// general-response.ts
//
// Native page scalar length and parent byte-handle publication boundary.
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

import {NativeString,byteApiPayload,stringLength,type NativePVFrame} from "../../runtime/native-string";

/** Journal.pm sets length before HEAD skips print; GET reaches the byte socket. */
export function nativePageResponse(frame:NativePVFrame,method:"GET"|"HEAD"):
    {html:Uint8Array;contentLength:number} {
    const value=NativeString.fromFrame(frame);
    const contentLength=stringLength(value);
    return {html:method==="HEAD"?Buffer.alloc(0):byteApiPayload(value),contentLength};
}
