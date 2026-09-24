# Callable owned-edit GET rendering

Captured by the foreman at local commit `7e3f9dc51` using the independently
reviewed callable GET controller and isolated browser fixture/server. Public
GET routing is unchanged at this checkpoint.

- `native-get-1280.png`: native ordinary owned-entry GET form, desktop.
- `native-get-390.png`: the same form with stacked controls at 390px.

The real browser verifies subject/body/security/stored editor, canonical native
action with exact encoded/repeated query, force-fresh entry/draft nonmutation
on GET, then a distinct native save with unrelated entry preserved. No JS or
resource errors; normal run exits 0 and leaves no fixture/server process.
Foreman log: `/tmp/bml-owned-get-browser-integrated.log` in container8d7783a043d8.
Independent Sol normal and intentional-failure cleanup passed at source03362e229.

Retained old-form captures are in the adjacent `legacy-owned-edit-adapter`
folder. These screenshots are acceptance evidence, not a claim that all legacy
edit contexts have migrated or that the BML editor can be deleted.

## Public route activation replay

`public-get-1280.png` and `public-get-390.png` were captured after integration
of source727 as local5c91b54a2. The server loads plain app.psgi with no test
route overlay. Foreman normal browser exited0/PASS, distinct save persisted,
and fixture/server process checks were empty. Log:
`/tmp/bml-owned-get-public-browser.log` in the foreman container.
Sol independently passed normal and named intentional-failure cleanup at727.
