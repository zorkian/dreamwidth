// errors.ts
//
// Safe error boundary for live journal reads.
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

import type { RepositoryError } from "../contracts";

export class SnapshotError extends Error implements RepositoryError {
    readonly name = "RepositoryError";
    constructor(readonly kind: "unsupported" | "unavailable") {
        super(kind === "unsupported" ? "Unsupported journal state" : "Journal data unavailable");
    }
}
