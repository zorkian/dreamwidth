# Fresh local BML baseline, 2026-09-22

Captured from checkpoint `595a54928` in the isolated Linux foreman devcontainer,
using seeded `test_user` and compiled Ciel/Indil. These supplement the ten
original desktop customization states committed under `../2026-09-21`.

- [Links list, desktop](customize-before/linkslist.png)
- [Theme browser, 390px viewport](customize-before/themes-mobile.png)
- [Colors, 390px viewport](customize-before/colors-mobile.png)

The old page has a missing advanced-customization translation and does not
provide a Foundation mobile layout. These images characterize that baseline;
they are not evidence of successful option mutations or completed migration.

Reproduction: `bin/dev/screenshot --user test_user --password dreamwidth`
with `/customize/options?group=linkslist`, `/customize/?cat=all`, and
`/customize/options?group=colors`; use `--size 390x844` for the latter two.
Run inside a seeded development container only.
