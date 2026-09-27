// site-config.test.ts
//
// Independent configuration export and private startup boundary tests.
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

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
    rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { parseStartupArgs, readStartupConfig, StartupConfigError, validateStartupConfig }
    from "../live/server/startup-config";

import {decodeScalar,encodeScalar,scalarNumber,scalarPV,NativeNumber,NativeString} from "../runtime/native-scalar";
import {prepareGeneralImageUrlFacts,prepareGeneralUserpicRoot} from "../live/domain/general-image-url";

const repo = path.resolve(process.cwd(), "../../../..");
const exporter = path.join(process.cwd(), "tools/site-config.pl");
const secret = "synthetic-credential-never-log";

function temporary(run: (dir: string) => void): void {
    const dir = mkdtempSync("/tmp/slice6-config-test-");
    try { run(dir); } finally { rmSync(dir, {recursive: true, force: true}); }
}
function exportSite(home: string, output: string) {
    return spawnSync("perl", ["-I", path.join(repo, "cgi-bin"), exporter, "--output", output,
        "--app-origin", "https://app.example.test", "--listen-origin", "http://viewer.example.test:9191",
        "--listen-host", "0.0.0.0", "--listen-port", "9191"],
    {env: {...process.env, LJHOME: home}, encoding: "utf8", timeout: 15000, maxBuffer: 65536});
}
function fixture(dir: string, tail = ""): string {
    const home = path.join(dir, "home");
    const site = path.join(home, "ext/site");
    mkdirSync(path.join(site, "etc"), {recursive: true});
    mkdirSync(path.join(home, "bin/upgrading"), {recursive: true});
    writeFileSync(path.join(site, ".dir_scope"), "private\n");
    symlinkSync(path.join(repo, "cgi-bin"), path.join(home, "cgi-bin"));
    symlinkSync(path.join(repo, "src"), path.join(home, "src"));
    writeFileSync(path.join(home, "bin/upgrading/en.dat"), "img.placeholder=Source fixture\n");
    writeFileSync(path.join(site, "etc/config-private.pl"), `package LJ;
$IS_DEV_SERVER=0; $_T_CONFIG=1; $DOMAIN=''; $PROTOCOL='https'; $SITEROOT='https://app.example.test';
$DEFAULT_LANG='en'; @CLUSTERS=(7,9); %CLUSTER_PAIR_ACTIVE=(7=>'B');
%DBINFO=(master=>{host=>'db.example.test',dbname=>'custom_global',user=>'fixture',pass=>'${secret}'},
  fallback=>{host=>'fallback.example.test',user=>'fixture',pass=>'${secret}',role=>{cluster9=>0}},
  other=>{sock=>'/tmp/example-mysql.sock',dbname=>'custom_cluster',user=>'fixture',pass=>'${secret}',role=>{cluster7b=>3,cluster9=>1}});
$DEFAULT_STYLE={core=>'core2',layout=>'core2base/layout'};
$DEFAULT_FEED_STYLE={core=>'core2',layout=>'sitefeeds/layout',theme=>'sitefeeds/default'}; %S2LID_REMAP=(4=>12);
$CAP_DEF{maxcomments}=0; $CAP_DEF{stickies}=2;
%CAP=(1=>{s2viewentry=>0,maxcomments=>123,stickies=>4},5=>{_name=>'_moveinprogress',readonly=>1,s2viewentry=>1});
%KNOWN_HTTPS_SITES=('UPPER.example'=>1,'lower.example'=>1,'false.example'=>0);
%FORM_DOMAIN_BANNED=('Banned.example'=>1,'blocked.example'=>1,'false.example'=>0);
$PROXY_URL='https://proxy.example.test'; $PROXY_SALT_FILE='/not-existing-secret-salt';
print '${secret}'; warn '${secret}';
${tail}
1;
`);
    return home;
}

test("source configuration export preserves arbitrary endpoints, URL facts and private mode", () => temporary(dir => {
    const home = fixture(dir);
    const output = path.join(dir, "site.json");
    const result = exportSite(home, output);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.ok(!result.stdout.includes(secret));
    assert.equal(statSync(output).mode & 0o777, 0o600);
    const config = readStartupConfig(output);
    assert.deepEqual(config.database.clusters, [7, 9]);
    assert.deepEqual(config.database.clusterPairActive, {7: "b"});
    assert.deepEqual(config.database.sources.map(s => [s.id, s.database, s.host, s.socketPath]),
        [["fallback", "livejournal", "fallback.example.test", null],
            ["master", "custom_global", "db.example.test", null],
            ["other", "custom_cluster", null, "/tmp/example-mysql.sock"]]);
    assert.deepEqual(config.database.sources[2]!.roles, {cluster7b: 3, cluster9: 1});
    assert.equal(config.database.sources[0]!.password, secret);
    assert.equal(config.capabilities.moveInProgressMask, 32);
    assert.deepEqual(config.capabilities.maxComments,{defaultValue:0,byBit:[{bit:1,value:123}],hookConfigured:false});
    assert.deepEqual(config.capabilities.maxStickies,{defaultValue:2,byBit:[{bit:1,value:4}],hookConfigured:false});
    assert.deepEqual(config.styles.defaultStyle, {core: "core2", layout: "core2base/layout"});
    assert.equal(config.app.entryContent.urls.siteDomain, "");
    assert.deepEqual(config.app.entryContent.urls.knownHttpsSites, ["UPPER.example", "lower.example"]);
    assert.deepEqual(config.app.entryContent.urls.formDomainBanned, ["Banned.example", "blocked.example"]);
    assert.equal(config.app.entryContent.urls.imageProxy, "not-configured");
    assert.equal(config.app.maxRecursion,500);
    assert.ok(!readFileSync(output, "utf8").includes("proxy.example"));
    assert.ok(!readFileSync(output, "utf8").includes("secret-salt"));
    assert.equal(config.placeholder.descriptor.altKey, "img.placeholder");
    assert.equal(config.placeholder.languageFiles[0], path.join(home, "bin/upgrading/en.dat"));
    const before = readFileSync(output);
    assert.equal(exportSite(home, output).status, 1);
    assert.deepEqual(readFileSync(output), before);
    assert.ok(!readdirSync(dir).some(name => name.startsWith(".site-config-")));
    const linked = path.join(dir, "linked.json"); symlinkSync(output, linked);
    assert.equal(exportSite(home, linked).status, 1);
    assert.deepEqual(readFileSync(output), before);
}));

test("native public URL facts retain installed byte flags and exact hash key case",()=>temporary(dir=>{
    const home=fixture(dir, `$DOMAIN=pack('C*',0xc3,0xa9);
$USERPIC_ROOT='https://pics.invalid/'.pack('U*',0xe9,0x732b);
%KNOWN_HTTPS_SITES=(pack('U*',0x78,0x2e,0xe9,0xe9)=>1,'UPPER.example'=>1,'dead.example'=>0);`);
    const output=path.join(dir,"native-urls.json");
    const result=exportSite(home,output);assert.equal(result.status,0,result.stderr);
    const facts=readStartupConfig(output).nativePublicUrls!;
    assert.deepEqual(readStartupConfig(output).nativeUserpicRoot,
        {base64:Buffer.from("https://pics.invalid/é猫").toString("base64"),utf8:true});
    const rootFact=readStartupConfig(output).nativeUserpicRoot!;
    const root=prepareGeneralUserpicRoot(rootFact);
    assert.equal(root.value.bytes().toString(),"https://pics.invalid/é猫");assert.equal(root.value.flagged(),true);
    assert.notEqual(root.sourceDigest,prepareGeneralUserpicRoot({...rootFact,utf8:false}).sourceDigest);
    assert.deepEqual(facts.siteDomain,{base64:Buffer.from([0xc3,0xa9]).toString("base64"),utf8:false});
    assert.deepEqual(facts.knownHttpsSites,[
        {base64:Buffer.from("UPPER.example").toString("base64"),utf8:false},
        {base64:Buffer.from("x.éé").toString("base64"),utf8:true}]);
    const assembled=prepareGeneralImageUrlFacts(facts);
    assert.match(assembled.sourceDigest,/^[a-f0-9]{64}$/);
    assert.notEqual(assembled.sourceDigest,prepareGeneralImageUrlFacts({...facts,
        siteDomain:{...facts.siteDomain,utf8:true}}).sourceDigest);
    assert.equal(assembled.siteDomain.bytes().toString("hex"),"c3a9");
    assert.equal(assembled.siteDomain.flagged(),false);
    assert.equal(assembled.knownHttpsSites[1]!.bytes().toString("hex"),"782ec3a9c3a9");
    assert.equal(assembled.knownHttpsSites[1]!.flagged(),true);
    const bad=JSON.parse(readFileSync(output,"utf8"));bad.nativePublicUrls.siteDomain.base64="not-base64";
    assert.throws(()=>validateStartupConfig(bad),StartupConfigError);
    const badRoot=JSON.parse(readFileSync(output,"utf8"));badRoot.nativeUserpicRoot.base64="not-base64";
    assert.throws(()=>validateStartupConfig(badRoot),StartupConfigError);
}));

test("effective source recursion override exports and validates without DB access",()=>temporary(dir=>{
    const home=fixture(dir,"$S2::MAX_RECURSION=50;");
    const output=path.join(dir,"recursion.json");
    const result=exportSite(home,output);
    assert.equal(result.status,0,result.stderr);
    assert.equal(readStartupConfig(output).app.maxRecursion,50);
}));

test("trusted site-scheme setup exports actual default inheritance and rejects swallowed DB attempts", () => {
    for (const dbAttempt of [false, true]) temporary(dir => {
        const home = fixture(dir, `
LJ::Hooks::register_hook('modify_scheme_list', sub {
    my ($schemes, $merge) = @_;
    @$schemes = ({scheme=>'fixture_child',parent=>'fixture_parent'}, {scheme=>'fixture_parent'});
    $merge->(fixture_parent=>{parent=>'global'});
    print '${secret}'; warn '${secret}';
    ${dbAttempt ? "eval { DBI->connect('DBI:mysql:should-not-connect','private-user','private-password'); };" : ""}
});
`);
        const output = path.join(dir, "schemes.json");
        const result = exportSite(home, output);
        if (!dbAttempt) assert.deepEqual(readStartupConfig(output).styles.defaultFeedStyle,
            {core: "core2", layout: "sitefeeds/layout", theme: "sitefeeds/default"});
        assert.ok(!result.stdout.includes(secret) && !result.stderr.includes(secret));
        if (dbAttempt) {
            assert.equal(result.status, 1);
            assert.equal(existsSync(output), false);
        } else {
            assert.equal(result.status, 0, result.stderr);
            assert.deepEqual(readStartupConfig(output).styles.siteSchemeInheritance,
                ["fixture_child", "fixture_parent", "global"]);
        }
    });
});

test("exported origins round-trip through startup validation in canonical form", () => temporary(dir => {
    const cases = [
        {app: "https://app.example.test", listen: "http://Viewer.Example.test:9191",
            expectedApp: "https://app.example.test", expectedListen: "http://viewer.example.test:9191"},
        {app: "https://app.example.test", listen: "http://viewer.example.test:80",
            expectedApp: "https://app.example.test", expectedListen: "http://viewer.example.test"},
        {app: "https://app.example.test:443/", listen: "http://viewer.example.test:9191",
            expectedApp: "https://app.example.test", expectedListen: "http://viewer.example.test:9191"},
        {app: null, listen: "http://Viewer.Example.test:80/",
            expectedApp: "https://app.example.test", expectedListen: "http://viewer.example.test"},
    ];
    for (const [index, value] of cases.entries()) {
        const base = path.join(dir, String(index)); mkdirSync(base);
        const home = fixture(base, "$SITEROOT='https://App.Example.test:443/';");
        const output = path.join(base, "site.json");
        const args = ["-I", path.join(repo, "cgi-bin"), exporter, "--output", output,
            "--listen-origin", value.listen];
        if (value.app !== null) args.push("--app-origin", value.app);
        const result = spawnSync("perl", args,
            {env: {...process.env, LJHOME: home}, encoding: "utf8", timeout: 15000, maxBuffer: 65536});
        assert.equal(result.status, 0, result.stderr);
        const config = readStartupConfig(output);
        assert.equal(config.app.canonicalAppOrigin, value.expectedApp);
        assert.equal(config.app.listenOrigin, value.expectedListen);
    }
}));

test("native local endpoints require explicit sockets and TCP ignores sock", () => temporary(dir => {
    const cases = [
        {host: "", sock: "", override: null, expectedHost: null, expectedSocket: null, pass: false},
        {host: "localhost", sock: "", override: "/not-read/override.sock", expectedHost: null,
            expectedSocket: "/not-read/override.sock", pass: true},
        {host: "", sock: "/not-read/explicit.sock", override: "/not-read/override.sock", expectedHost: null,
            expectedSocket: "/not-read/explicit.sock", pass: true},
        {host: "LOCALHOST", sock: "/not-read/ignored.sock", override: null, expectedHost: "LOCALHOST",
            expectedSocket: null, pass: true},
        {host: "127.0.0.1", sock: "/not-read/ignored.sock", override: null, expectedHost: "127.0.0.1",
            expectedSocket: null, pass: true},
        {host: "db.example.test", sock: "/not-read/ignored.sock", override: "relative.sock",
            expectedHost: "db.example.test", expectedSocket: null, pass: false},
    ];
    for (const [index, value] of cases.entries()) {
        const base = path.join(dir, String(index)); mkdirSync(base);
        const home = fixture(base, `$DBINFO{master}{host}='${value.host}'; $DBINFO{master}{sock}='${value.sock}';`);
        const output = path.join(base, "site.json");
        const args = ["-I", path.join(repo, "cgi-bin"), exporter, "--output", output,
            "--app-origin", "https://app.example.test", "--listen-origin", "http://viewer.example.test:9191"];
        if (value.override !== null) args.push("--local-socket", value.override);
        const result = spawnSync("perl", args,
            {env: {...process.env, LJHOME: home}, encoding: "utf8", timeout: 15000, maxBuffer: 65536});
        assert.equal(result.status, value.pass ? 0 : 1, result.stderr);
        if (!value.pass) { assert.ok(!existsSync(output)); assert.match(result.stderr, /socket/); continue; }
        const source = readStartupConfig(output).database.sources.find(s => s.id === "master")!;
        assert.equal(source.host, value.expectedHost);
        assert.equal(source.socketPath, value.expectedSocket);
    }
}));

test("config and hook connection attempts/errors cannot publish or leak credentials", () => temporary(dir => {
    for (const [id, extra] of [
        ["connect", `eval { DBI->connect('DBI:mysql:never-connect','fixture','${secret}') };`],
        ["cached", `eval { DBI->connect_cached('DBI:mysql:never-connect','fixture','${secret}') };`],
        ["exception", `die '${secret}';`],
    ]) {
        const base = path.join(dir, id!); mkdirSync(base);
        const home = fixture(base, extra);
        const output = path.join(base, "site.json");
        const result = exportSite(home, output);
        assert.equal(result.status, 1);
        assert.ok(!result.stdout.includes(secret) && !result.stderr.includes(secret));
        assert.equal(result.stdout, ""); assert.ok(result.stderr.length > 0);
        assert.ok(!existsSync(output));
        assert.ok(!readdirSync(base).some(name => name.startsWith(".site-config-")));
    }
    const base = path.join(dir, "hooks"); mkdirSync(base);
    const home = fixture(base);
    const hooks = path.join(home, "ext/site/cgi-bin/LJ/Hooks"); mkdirSync(hooks, {recursive: true});
    const localImage = path.join(home, "ext/site/cgi-bin/LJ/Local"); mkdirSync(localImage);
    writeFileSync(path.join(localImage, "Img.pm"),
        "package LJ::Img; our %img; $img{placeholder}={src=>'/custom.png',width=>45,height=>21,alt=>'custom.placeholder'}; 1;\n");
    writeFileSync(path.join(hooks, "Slice6Fixture.pm"),
        "package LJ::Hooks::Slice6Fixture; use LJ::Hooks; " +
        "LJ::Hooks::register_hook('check_cap_s2viewentry', sub {1}); " +
        "LJ::Hooks::register_hook('journal_base', sub {'https://custom.example'}); " +
        "LJ::Hooks::register_hook('css_cleaner_transform', sub {die 'must-not-execute'}); LJ::Hooks::register_hook('augment_s2_tag_list', sub {die 'must-not-execute'}); " +
        "LJ::Hooks::register_hook('construct_userpic_url', sub {die 'must-not-execute'}); 1;\n");
    const output = path.join(base, "site.json");
    const positive = exportSite(home, output);
    assert.equal(positive.status, 0, positive.stderr);
    const config = readStartupConfig(output);
    assert.equal(config.capabilities.s2ViewEntry.hookConfigured, true);
    assert.equal(config.app.journalUrls.hookConfigured, true);
    assert.equal(config.app.userpicUrlHookConfigured, true);
    assert.equal(config.app.cssCleanerHookKind,'unsupported');
    assert.equal(config.app.tagListHookConfigured,true);
    assert.equal(config.app.tagsEnabled,true);
    assert.deepEqual(config.placeholder.descriptor,
        {src: "https://app.example.test/img/custom.png", width: 45, height: 21, altKey: "custom.placeholder"});
    writeFileSync(path.join(hooks, "Slice6Fixture.pm"),
        `package LJ::Hooks::Slice6Fixture; use DBI; BEGIN {eval {DBI->connect('DBI:mysql:x','fixture','${secret}')}}; 1;\n`);
    const negative = exportSite(home, path.join(base, "blocked.json"));
    assert.equal(negative.status, 1);
    assert.ok(!negative.stderr.includes(secret) && !negative.stdout.includes(secret));
    assert.ok(!existsSync(path.join(base, "blocked.json")));
}));

test("own ordinary configuration exports without DB/bootstrap/journal prerequisites", () => temporary(dir => {
    const output = path.join(dir, "own.json");
    const result = exportSite(repo, output);
    assert.equal(result.status, 0, result.stderr);
    const config = readStartupConfig(output);
    assert.ok(config.database.sources.length > 0);
    assert.equal(config.app.entryContent.urls.imageProxy, "not-configured");
    assert.equal(config.app.listenOrigin, "http://viewer.example.test:9191");
    assert.equal(config.listener.host, "0.0.0.0");
}));

test("exporter missing origins and bad CLI refuse without publication or private data", () => temporary(dir => {
    const home = fixture(dir, "$IS_DEV_SERVER=1; $IS_DEV_CONTAINER=1;");
    const output = path.join(dir, "missing-origin.json");
    const missing = spawnSync("perl", ["-I", path.join(repo, "cgi-bin"), exporter,
        "--output", output, "--listen-origin", "http://viewer.example.test:9191"],
    {env: {...process.env, LJHOME: home}, encoding: "utf8", timeout: 15000});
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /provide --app-origin/);
    assert.ok(!missing.stdout.includes(secret) && !missing.stderr.includes(secret));
    assert.ok(!existsSync(output));
    const bad = spawnSync("perl", ["-I", path.join(repo, "cgi-bin"), exporter,
        "--output", output, "--unknown", secret],
    {env: {...process.env, LJHOME: home}, encoding: "utf8", timeout: 15000});
    assert.equal(bad.status, 1);
    assert.ok(!bad.stdout.includes(secret) && !bad.stderr.includes(secret));
    assert.ok(!existsSync(output));
}));

test("private file/CLI shape failures have fixed safe diagnostics", () => temporary(dir => {
    const home = fixture(dir); const good = path.join(dir, "good.json");
    assert.equal(exportSite(home, good).status, 0);
    const baseline = JSON.parse(readFileSync(good, "utf8")) as Record<string, unknown>;
    const bad = path.join(dir, "bad.json");
    function refused(data: string | Buffer, mode = 0o600): void {
        writeFileSync(bad, data, {mode}); chmodSync(bad, mode);
        assert.throws(() => readStartupConfig(bad), error => {
            assert.ok(error instanceof StartupConfigError);
            assert.ok(!error.message.includes(secret)); return true;
        });
    }
    refused(`{ "password":"${secret}", broken }`);
    refused(Buffer.from([0xff])); refused("x".repeat(65537));
    refused(JSON.stringify(baseline), 0o644);
    const link = path.join(dir, "link.json"); symlinkSync(good, link);
    assert.throws(() => readStartupConfig(link), StartupConfigError);
    assert.throws(() => readStartupConfig(dir), StartupConfigError);
    assert.throws(() => readStartupConfig(path.join(dir, "absent")), StartupConfigError);
    for (const mutation of [
        {...baseline, schema: 2}, {...baseline, unknown: secret},
        {...baseline, listener: {host: "http://unsafe", port: 9191}},
        {...baseline, listener: {host: "127.0.0.1", port: 0}},
        {...baseline, app: {...baseline.app as object, listenOrigin: "https://user:secret@example.test"}},
    ]) assert.throws(() => validateStartupConfig(mutation), StartupConfigError);
    assert.equal(parseStartupArgs(["--config", good]), good);
    for (const args of [[], ["--config"], ["--config", good, "--unknown"], [secret]]) {
        assert.throws(() => parseStartupArgs(args), error => {
            assert.ok(error instanceof StartupConfigError && !error.message.includes(secret)); return true;
        });
    }
}));

test("tag enable fact preserves native scalar and no-argument callback configuration",()=>temporary(dir=>{
    for(const [id,source,enabled] of [["scalar","$DISABLED{tags}=1;",false],
        ["callback","$DISABLED{tags}=sub {1};",false],["false","$DISABLED{tags}='0';",true]] as const){
        const base=path.join(dir,id);mkdirSync(base);const home=fixture(base,source),out=path.join(base,"site.json");
        const result=exportSite(home,out);assert.equal(result.status,0,result.stderr);
        const value=readStartupConfig(out);assert.equal(value.app.tagsEnabled,enabled);assert.equal(value.app.tagListHookConfigured,false);
    }
}));


test("author badge export preserves reached hooks and readonly source facts without execution",()=>temporary(dir=>{
    const home=fixture(dir,`$CAP_DEF{staff_headicon}=0;$CAP_DEF{readonly}=0;$CAP_DEF{avoid_readonly}=1;
$CAP{1}{staff_headicon}=1;$CAP{5}{readonly}=1;
%READONLY_CLUSTER=(0=>1,7=>1,9=>0);%READONLY_CLUSTER_ADVISORY=(7=>'when_needed',9=>'configured',10=>'0');
LJ::Hooks::register_hook('head_icon',sub{die 'must-not-execute'});
LJ::Hooks::register_hook('check_cap_readonly',sub{die 'must-not-execute'});`);
    const output=path.join(dir,'author.json');const result=exportSite(home,output);
    assert.equal(result.status,0,result.stderr);assert.equal(result.stderr,'');
    const value=readStartupConfig(output);assert.equal(value.app.headIconHookConfigured,true);
    assert.deepEqual(value.capabilities.authorStaffHeadicon,{defaultValue:0,byBit:[{bit:1,value:1}],hookConfigured:false});
    assert.deepEqual(value.capabilities.authorReadonly,{defaultValue:0,byBit:[{bit:5,value:1}],hookConfigured:true});
    assert.deepEqual(value.capabilities.authorAvoidReadonly,{defaultValue:1,byBit:[],hookConfigured:false});
    assert.deepEqual(value.capabilities.authorReadonlyClusters,[{clusterId:0,forced:true,advisory:'off'},
        {clusterId:7,forced:true,advisory:'when-needed'},{clusterId:9,forced:false,advisory:'on'}]);
    for(const mutate of [(v:any)=>v.app.headIconHookConfigured='false',
        (v:any)=>v.capabilities.authorReadonlyClusters.push(v.capabilities.authorReadonlyClusters[0]),
        (v:any)=>v.capabilities.authorReadonlyClusters[0].advisory='unknown']) {
        const changed=JSON.parse(JSON.stringify(value));mutate(changed);assert.throws(()=>validateStartupConfig(changed));
    }
}));


test("installed feature helper calls zero-argument CODE and blocks swallowed DB access",()=>temporary(dir=>{
    const home=fixture(dir,`$DISABLED{memories}=sub{die 'unexpected arguments' if @_;return 0;};
$DISABLED{tellafriend}=sub{die 'unexpected arguments' if @_;return 1;};$DISABLED{esn}='0';`);
    const output=path.join(dir,"features.json");
    const exported=exportSite(home,output);assert.equal(exported.status,0,exported.stderr);
    assert.deepEqual(readStartupConfig(output).sourceFeatureFlags,{memories:true,tellafriend:false,esn:true});
    assert.match(readStartupConfig(output).sourceFeatureFlagsIdentity!,/^[a-f0-9]{64}$/);
    const unsafeHome=fixture(path.join(dir,"unsafe"),`$DISABLED{memories}=sub{eval{DBI->connect('ignored');};return 0;};`);
    const rejected=exportSite(unsafeHome,path.join(dir,"unsafe.json"));
    assert.notEqual(rejected.status,0);assert.equal(existsSync(path.join(dir,"unsafe.json")),false);
    assert.match(rejected.stderr,/Feature setup attempted a database connection/);
}));

test("standard image setup preserves native scalar kinds, flags, absence and private boundaries",()=>temporary(dir=>{
    const home=fixture(dir,`require LJ::Global::Img;require Scalar::Util;
my $src=chr(0xe9);utf8::upgrade($src);
$LJ::DEFAULT_LANG='en';$LJ::LANGS[0]='debug';
$LJ::Img::img{rss}={src=>$src,width=>9007199254740993,height=>Scalar::Util::dualvar(2,'02'),alt=>'fixture.alt'};
$LJ::Img::img{atom}={src=>'',width=>'0',height=>1.25,alt=>''};
$LJ::Img::img{'sticky-entry'}={};`);
    const output=path.join(dir,"images.json"),result=exportSite(home,output);
    assert.equal(result.status,0,result.stderr);assert.equal(result.stderr,"");
    assert.ok(!result.stdout.includes(secret));assert.equal(statSync(output).mode&0o777,0o600);
    const config=readStartupConfig(output),facts=config.standardImages!;
    assert.deepEqual(config.nativeLanguageContext,{defaultLang:{base64:"ZW4=",utf8:false},
        firstLang:{base64:"ZGVidWc=",utf8:false}});
    assert.equal(facts.images.length,23);
    const rss=facts.images.find(image=>image.name==="rss")!;
    assert.deepEqual(rss.src,{base64:"w6k=",utf8:true});
    const width=decodeScalar(rss.width!);assert.ok(NativeNumber.is(width));assert.equal(width.wire().value,"9007199254740993");
    const height=decodeScalar(rss.height!);assert.ok(NativeString.is(height));
    assert.equal(scalarPV(height).bytes().toString(),"02");assert.equal(scalarNumber(height).wire().value,"2");
    assert.deepEqual(encodeScalar(height),rss.height);
    const atom=facts.images.find(image=>image.name==="atom")!;
    assert.equal(scalarPV(decodeScalar(atom.width!)).bytes().toString(),"0");
    assert.equal(scalarNumber(decodeScalar(atom.height!)).wire().value,"3ff4000000000000");
    const absent=facts.images.find(image=>image.name==="sticky-entry")!;
    assert.deepEqual([absent.src,absent.width,absent.height,absent.altKey],[null,null,null,null]);
    for(const mutate of [(v:any)=>v.standardImages.images.push(v.standardImages.images[0]),
        (v:any)=>v.standardImages.images[0].width={kind:"pv",base64:"!",utf8:false},
        (v:any)=>v.standardImages.prefix.utf8="false",
        (v:any)=>v.nativeLanguageContext.firstLang.base64="!"]) {
        const copy=JSON.parse(JSON.stringify(config));mutate(copy);assert.throws(()=>validateStartupConfig(copy));
    }
}));
