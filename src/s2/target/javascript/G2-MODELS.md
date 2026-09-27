# General model and installed-worker checkpoint

This checkpoint adds native scalar constructors for public Image, Link, Date,
CommentInfo and null objects, and Date/DateTime comparison callbacks. Constructors
preserve native PV values, object aliases and numeric coercion. They accept named
approved fields; they do not project arbitrary SQL records or private properties.

The model-worker test compiles a fixed trusted custom core and empty layout with
the unchanged native compiler. It independently executes installed native
constructors and actual native UserLite/Date methods. The JS run uses both matched
source and missing-source active recovery. Initialization, property mutation,
selected count 3, model preparation and Page printing use the same Context and
native output session. UserLite constructor calls cross the actual synchronous
private channel during initialization and rendering. Equality stays bound to the
parent-issued account even after an author mutates the public username field.

The fixed test driver is staged at the general-worker entry through the existing
stager's source override. Its exact derived dependency closure is verified and
sandboxed; it is not the ordinary installed worker factory. The only additional
manifest file outside render/policy/runtime is the explicitly named pure
`live/domain/general-model-primitives.js`, admitted only for the general entry.
Unknown domain files remain refused. No directory, network, filesystem-write,
compiler or runtime grant changes are made.

Guarded isolated SQL tests supply actual active core/layout bytes, selected public
entries and public UserLite identity/mapping facts. Source-present and source-missing
Recent/Entry requests execute the real child and return independently expected
native bytes through the existing app, including owning-container TCP GET and HEAD.
A public helper fact changed during rendering gives 409 with no rendered body;
restoring it recovers. A private Entry whose text row has been deleted remains 404
without releasing its body. Fixture schemas are removed by existing finally cleanup;
ordinary journal data is unchanged.

The oracle's public display-name/base-URL helper providers and the driver's model
input are explicitly synthetic. These tests qualify the installed-model/private
transport seam, not complete native Page/Entry construction, ordinary main startup,
resource routes, full stock HTML or browser parity. The test driver's identity CSS
and embed callbacks are not installed-site hook implementations. The held general
subject dependency is neither imported nor exercised.

Mandatory continuation remains the actual general worker/main factory, source-backed
Page/Recent/Entry models and all reached host/content/property modes, independent OG,
request style/context and final postprocessing. Existing ordinary user/settings/content
are implementation work, not an admission subset. This checkpoint does not declare
the general serving milestone complete or add a product allowlist.
