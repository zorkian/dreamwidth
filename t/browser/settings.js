// Browser acceptance for settings saves using disposable test accounts.
// Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const puppeteer = require('/opt/dw-screenshot/node_modules/puppeteer-core');

const helper = spawn('perl', ['t/browser/settings-fixture.pl'], {cwd: process.env.LJHOME});
const fixturePromise = new Promise((resolve, reject) => {
    let output = '';
    helper.stdout.on('data', chunk => {
        output += chunk;
        if (output.includes('\n')) resolve(JSON.parse(output));
    });
    helper.once('error', reject);
    helper.once('exit', code => reject(new Error(`fixture exited early: ${code}`)));
});

(async () => {
    const browser = await puppeteer.launch({executablePath: '/usr/bin/google-chrome-stable', args: ['--no-sandbox']});
    try {
        const fixture = await fixturePromise;
        assert.ok(fixture.user && fixture.community, 'fixture creates disposable browser credentials');
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const base = 'http://127.0.0.1:8080';
        const save = async () => Promise.all([
            page.waitForNavigation({waitUntil: 'networkidle0'}), page.click('#settings_save input')
        ]);
        await page.goto(base + '/mobile/login', {waitUntil: 'networkidle0'});
        await page.type('[name=user]', fixture.user);
        await page.type('[name=password]', fixture.password);
        await Promise.all([page.waitForNavigation({waitUntil: 'networkidle0'}), page.click('[type=submit]')]);

        assert.equal(fixture.community_type, 'C', 'fixture community has community type');
        assert.equal(fixture.maintainer, 1, 'fixture maintainer relation is committed');
        await page.goto(base + `/manage/settings/?authas=${fixture.community}&cat=community`, {waitUntil: 'networkidle0'});
        assert.equal(await page.$eval('[name=authas]', element => element.value), fixture.community,
            'maintainer authas selection is retained');
        assert.doesNotMatch(await page.content(), /Invalid authorization|Invalid user/i,
            'maintainer authas request has no permission error');
        const postlevel = '[name=DW__Setting__CommunityPostLevel_communitypostlevel]';
        const moderation = '[name=DW__Setting__CommunityEntryModeration_val]';
        await page.select(postlevel, 'select');
        await page.click(moderation);
        await save();
        await page.reload({waitUntil: 'networkidle0'});
        assert.equal(await page.$eval(postlevel, element => element.value), 'select', 'community post level saves and reloads');
        assert.equal(await page.$eval(moderation, element => element.checked), true, 'community moderation saves and reloads');

        await page.goto(base + '/manage/settings/?cat=privacy', {waitUntil: 'networkidle0'});
        const messaging = '[name=LJ__Setting__UserMessaging_usermsg]';
        await page.select(messaging, 'M');
        await save();
        await page.reload({waitUntil: 'networkidle0'});
        assert.equal(await page.$eval(messaging, element => element.value), 'M', 'privacy setting saves and reloads');

        await page.goto(base + '/manage/settings/?cat=display', {waitUntil: 'networkidle0'});
        const mobile = '[name=DW__Setting__MobileView_val]';
        const before = await page.$eval(mobile, element => element.checked);
        await page.click(mobile);
        await save();
        await page.reload({waitUntil: 'networkidle0'});
        assert.equal(await page.$eval(mobile, element => element.checked), !before, 'mobile preference saves and reloads');

        await page.goto(base + '/manage/settings/?cat=notifications', {waitUntil: 'networkidle0'});
        assert.ok(await page.$('#settings_form'), 'notification settings form renders for the disposable account');
        assert.deepEqual(errors, [], 'settings mutation pages have no JavaScript errors');
        console.log('PASS disposable settings community/privacy/mobile saves and notification form');
    } finally {
        await browser.close();
        helper.stdin.end();
        await new Promise(resolve => helper.once('exit', resolve));
    }
})().catch(error => { console.error(error); process.exit(1); });
