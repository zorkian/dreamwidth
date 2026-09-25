// errors.ts
//
// Fixed internal failure categories for bounded entry cleaning.
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

export class UnsupportedContent extends Error {
    constructor() { super("Unsupported entry content"); }
}
