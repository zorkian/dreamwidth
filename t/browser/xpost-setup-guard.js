// Regression coverage for legacy XPost setup on manager BML forms.
// Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(process.env.LJHOME + '/htdocs/js/xpost.js', 'utf8');
const start = source.indexOf('XPostAccount.setUpXpostForm = function () {');
const end = source.indexOf('\n}\n\n/**', start) + 2;
assert.ok(start >= 0 && end > start, 'actual setup function is present');
const setupSource = source.slice(start, end);

function run(elements) {
    const calls = [];
    const context = {
        document: {getElementById: id => elements[id] || null, getElementsByTagName: () => []},
        DOM: {
            addEventListener: (...args) => calls.push(['listen', ...args]),
            filterElementsByClassName: () => [],
        },
        xpostUser: 'tester',
        XPostAccount: {
            xpostFormSubmitted: () => {},
            saveSubmitValue: () => {},
            loadAccounts: () => calls.push(['load']),
            xpostAcctUpdated: () => calls.push(['update']),
            updateXpostFromJournal: user => calls.push(['journal', user]),
        },
    };
    context.XPostAccount.xpostFormSubmitted.bindEventListener = () => 'submit';
    context.XPostAccount.saveSubmitValue.bindEventListener = () => 'click';
    vm.runInNewContext(setupSource, context);
    context.XPostAccount.setUpXpostForm();
    return calls;
}
assert.deepEqual(run({updateForm: {}}), [], 'manager form without master control skips XPost setup');
const calls = run({updateForm: {}, prop_xpost_check: {}});
assert.equal(calls[0][0], 'listen', 'ordinary form binds submit listener');
assert.deepEqual(calls.slice(1), [['load'], ['update'], ['journal', 'tester']],
    'ordinary form loads accounts, updates master, and applies journal state');
console.log('PASS: XPost setup guard');
