// Browser acceptance for settings saves using disposable test accounts.
// Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const puppeteer = require('/opt/dw-screenshot/node_modules/puppeteer-core');

(async () => {
    const helper = spawn('perl', ['t/browser/settings-fixture.pl'], {cwd: process.env.LJHOME, stdio: ['pipe', 'pipe', 'inherit']});
    const done = new Promise((resolve, reject) => {
        helper.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`fixture exit: ${code}/${signal}`)));
        helper.once('error', reject);
    });
    done.catch(() => {});
    let browser;
    try {
        const fixture = await new Promise((resolve, reject) => {
            let output = '';
            helper.stdout.on('data', chunk => {
                output += chunk;
                if (output.includes('\n')) {
                    try { resolve(JSON.parse(output.split('\n')[0])); } catch (error) { reject(error); }
                }
            });
            helper.once('error', reject);
            helper.once('exit', () => reject(new Error('fixture exited before ready')));
        });
        assert.ok(fixture.user && fixture.community, 'fixture creates disposable browser credentials');
        browser = await puppeteer.launch({executablePath: '/usr/bin/google-chrome-stable', args: ['--no-sandbox']});
        const page = await browser.newPage();
        const errors = [], dialogs = [];
        let dialogPhase = '';
        page.on('pageerror', error => errors.push(error.message));
        page.on('dialog', async dialog => {
            dialogs.push(`${dialogPhase}:${dialog.type()}: ${dialog.message()}`);
            if (dialogPhase === 'cancel-unsaved') return dialog.dismiss();
            if (dialogPhase === 'deleteinactive') return dialog.accept();
            throw new Error(`unexpected dialog: ${dialog.type()}: ${dialog.message()}`);
        });
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
        await page.select(messaging, 'N');
        const unsavedRuntime = await page.evaluate(() => ({ settings: !!window.Settings, changed: window.Settings && Settings.form_changed }));
        console.log('unsaved runtime', JSON.stringify(unsavedRuntime));
        dialogPhase = 'cancel-unsaved';
        await Promise.all([page.waitForNavigation({waitUntil: 'networkidle0'}), page.click('#settings_nav a[href*="cat=display"]')]);
        dialogPhase = '';
        assert.match(page.url(), /cat=display/, 'cancelled unsaved navigation still follows the legacy link');

        await page.goto(base + '/manage/settings/?cat=display', {waitUntil: 'networkidle0'});
        const mobile = '[name=DW__Setting__MobileView_val]';
        const before = await page.$eval(mobile, element => element.checked);
        await page.click(mobile);
        await save();
        await page.reload({waitUntil: 'networkidle0'});
        assert.equal(await page.$eval(mobile, element => element.checked), !before, 'mobile preference saves and reloads');

        await page.goto(base + '/manage/settings/?cat=notifications', {waitUntil: 'networkidle0'});
        const inactiveButton = '[name=deleteinactive]';
        assert.ok(await page.$(inactiveButton), 'notification inactive-cleanup control renders');
        dialogPhase = 'deleteinactive';
        await Promise.all([page.waitForNavigation({waitUntil: 'networkidle0'}), page.click(inactiveButton)]);
        dialogPhase = '';
        const verified = await new Promise((resolve, reject) => {
            let text = '';
            const timeout = setTimeout(() => reject(new Error('fixture verification timed out')), 10000);
            helper.stdout.on('data', chunk => {
                text += chunk;
                if (!text.includes('\n')) return;
                clearTimeout(timeout);
                try { resolve(JSON.parse(text.split('\n')[0])); } catch (error) { reject(error); }
            });
            helper.once('error', reject);
            helper.once('exit', () => reject(new Error('fixture exited before verification response')));
            helper.stdin.write('verify\n');
        });
        assert.equal(verified.active, 1, 'fresh fixture read retains unrelated active Inbox subscription');
        assert.equal(verified.inactive, 0, 'fresh fixture read confirms browser deleteinactive removed inactive subscription');
        assert.equal(verified.usermsg, 'M', 'cancelled unsaved privacy change is absent from fresh DB state');
        assert.deepEqual(errors, [], 'settings mutation pages have no JavaScript errors');
        assert.equal(unsavedRuntime.changed, false, 'legacy settings page does not arm unsaved navigation after select change');
        assert.equal(dialogs.filter(value => value.startsWith('cancel-unsaved:')).length, 0, 'legacy unarmed navigation shows no confirmation');
        assert.equal(dialogs.filter(value => value.startsWith('deleteinactive:')).length, 1, 'one inactive-cleanup confirmation');
        if (process.env.SETTINGS_BROWSER_FAIL_AFTER_SAVE) throw new Error('intentional settings cleanup probe');
        console.log('PASS disposable settings community/privacy/mobile saves and notification form');
    } finally {
        try { if (browser) await browser.close(); }
        finally { helper.stdin.end(); await done; }
    }
})().catch(error => { console.error(error); process.exit(1); });
