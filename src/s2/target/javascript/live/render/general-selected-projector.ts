// general-selected-projector.ts
//
// Parent assembly of one selected public page and its private Comment authority.
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

import type {NativeSelectedSnapshot,RawJournalSnapshot,RawEntry} from "../contracts";
import type {LiveStoreConfig,SourceCapabilities} from "../startup-types";
import {GeneralSelectedText} from "../domain/general-selected-text";
import {generalSelectedComments,type GeneralSelectedCommentPage,
    type GeneralSelectedCommentNavigation} from "../domain/general-comment-projection";
import type {GeneralTextEncoding} from "../domain/general-text-encoding";
import type {GeneralRequestHelpers,GeneralProjectedPage} from "./general-request";
import {PrivateTransportError} from "./private-transport";
import type {NativeString} from "../../runtime/native-string";
import {commentCapabilityValue} from "../domain/comments";
import {generalCommentInfoFromSource} from "../domain/general-comment-info-source";
import type {GeneralModel} from "../domain/general-model-primitives";

export interface GeneralSelectedProjector {
    /** Issued converter uses this request's owner oldenc and public code witnesses. */
    encoding(snapshot:NativeSelectedSnapshot,helpers:GeneralRequestHelpers):GeneralTextEncoding;
    /** Derives the selected Entry URL and style argument from parent authority. */
    navigation(facts:RawJournalSnapshot,prepared:GeneralSelectedText):GeneralSelectedCommentNavigation;
    /** Trusted parent builder projects named public fields; the source bag stays here. */
    page(facts:RawJournalSnapshot,prepared:GeneralSelectedText,
        comments:GeneralSelectedCommentPage|undefined):unknown;
}

/** The same prepared source cells authorize both child page fields and poster binding. */
export async function generalSelectedProjection(snapshot:NativeSelectedSnapshot,
    helpers:GeneralRequestHelpers,config:Pick<LiveStoreConfig,"commentSettings"|"capabilities">,
    projector:GeneralSelectedProjector):Promise<GeneralProjectedPage> {
    const facts=snapshot.facts;
    const prepared=await GeneralSelectedText.prepare(snapshot,projector.encoding(snapshot,helpers),helpers.session);
    let selectedComments:GeneralSelectedCommentPage|undefined;
    if(facts.comments) {
        if(facts.request.page.kind!=="entry")throw new PrivateTransportError();
        selectedComments=generalSelectedComments(snapshot,config,prepared,projector.navigation(facts,prepared));
    }
    const page=projector.page(facts,prepared,selectedComments);
    return selectedComments?{page,selectedComments}:{page};
}

/** Viewed-journal get_cap is resolved from issued facts, never from a poster. */
export function generalSelectedCommentInfo(snapshot:NativeSelectedSnapshot,
    prepared:GeneralSelectedText,entry:RawEntry,permalink:NativeString,
    styleArgument:NativeString|undefined,capabilities:SourceCapabilities):GeneralModel {
    const maximum=commentCapabilityValue(capabilities.maxComments,snapshot.facts.owner.caps);
    return generalCommentInfoFromSource(prepared.commentInfoInput(entry,permalink,styleArgument,maximum));
}
