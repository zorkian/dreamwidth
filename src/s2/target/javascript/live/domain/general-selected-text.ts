// general-selected-text.ts
//
// Parent-only post-source text cells for selected entries and visible comments.
//
// Portions adapted from LJ::Entry::_load_text / LJ::Talk::load_comments, forked from the
// LiveJournal project owned and operated by Live Journal, Inc., and modified
// and expanded by Dreamwidth Studios, LLC. The original license is available at:
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
// In accordance with that license, this code and its modifications are provided
// under the GNU General Public License. See LICENSE in this distribution.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//

// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.
// The inherited notice above applies to adapted LiveJournal portions.
//

import type {NativeSelectedSnapshot,RawEntry,RawCommentText} from "../contracts";
import {NativeString} from "../../runtime/native-string";
import {scalarTruthy} from "../../runtime/native-scalar";
import type {GeneralTextEncoding,ConvertedNativeItem} from "./general-text-encoding";

/** This source bag remains parent-only; only named approved values may be projected. */
export class GeneralSelectedText {
    private readonly sources=new Map<string,NativeString|undefined>();
    private readonly entries=new WeakMap<RawEntry,ConvertedNativeItem>();
    private readonly comments=new WeakMap<RawCommentText,ConvertedNativeItem>();
    private constructor(private readonly snapshot:NativeSelectedSnapshot) {
        if(snapshot.encoding!=="dbi-byte-view")throw Error("Invalid selected source encoding");
        for(const cell of snapshot.sources) {
            const value=cell.value===null?undefined:NativeString.bytes(Buffer.from(cell.value.base64,"base64"));
            if(cell.value!==null&&(cell.value.utf8!==false||value!.bytes().toString("base64")!==cell.value.base64))
                throw Error("Invalid selected source frame");
            if(this.sources.has(cell.key)) {
                const previous=this.sources.get(cell.key);
                if((previous===undefined)!==(value===undefined)||previous&&value&&!previous.bytes().equals(value.bytes()))
                    throw Error("Inconsistent selected source witness");
            }
            this.sources.set(cell.key,value);
        }
    }
    private source(key:string):NativeString|undefined {
        if(!this.sources.has(key))throw Error("Missing selected source witness");
        return this.sources.get(key);
    }
    static async prepare(snapshot:NativeSelectedSnapshot,encoding:GeneralTextEncoding):Promise<GeneralSelectedText> {
        const prepared=new GeneralSelectedText(snapshot);
        for(const entry of snapshot.facts.entries) {
            const prefix="entry:"+entry.jitemid;
            const props:Record<string,NativeString|undefined>=Object.create(null);
            for(const key of Object.keys(entry.props))props[key]=prepared.source(prefix+":prop:"+key);
            const subject=prepared.source(prefix+":subject"),text=prepared.source(prefix+":event");
            const converted=scalarTruthy(props.unknown8bit)?await encoding.item(subject,text,props):
                Object.freeze({subject,text,props:Object.freeze(props)});
            prepared.entries.set(entry,converted);
        }
        for(const comment of snapshot.facts.comments?.texts??[]) {
            const prefix="comment:"+comment.jtalkid;
            const props:Record<string,NativeString|undefined>=Object.create(null);
            for(const key of Object.keys(comment.props))props[key]=prepared.source(prefix+":"+key);
            const subject=prepared.source(prefix+":subject");
            const text=comment.body===null?undefined:prepared.source(prefix+":body");
            // Native Talk passes an EMPTY prop hash to item_toutf8. Public
            // talkprops are retained, not converted with entry property rules.
            const converted=scalarTruthy(props.unknown8bit)?await encoding.item(subject,text):{subject,text};
            prepared.comments.set(comment,Object.freeze({...converted,props:Object.freeze(props)}));
        }
        return prepared;
    }
    entry(entry:RawEntry):ConvertedNativeItem {
        const value=this.entries.get(entry);if(!value)throw Error("Unselected entry text reference");return value;
    }
    comment(comment:RawCommentText):ConvertedNativeItem {
        const value=this.comments.get(comment);if(!value)throw Error("Unselected comment text reference");return value;
    }
}
