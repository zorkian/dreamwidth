// comparison.ts
//
// Anonymous live render service and final primary privacy decision.
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

import type { CreateComparisonRecentService } from "../contracts";
import { buildService } from "./internal-service";

export const createComparisonRecentService: CreateComparisonRecentService = (deps, inputs) => {
    if (inputs.purpose !== "offline-perl-comparison") throw new Error("Explicit comparison inputs required");
    return buildService(deps, inputs);
};
