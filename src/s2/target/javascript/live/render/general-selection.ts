// general-selection.ts
//
// Bind initialized program properties to the parent-selected public SQL window.
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

import type {RawPageRequest, RawJournalSnapshot} from "../contracts";
import {decodeScalar, encodeScalar, scalarNumber, NativeNumber, type NativeScalarWire} from "../../runtime/native-scalar";
import {numericCompare, exactHostInteger} from "../../runtime/native-number";
import {PrivateTransportError} from "./private-transport";

/** The worker supplies a numeric scalar, never a SQL limit or query fragment. */
export function initializedRecentCount(value: unknown): number {
    try {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new PrivateTransportError();
        const decoded = decodeScalar(value as NativeScalarWire);
        if (JSON.stringify(encodeScalar(decoded)) !== JSON.stringify(value)) throw new PrivateTransportError();
        const number = scalarNumber(decoded);
        // LJ/S2/RecentPage.pm142-144: coercion precedes the native bounds.
        if (numericCompare(number, NativeNumber.integer(1n)) < 0) return 20;
        if (numericCompare(number, NativeNumber.integer(50n)) > 0) return 50;
        return exactHostInteger(number, 1, 50);
    } catch {throw new PrivateTransportError();}
}

export function initializedSelectionRequest(request: RawPageRequest, recentCount: unknown): RawPageRequest {
    if (request.page.kind === "entry") return request;
    return Object.freeze({...request, page: Object.freeze({...request.page,
        itemshow: initializedRecentCount(recentCount)})});
}

/** A selected-data repository never gets to substitute the admitted request. */
export function assertSelectedRequest(snapshot: RawJournalSnapshot, request: RawPageRequest): void {
    const actual = snapshot.request;
    if (actual.username !== request.username || actual.calendarNow.year !== request.calendarNow.year ||
        actual.calendarNow.month !== request.calendarNow.month || actual.page.kind !== request.page.kind) {
        throw new PrivateTransportError();
    }
    if (actual.page.kind === "recent" && request.page.kind === "recent") {
        if (actual.page.skip !== request.page.skip || actual.page.itemshow !== request.page.itemshow) {
            throw new PrivateTransportError();
        }
    } else if (actual.page.kind === "entry" && request.page.kind === "entry") {
        if (actual.page.ditemid !== request.page.ditemid ||
            JSON.stringify(actual.page.comments) !== JSON.stringify(request.page.comments)) throw new PrivateTransportError();
    }
}
