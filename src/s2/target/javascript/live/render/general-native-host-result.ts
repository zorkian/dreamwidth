// general-native-host-result.ts
//
// Positively branded native helper errors on the private parent channel.
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

import {NativeString,decodeScalar,encodeScalar,legacyText,nativeProgramError,isNativeProgramError,type NativeScalarWire} from "../../runtime/native-scalar";
import {PrivateTransportError} from "./private-transport";
export type GeneralNativeHostResult<T>={readonly kind:"value";readonly value:T}|
    {readonly kind:"native-error";readonly error:NativeScalarWire};
/** Only installed semantic errors cross; unknown infrastructure remains terminal. */
export async function generalNativeHostResult<T>(operation:()=>T|Promise<T>):Promise<GeneralNativeHostResult<T>> {
    try{return {kind:"value",value:await operation()};}
    catch(error){
        if(!isNativeProgramError(error))throw error;
        return {kind:"native-error",error:encodeScalar(NativeString.hostUtf8Bytes(error.message))};
    }
}
/** This result originates exclusively on the authenticated private parent channel. */
export function generalNativeHostValue<T>(input:unknown,validate:(value:unknown)=>T):T {
    if(!input||typeof input!=="object"||Array.isArray(input))throw new PrivateTransportError();
    const value=input as Record<string,unknown>;
    if(value.kind==="value"&&Object.keys(value).length===2&&Object.hasOwn(value,"value"))return validate(value.value);
    if(value.kind==="native-error"&&Object.keys(value).length===2&&Object.hasOwn(value,"error")) {
        let message;
        try{message=decodeScalar(value.error as NativeScalarWire);}catch{throw new PrivateTransportError();}
        if(!NativeString.is(message)||message.bytes().length>65536)throw new PrivateTransportError();
        throw nativeProgramError(legacyText(message));
    }
    throw new PrivateTransportError();
}
