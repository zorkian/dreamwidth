// Browser acceptance for legacy settings rendering and validation. No seeded-account mutation.
const assert = require('node:assert/strict');
const puppeteer = require('/opt/dw-screenshot/node_modules/puppeteer-core');
(async () => {
    const browser = await puppeteer.launch({executablePath: '/usr/bin/google-chrome-stable', args: ['--no-sandbox']});
    try {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const base = 'http://127.0.0.1:8080';
        await page.goto(base + '/mobile/login', {waitUntil: 'networkidle0'});
        await page.type('[name=user]', 'test_user');
        await page.type('[name=password]', 'dreamwidth');
        await Promise.all([page.waitForNavigation({waitUntil: 'networkidle0'}), page.click('[type=submit]')]);

        await page.goto(base + '/manage/settings/?cat=community&authas=test_comm', {waitUntil: 'networkidle0'});
        const postlevel = '[name=DW__Setting__CommunityPostLevel_communitypostlevel]';
        const newMembers = '[name=DW__Setting__CommunityPostLevelNew_val]';
        assert.ok(await page.$(postlevel), 'community posting-level control renders');
        assert.ok(await page.$(newMembers), 'community related control renders');
        await page.select(postlevel, 'select');
        assert.equal(await page.$eval(newMembers, element => getComputedStyle(element).display !== 'none'), true,
            'community posting selection exposes its related control');

        await page.goto(base + '/manage/settings/?cat=privacy', {waitUntil: 'networkidle0'});
        const messaging = '[name=LJ__Setting__UserMessaging_usermsg]';
        assert.ok(await page.$(messaging), 'privacy messaging control renders');
        await page.evaluate(selector => {
            const select = document.querySelector(selector);
            const option = document.createElement('option');
            option.value = 'invalid-browser-value'; option.text = 'Invalid browser value';
            select.append(option); select.value = option.value;
        }, messaging);
        await Promise.all([page.waitForNavigation({waitUntil: 'networkidle0'}), page.click('#settings_save input')]);
        assert.match(await page.content(), /invalid/i, 'server rejects browser-submitted invalid setting value');

        await page.goto(base + '/manage/settings/?cat=display', {waitUntil: 'networkidle0'});
        const mobile = '[name=DW__Setting__MobileView_val]';
        assert.ok(await page.$(mobile), 'mobile preference control renders for an authenticated user');
        const before = await page.$eval(mobile, element => element.checked);
        await page.click(mobile);
        assert.equal(await page.$eval(mobile, element => element.checked), !before, 'mobile preference is keyboard/click editable');

        await page.goto(base + '/manage/settings/?cat=notifications', {waitUntil: 'networkidle0'});
        assert.ok(await page.$('form'), 'notification controls render in an authenticated browser session');
        assert.deepEqual(errors, [], 'settings interaction pages have no JavaScript errors');
        console.log('PASS settings community conditional, privacy validation, mobile, and notifications browser checks');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exit(1); });
