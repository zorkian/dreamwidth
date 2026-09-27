// general-request.ts
//
// Parent general program, initialization, selected-data and final release pipeline.
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

import {randomBytes} from "node:crypto";
import type {LiveResult, NativeJournalAuthority, NativeSelectedSnapshot, RawPageRequest, PublicAppConfig} from "../contracts";
import type {MysqlLiveStore} from "../data/mysql";
import type {MysqlActivePrograms} from "../data/active-program";
import type {ActiveProgramRequest} from "../domain/active-style";
import {generalJournalPrivacy} from "../domain/general-journal-admission";
import type {GeneralPublicSession} from "../domain/general-public-session";
import {ProgramCoordinator, type PreparedProgram} from "./program-coordinator";
import type {GeneralRenderer, GeneralConversation} from "./general-child";
import {assertSelectedRequest} from "./general-selection";
import {encodeGeneralModel} from "./general-model-wire";
import {PrivateTransportError} from "./private-transport";

export interface GeneralRequestHelpers {
    readonly session: GeneralPublicSession;
    readonly host: GeneralConversation["host"];
}
export interface GeneralRequestOperations {
    /** Installed public helper authority, never renderer-controlled handlers. */
    helpers(prepared: PreparedProgram, journal: NativeJournalAuthority): GeneralRequestHelpers;
    /** Explicit public-field approval/post-source transformations only. */
    project(snapshot: NativeSelectedSnapshot, helpers: GeneralRequestHelpers): Promise<unknown>;
}
class MissingSelectedData extends Error {}

export class GeneralRequestPipeline {
    constructor(private readonly store: Pick<MysqlLiveStore,"loadNativeJournalAuthority"|"revalidateNativeJournalAuthority"|
        "loadNativeSelectedSnapshot"|"revalidateNativeSelectedFingerprint">,
        private readonly programs: Pick<MysqlActivePrograms,"load"|"revalidate">,
        private readonly coordinator: Pick<ProgramCoordinator,"prepare"|"transfer">,
        private readonly renderer: Pick<GeneralRenderer,"render">,
        private readonly config: PublicAppConfig, private readonly operations: GeneralRequestOperations) {}
    async render(requestInput: RawPageRequest, programInput: ActiveProgramRequest): Promise<LiveResult> {
        // Capture before any await; later caller mutation cannot redirect the
        // program, selected window or final authority reread.
        const request = structuredClone(requestInput), programRequest = structuredClone(programInput);
        if (programRequest.username !== request.username || programRequest.view !== request.page.kind) {
            throw new PrivateTransportError();
        }
        const journal = await this.store.loadNativeJournalAuthority(request.username);
        if (!journal) return {ok:false,reason:"not-found"};
        if (generalJournalPrivacy(journal)) return {ok:false,reason:"unsupported"};
        const active = await this.programs.load(programRequest);
        if (!active) return {ok:false,reason:"not-found"};
        if (active.request.username !== programRequest.username || active.request.view !== programRequest.view ||
            active.request.selection !== programRequest.selection) throw new PrivateTransportError();
        const owner = active.journal;
        if (owner.userid !== journal.userid || owner.username !== journal.username || owner.clusterId !== journal.clusterid ||
            owner.status !== journal.status || owner.statusvis !== journal.statusvis || owner.journaltype !== journal.journaltype ||
            owner.dversion !== journal.dversion || owner.caps !== journal.caps) return {ok:false,reason:"changed"};
        const prepared = await this.coordinator.prepare(active.program);
        const helpers = this.operations.helpers(prepared,journal);
        let selected: NativeSelectedSnapshot | undefined;
        let bytes: Uint8Array;
        let missing = false;
        try {
            bytes = await this.renderer.render(randomBytes(32).toString("hex"),{
                start:{version:1,transfer:this.coordinator.transfer(prepared),config:this.config,kind:request.page.kind},
                host:helpers.host,
                select:async count=>{
                    if (!Number.isSafeInteger(count) || count < 1 || count > 50) throw new PrivateTransportError();
                    const selectedRequest: RawPageRequest = request.page.kind === "recent" ?
                        {...request,page:{...request.page,itemshow:count}} : request;
                    const snapshot = await this.store.loadNativeSelectedSnapshot(selectedRequest);
                    if (!snapshot) {missing = true; throw new MissingSelectedData();}
                    assertSelectedRequest(snapshot.facts,selectedRequest);
                    if (snapshot.facts.owner.userid !== journal.userid || snapshot.facts.owner.user !== journal.username) {
                        throw new PrivateTransportError();
                    }
                    selected = snapshot;
                    const page = await this.operations.project(snapshot,helpers);
                    return {kind:request.page.kind,page:encodeGeneralModel(page)};
                },
            });
        } catch (error) {
            if (missing) return {ok:false,reason:"not-found"};
            throw error;
        }
        // Includes init diagnostics and native partial runtime errors. A known
        // program error never bypasses current privacy/active program authority.
        const current = await helpers.session.finish(async()=>{
            if (!await this.store.revalidateNativeJournalAuthority(journal)) return false;
            if (!await this.programs.revalidate(active)) return false;
            // This complete request-specific reread is the final await.
            return selected ? this.store.revalidateNativeSelectedFingerprint(selected) : true;
        });
        if (!current) return {ok:false,reason:"changed"};
        return {ok:true,html:bytes,setCookie:null};
    }
}
