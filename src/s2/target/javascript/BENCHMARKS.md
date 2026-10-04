# Journal server benchmarks

How the journal server compares with the Perl site on the same pages, and how
to measure it again. All numbers here come from one devcontainer, so they
show relative speed, not production capacity.

## Running it

In the devcontainer, with the Perl site on port 8080, the fixtures seeded
(`perl tools/seed-fixtures.pl`, which includes a 220-entry journal and an
entry with 300 comments) and the server built:

```bash
cd src/s2/target/javascript
perl tools/export-config.pl > config.json
pkill starman; bash /workspaces/dreamwidth/.devcontainer/start.sh   # for Perl's cold figures
node tools/bench.mjs --config config.json --start-js --requests 100 --queries
```

`tools/bench.mjs` warms both servers, then times each page at concurrency 1
and 8 over keep-alive connections, and reports latency percentiles, requests
per second, errors and status mismatches. `--start-js` starts the journal
server itself, so each page's first request runs before the layers it needs
are compiled (unless an earlier page compiled them); restart Starman first
for Perl's first-request figures. `--queries` counts each page's MySQL
queries by the sites' database user from the general log, after warming up.
Pass paths to time other pages; `--help` lists the options.

## Setup

- Devcontainer on a 12-core host; MySQL and memcached in the same container.
- Perl: Starman with 3 workers, as `.devcontainer/start.sh` starts it.
- Journal server: `dist/server/main.js` with its defaults, 4 render workers.
- 100 timed requests per page and concurrency, after 5 warm-up requests.

The dev Perl site is slower than production: about 220 of its queries on a
journal page are translation-string freshness checks (`ml_latest`) that the
dev configuration makes on every request. Perl's numbers are a dev baseline,
not production's.

## Results

Latencies in ms, Perl / journal server. Warm.

| Page | c=1 p50 | c=1 p95 | c=8 p50 | c=8 p95 | c=8 req/s | queries |
|---|---|---|---|---|---|---|
| recent, site default style | 149 / 17 | 179 / 20 | 147 / 22 | 240 / 59 | 15 / 279 | 452 / 22 |
| recent, theme | 142 / 16 | 163 / 20 | 147 / 31 | 216 / 61 | 14 / 223 | 455 / 25 |
| recent, user layer | 127 / 14 | 155 / 17 | 129 / 19 | 228 / 35 | 15 / 371 | 452 / 25 |
| recent, 220-entry journal | 151 / 22 | 175 / 26 | 160 / 33 | 228 / 49 | 13 / 216 | 455 / 25 |
| entry, 5 comments | 128 / 23 | 134 / 26 | 127 / 26 | 221 / 53 | 15 / 268 | 443 / 34 |
| entry, 300 comments | 207 / 45 | 231 / 48 | 216 / 57 | 291 / 86 | 10 / 128 | 443 / 35 |
| year archive | 120 / 13 | 161 / 15 | 125 / 17 | 214 / 33 | 16 / 407 | 439 / 18 |
| month archive | 136 / 16 | 159 / 23 | 142 / 31 | 218 / 45 | 14 / 239 | 440 / 25 |
| day archive | 144 / 12 | 160 / 14 | 146 / 17 | 209 / 27 | 15 / 428 | 455 / 25 |
| tags | 116 / 15 | 163 / 17 | 129 / 21 | 202 / 37 | 15 / 343 | 438 / 19 |
| icons | 136 / 17 | 155 / 20 | 141 / 19 | 214 / 39 | 15 / 368 | 443 / 21 |
| reply, no captcha | 162 / 20 | 180 / 23 | 154 / 23 | 258 / 42 | 14 / 308 | 525 / 30 |
| reply, captcha | 164 / 20 | 186 / 23 | 168 / 24 | 218 / 42 | 13 / 297 | 527 / 30 |
| stylesheet | 23 / 7.3 | 24 / 8.3 | 24 / 10 | 93 / 20 | 34 / 703 | 2 / 13 |
| ?style=site | 110 / 30 | 134 / 36 | 119 / 36 | 180 / 72 | 16 / 192 | 247 / 24 |
| ?style=light | 90 / 28 | 118 / 34 | 96 / 34 | 170 / 47 | 18 / 221 | 124 / 24 |
| reading page | 156 / 20 | 181 / 24 | 170 / 41 | 240 / 66 | 13 / 177 | 491 / 60 |
| network page (no feature) | 44 / 1.9 | 53 / 2.5 | 48 / 5.1 | 73 / 10 | 27 / 1321 | 168 / 3 |
| unknown journal | 45 / 1.4 | 50 / 1.6 | 48 / 4.6 | 81 / 9.1 | 27 / 1510 | 181 / 2 |
| hidden entry (404) | 52 / 16 | 74 / 18 | 56 / 18 | 96 / 37 | 25 / 384 | 212 / 22 |
| adult content (login) | 45 / 7.5 | 46 / 8.4 | 51 / 10 | 80 / 22 | 26 / 657 | 170 / 14 |

At concurrency 8, Perl's p99 runs to several seconds as requests queue for
its three workers; the journal server's p99 stays under 130 ms. No request
failed on either side. The adult content page differs by design: Perl shows
its confirmation page (200), the journal server its login page (403).

First requests, ms (Perl just restarted / journal server just started):
the first page, which compiles core2 and a layout through the Perl
compiler, took 229 / 1083; a page needing another layout or a user layer
230-250; a page whose layers were already compiled 20-80. Compiled layers
are kept in memory for the life of the process, keyed by layer and source,
and are not evicted.

Memory, MB resident: Perl's master and three workers 950 idle and 2551
after the run; the journal server 149 idle and 1199 after the run. The
journal server's memory levels off at about 1.1 GB under sustained load
(1800 requests at concurrency 8 to the 220-entry journal): its four render
workers each hold a V8 heap of about 250 MB.

## Query counts

The journal server reads everything from MySQL, where Perl reads much from
memcached, so the stylesheet is the one page where it makes more queries
than Perl (13 to 2): the journal, its properties and its style's layers,
names and modification times. The reading page makes one set of queries for
each watched journal with entries on the page, as Perl's does, and a
content filter's checks are made once per journal, not per entry; the
journal's own icons and the posters' icons are loaded with two queries for
each database cluster.
