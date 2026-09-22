// Exercise the standalone FCK poll dialog through the real modern entry editor.
// Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const puppeteer = require('/opt/dw-screenshot/node_modules/puppeteer-core');

(async () => {
    const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome-stable', args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage();
        const errors = [];
        const dialogs = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('dialog', async dialog => {
            dialogs.push(`${dialog.type()}: ${dialog.message()}`);
            await dialog.dismiss();
        });
        const base = 'http://127.0.0.1:8080';
        await page.goto(base + '/mobile/login', { waitUntil: 'networkidle0' });
        await page.type('[name=user]', 'test_user');
        await page.type('[name=password]', 'dreamwidth');
        await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('[type=submit]')]);
        await page.goto(base + '/entry/new', { waitUntil: 'networkidle0', timeout: 30000 });
        await page.select('#editor', 'rte0');
        await page.waitForFunction(() => window.FCKeditorAPI && FCKeditorAPI.GetInstance('entry-body')?.Status === 2);
        assert.ok(dialogs.every(message => message === 'confirm: Restore from saved draft?'),
            'only the pre-existing draft restore confirmation may be dismissed');

        const open = async () => {
            await page.evaluate(() => {
                const editor = FCKeditorAPI.GetInstance('entry-body');
                editor.Focus();
                editor.Commands.GetCommand('LJPollLink').Execute();
            });
            await page.waitForFunction(() => window.frames.length > 0);
            await page.waitForNetworkIdle();
            const dialog = page.frames().find(f => f.url().endsWith('/tools/fck_poll'));
            assert.ok(dialog, 'modern plugin opens the extensionless poll route');
            await dialog.waitForSelector('form[name=poll]');
            return dialog;
        };
        const accept = async expected => {
            const shell = page.frames().find(f => f.url().endsWith('/fckdialog.html'));
            assert.ok(shell, 'FCK dialog shell exists');
            await shell.click('#btnOk');
            await page.waitForFunction(text => FCKeditorAPI.GetInstance('entry-body').GetXHTML(false).includes(text),
                { timeout: 10000 }, expected);
        };
        const captureDialog = async (name) => {
            await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
        };
        const selectOutsidePoll = async () => {
            await page.evaluate(() => {
                const editor = FCKeditorAPI.GetInstance('entry-body');
                const polls = editor.EditorDocument.querySelectorAll('div[id^="poll"]');
                const poll = polls[polls.length - 1];
                if (!poll) throw new Error('a prior poll must exist before moving the selection');
                const range = editor.EditorDocument.createRange();
                range.setStartAfter(poll);
                range.collapse(true);
                const selection = editor.EditorWindow.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
            });
        };
        const setQuestion = async (dialog, number, type, question) => {
            await dialog.select(`select[name=type_${number}]`, type);
            await dialog.click(`input[name=setType_${number}]`);
            await dialog.type(`input[name=question_${number}]`, question);
        };

        const output = process.argv[2] || '/tmp/fck-poll-after';
        fs.mkdirSync(output, { recursive: true });
        let dialog = await open();
        await captureDialog('setup');
        await dialog.evaluate(() => OnDialogTabChange('questions'));
        await setQuestion(dialog, 0, 'radio', 'Radio question');
        await dialog.type('input[name=pq_0_opt_0]', 'One');
        await dialog.type('input[name=pq_0_opt_1]', 'Two');
        await dialog.click('input[value=" Next Question "]');
        await setQuestion(dialog, 1, 'text', 'Text question');
        await dialog.$eval('input[name=pq_1_size]', e => { e.value = '40'; });
        await dialog.$eval('input[name=pq_1_maxlength]', e => { e.value = '120'; });
        assert.match(await dialog.$eval('#QNav', e => e.textContent), /Question 2 of 2/, 'new question updates navigation');
        await dialog.evaluate(() => document.querySelector('#QNav a[href="javascript:switchQuestion(0)"]').click());
        assert.match(await dialog.$eval('#QNav', e => e.textContent), /Question 1 of 2/, 'previous question navigation works');
        await dialog.evaluate(() => switchQuestion(1));
        assert.equal(await dialog.$('input[value*="Remove"]'), null, 'legacy dialog has no question removal control to exercise');
        await captureDialog('questions');
        await accept('Radio question');

        for (const [type, question] of [['check', 'Check question'], ['drop', 'Drop question'], ['scale', 'Scale question']]) {
            await selectOutsidePoll();
            dialog = await open();
            await dialog.evaluate(() => OnDialogTabChange('questions'));
            await setQuestion(dialog, 0, type, question);
            if (type === 'scale') {
                await dialog.$eval('input[name=pq_0_from]', e => { e.value = '2'; });
                await dialog.$eval('input[name=pq_0_to]', e => { e.value = '8'; });
                await dialog.$eval('input[name=pq_0_by]', e => { e.value = '2'; });
            } else {
                await dialog.type('input[name=pq_0_opt_0]', 'First');
                await dialog.type('input[name=pq_0_opt_1]', 'Second');
                await dialog.click('input[name=more_answer]');
                assert.ok(await dialog.$('input[name=pq_0_opt_5]'), 'More adds another answer group');
            }
            await accept(question);
        }

        let html = await page.evaluate(() => FCKeditorAPI.GetInstance('entry-body').GetXHTML(false));
        for (const text of ['Radio question', 'Text question', 'Check question', 'Drop question', 'Scale question']) {
            assert.match(html, new RegExp(text), `inserted ${text}`);
        }
        assert.match(html, /id="poll3"/, 'multiple polls use nonzero indexes');

        await page.evaluate(() => {
            const editor = FCKeditorAPI.GetInstance('entry-body');
            editor.Focus();
            const range = editor.EditorDocument.createRange();
            range.selectNode(editor.EditorDocument.querySelector('#poll2'));
            const selection = editor.EditorWindow.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        });
        dialog = await open();
        await dialog.evaluate(() => OnDialogTabChange('questions'));
        assert.equal(await dialog.$eval('input[name=question_0]', e => e.value), 'Drop question', 'selected poll populates editor');
        await dialog.$eval('input[name=pq_0_opt_0]', e => { e.value = 'Edited first'; });
        await accept('Edited first');
        html = await page.evaluate(() => FCKeditorAPI.GetInstance('entry-body').GetXHTML(false));
        assert.match(html, /Edited first/, 'existing poll edit replaces selected poll');
        await page.select('#editor', 'html_raw0');
        assert.match(await page.$eval('#entry-body', e => e.value), /Edited first/, 'polls survive HTML round trip');
        await page.screenshot({ path: `${output}/html-roundtrip.png`, fullPage: true });
        await page.$eval('#entry-body', e => { e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); });
        assert.deepEqual(errors, [], 'no poll dialog JavaScript errors');
        console.log('PASS: inserted, edited, and HTML-round-tripped FCK polls without publishing');
    } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
