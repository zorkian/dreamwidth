# Shared native scalar foundation

The general compiler and recovered-program frontend share private scalar APIs.
This dependency does not yet connect general programs to the ordinary server.
G2 still needs the active-layer loader, complete public host and page-local
streaming cleaner, plus an exact byte IPC/HTTP bridge.

## Strings and output

`NativeString` keeps copied octets and a separate Perl UTF8 flag. Constructors
distinguish native byte input, explicitly flagged input and host Unicode.
Operations do not infer the flag from valid UTF8. Byte foreach and scalar reverse
can produce invalid UTF8, which the native output sink preserves exactly.
The legacy string sink rejects an unrepresentable value instead of replacing it.
Neutral output frames contain copied `bytes` and `utf8` fields; the later streaming
cleaner owns safe-output semantics. Passing a safe frame is not HTML authorization.

Source lowering carries scalar/list/void evaluation context. In particular,
direct native print of one `reverse` argument leaves that argument unchanged,
while assignment reverses its bytes. Array foreach aliases elements; string and
hash-key foreach use temporary scalar cells. Assignment copies scalar state.
String concat chains use flat scalar-context operand callbacks and complete each
left-associated coercion before evaluating the next right operand. Array push
uses a statement-safe cell helper, evaluates its target and value once, and
retains native scalar/list contexts without V8 spread-argument limits.

Native language operations and string builtins have different boundaries.
`substr` deliberately performs native lax UTF8 decoding, character slicing and
UTF8 encoding; malformed input can therefore produce U+FFFD in this operation.
Byte-mode casing is ASCII only. Flagged casing uses the installed Perl's extracted
lower/upper/title tables, including titlecase expansions. Literal regex behavior
includes final-LF matching for `ends_with` and trailing-empty removal for `split`.
`compare` computes OTHER cmp THIS. `repeat` retains the native `[too large]` limit.

## Numbers, keys and private identity

The target profile is the measured installed Perl 5.34 IV/UV64 and IEEE754 NV64.
Bounded integer arithmetic promotes to NV using native operand conversion on
overflow. Division, modulo, comparisons and increment/decrement keep their
distinct native branches. NV formatting uses 15 significant decimal digits.
Numeric coercion retains the original PV and private integer cache; tagged wire
records preserve those fields without JSON Number rounding.

Array indices use SvIV, including UVmax and positive overflowing NV mapping to
signed -1. Allocation remains subject to the child limits and the real JS array
transport boundary, rather than a small fixture range cap. Hash keys preserve
native scalar identity without exposing prototype properties. Administrative
host Number conversion requires an explicit exact range.

`runtime.isContext` checks the installed runtime's private WeakSet brand.
Prototype forgery and objects with similarly named methods are not Contexts.
The recovery frontend consumes these APIs after its separate reviewed integration;
it does not supply a parallel scalar codec.

## Profile and artifact identity

The trusted offline compiler launcher extracts the installed Perl numeric and
Unicode profile without site configuration or DB credentials. Extracted tables
live in local program artifacts, not Git or the database. Their exact values,
Unicode version, supplying module hashes, scalar implementation hashes, compiler
options and executable identities enter the compiler digest. A changed profile
or implementation invalidates reuse. Supporting a different effective profile
remains implementation work, not an assumption of Node/Perl equivalence.

Legacy reviewed emission remains available while serving migrates. It is not an
alternative general semantics mode. Native callsite recursion accounting and
complete source-loop fail-stop instrumentation remain the disclosed G1/G2 work;
this scalar package does not claim a complete execution sandbox.

## Focused reproduction

Run inside the owning devcontainer with the existing locked dependencies:

```sh
cd "$LJHOME/src/s2/target/javascript"
export PATH=/opt/dw-node24/bin:$PATH
npm run check
npm run check:page
node --test dist/tools/compile-active.test.js \
  dist/tools/native-scalar.test.js dist/tools/native-numeric.test.js
```

The independent fixed-source Perl oracle compares raw bytes and supplies distinct
builtin/flagged-case expectations. The numeric oracle executes 49 fixed native
branches, including coercion, overflow, formatting and safe wide-index reads.
Neither oracle executes stored database code or regenerates candidate expectations.
The stock regression compiles and instantiates core2 plus all 58 current layouts
under general scalar lowering, including Venture. It also executes native and JS
core2/Venture stack helpers (the nested-comment push/count and font generator)
through the actual source-correspondence producer, and a 2,000-term concat source.
This is compiler/runtime coverage, not general page/host serving completion.
The compact builtin oracle calls the actual retained `S2::Builtin::LJ` functions.
