// general-model-wire.ts
//
// Native scalar and alias-preserving transport of approved public models.
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

import {NativeString, NativeNumber, encodeScalar, decodeScalar, type NativeScalarWire} from "../../runtime/native-scalar";
import {runtime} from "../../runtime/s2runtime";
import {PrivateTransportError} from "./private-transport";

type Atom = {kind:"undefined"} | {kind:"null"} | {kind:"host"; value:string|number|boolean} |
    {kind:"scalar"; value:NativeScalarWire} | {kind:"reference"; id:number};
type ModelNode = {kind:"array"; length:number; entries:readonly (readonly [number,Atom])[]} |
    {kind:"object"; entries:readonly (readonly [Atom,Atom])[]};
export interface GeneralModelWire {readonly version:1; readonly root:Atom; readonly nodes:readonly ModelNode[];}
const maxNodes=100000, maxBytes=8*1024*1024;
function fail():never {throw new PrivateTransportError();}
function keys(value:unknown,names:readonly string[]):Record<string,unknown> {
    if(!value || typeof value!=="object" || Array.isArray(value) || Object.keys(value).length!==names.length ||
        names.some(name=>!Object.hasOwn(value,name)))fail();
    return value as Record<string,unknown>;
}
/** Only call AFTER named public-field approval; this is not a raw SQL projector. */
export function encodeGeneralModel(root:unknown):GeneralModelWire {
    const ids=new Map<object,number>(), pending:unknown[]=[], nodes:ModelNode[]=[];
    function atom(value:unknown):Atom {
        if(value===undefined)return {kind:"undefined"};
        if(value===null)return {kind:"null"};
        if(NativeString.is(value)||NativeNumber.is(value))return {kind:"scalar",value:encodeScalar(value)};
        if(typeof value==="string"||typeof value==="boolean"||typeof value==="number") {
            if(typeof value==="number" && (!Number.isFinite(value)||Object.is(value,-0)))fail();
            return {kind:"host",value};
        }
        if(typeof value!=="object" || runtime.isContext(value))fail();
        const prototype=Object.getPrototypeOf(value);
        if(!Array.isArray(value) && prototype!==null && prototype!==Object.prototype)fail();
        let id=ids.get(value);
        if(id===undefined) {
            if(pending.length>=maxNodes)fail();
            id=pending.length; ids.set(value,id);pending.push(value);
        }
        return {kind:"reference",id};
    }
    const result=atom(root);
    for(let index=0;index<pending.length;index++) {
        const value=pending[index]!;
        if(Array.isArray(value)) {
            if(value.length>maxNodes)fail();
            const entries:(readonly [number,Atom])[]=[];
            for(const key of Object.keys(value)) {
                if(!/^(?:0|[1-9][0-9]*)$/.test(key)||Number(key)>=value.length)fail();
                const descriptor=Object.getOwnPropertyDescriptor(value,key)!;
                if(!Object.hasOwn(descriptor,"value"))fail();
                entries.push([Number(key),atom(descriptor.value)]);
            }
            nodes.push({kind:"array",length:value.length,entries});
        }else {
            const object=value as Record<string,unknown>, sourceKeys=Object.keys(object);
            const nativeKeys=runtime.hashKeys(object);
            const entries:(readonly [Atom,Atom])[]=[];
            for(let i=0;i<sourceKeys.length;i++) {
                const descriptor=Object.getOwnPropertyDescriptor(object,sourceKeys[i]!)!;
                if(!Object.hasOwn(descriptor,"value"))fail();
                entries.push([atom(nativeKeys[i]),atom(descriptor.value)]);
            }
            nodes.push({kind:"object",entries});
        }
    }
    const wire={version:1 as const,root:result,nodes};
    if(Buffer.byteLength(JSON.stringify(wire))>maxBytes)fail();
    return wire;
}
export function decodeGeneralModel(input:unknown):unknown {
    const wire=keys(input,["version","root","nodes"]);
    if(wire.version!==1 || !Array.isArray(wire.nodes) || wire.nodes.length>maxNodes ||
        Buffer.byteLength(JSON.stringify(input))>maxBytes)fail();
    const records=wire.nodes.map((node:unknown)=>{
        if(!node||typeof node!=="object"||Array.isArray(node))fail();
        const kind=(node as Record<string,unknown>).kind;
        const record=keys(node,kind==="array"?["kind","length","entries"]:["kind","entries"]);
        if(!["array","object"].includes(kind as string)||!Array.isArray(record.entries))fail();
        if(kind==="array"&&(!Number.isSafeInteger(record.length)||(record.length as number)<0||(record.length as number)>maxNodes))fail();
        return record;
    });
    const objects=records.map(record=>record.kind==="array"?new Array(record.length as number):Object.create(null));
    function atom(input:unknown):unknown {
        if(!input||typeof input!=="object"||Array.isArray(input))fail();
        const kind=(input as Record<string,unknown>).kind;
        const record=keys(input,kind==="reference"?["kind","id"]:["undefined","null"].includes(kind as string)?["kind"]:["kind","value"]);
        if(kind==="undefined")return undefined;
        if(kind==="null")return null;
        if(kind==="reference") {
            if(!Number.isSafeInteger(record.id)||(record.id as number)<0||(record.id as number)>=objects.length)fail();
            return objects[record.id as number];
        }
        if(kind==="host") {
            const value=record.value;
            if(!["string","number","boolean"].includes(typeof value)||typeof value==="number"&&(!Number.isFinite(value)||Object.is(value,-0)))fail();
            return value;
        }
        if(kind==="scalar") {
            try {
                const scalar=decodeScalar(record.value as NativeScalarWire);
                if(JSON.stringify(encodeScalar(scalar))!==JSON.stringify(record.value))fail();
                return scalar;
            }catch{fail();}
        }
        fail();
    }
    for(let id=0;id<records.length;id++) {
        const record=records[id]!, object=objects[id], seen=new Set<string>();
        for(const entry of record.entries as unknown[]) {
            if(!Array.isArray(entry)||entry.length!==2)fail();
            if(record.kind==="array") {
                const index=entry[0];
                if(!Number.isSafeInteger(index)||index<0||index>=(record.length as number)||seen.has(String(index)))fail();
                seen.add(String(index)); object[index]=atom(entry[1]);
            }else {
                const key=atom(entry[0]);
                if(typeof key!=="string"&&!NativeString.is(key)&&!NativeNumber.is(key))fail();
                const slot=runtime.memberSlot(object,key,"hash");
                if(slot.exists())fail();
                slot.set(atom(entry[1]));
            }
        }
    }
    return atom(wire.root);
}
