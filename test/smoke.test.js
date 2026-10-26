'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const textmate = require('vscode-textmate');
const { GrammarService } = require('../src/grammar-service');
const { collectCommentSpans } = require('../src/comments');
const { readTheme, CommentStyles, customizationRules } = require('../src/theme');

const fixturePath = path.join(__dirname, 'fixtures');

test('activation applies comment decorations to a remote PHP document', { timeout: 5000 }, async function () {
    const fs = require('node:fs');
    const vm = require('node:vm');
    const createRequire = require('node:module').createRequire;
    const noEvent = function () { return { dispose: function () {} }; };
    const lines = ['<?php', '/**', ' * @param mixed $value', ' */', '$code = 42;'];
    const document = {
        uri: { scheme: 'vscode-remote', toString: function () { return 'vscode-remote://ssh-remote/test.php'; } },
        languageId: 'php', version: 1, isClosed: false, lineCount: lines.length,
        lineAt: function (line) { return { text: lines[line] }; }
    };
    const logs = [];
    const context = { extension: { packageJSON: { version: 'test' } }, subscriptions: [] };
    let applied;
    const ready = new Promise(function (resolve) { applied = resolve; });
    const editor = {
        document: document, visibleRanges: [{ start: { line: 0 }, end: { line: 4 } }],
        setDecorations: function (decoration, ranges) {
            if (ranges.length) { applied({ style: decoration.style, ranges: ranges }); }
        }
    };
    const vscode = {
        env: { remoteName: 'ssh-remote' },
        window: {
            visibleTextEditors: [editor], activeTextEditor: editor,
            createOutputChannel: function () { return { appendLine: function (s) { logs.push(s); }, dispose: function () {} }; },
            createTextEditorDecorationType: function (style) { return { style: style, dispose: function () {} }; },
            onDidChangeVisibleTextEditors: noEvent, onDidChangeActiveTextEditor: noEvent,
            onDidChangeTextEditorVisibleRanges: noEvent, onDidChangeActiveColorTheme: noEvent
        },
        workspace: {
            getConfiguration: function (section) { return { get: function (key, fallback) {
                if (section === 'workbench' && key === 'colorTheme') { return 'Fixture Theme'; }
                return fallback;
            } }; },
            onDidChangeTextDocument: noEvent, onDidCloseTextDocument: noEvent, onDidChangeConfiguration: noEvent
        },
        extensions: { onDidChange: noEvent, all: [{
            extensionPath: fixturePath,
            packageJSON: { contributes: {
                grammars: [
                    { language: 'php', scopeName: 'source.php', path: 'php.tmLanguage.json' },
                    { language: 'php', scopeName: 'text.html.php', path: 'php-html.tmLanguage.json' }
                ],
                themes: [{ id: 'Fixture Theme', path: 'dark_plus.json' }]
            } }
        }] },
        commands: { registerCommand: noEvent },
        Range: function (line, start, endLine, end) { this.start = { line: line, character: start }; this.end = { line: endLine, character: end }; }
    };
    const filePath = path.resolve(__dirname, '../src/extension.js');
    const localRequire = createRequire(filePath);
    const module = { exports: {} };
    const sandbox = { module: module, require: function (id) {
        if (id === 'vscode') { return vscode; }
        return localRequire(id);
    }, setTimeout, clearTimeout, setImmediate, performance };

    try {
        vm.runInNewContext(fs.readFileSync(filePath, 'utf8'), sandbox, { filename: filePath });
        module.exports.activate(context);
        const result = await ready;
        assert.equal(result.style.color.toUpperCase(), '#6A9955');
        assert.ok(result.ranges.some(function (range) { return range.start.line === 2 && range.end.character === lines[2].length; }));
        assert.ok(result.ranges.every(function (range) { return range.start.line !== 4; }));
        assert.ok(logs.some(function (s) { return s.includes('visible comment ranges='); }));
    } finally {
        for (const subscription of context.subscriptions) { subscription.dispose(); }
    }
});

test('real PHP and JavaScript grammars recognize documentation without touching strings or code', async function () {
    const service = new GrammarService([{
        extensionPath: fixturePath,
        packageJSON: {
            contributes: {
                grammars: [
                    { language: 'php', scopeName: 'source.php', path: 'php.tmLanguage.json' },
                    { language: 'php', scopeName: 'text.html.php', path: 'php-html.tmLanguage.json' },
                    { language: 'javascript', scopeName: 'source.js', path: 'JavaScript.tmLanguage.json' }
                ]
            }
        }
    }], function (message) { throw new Error(message); });

    try {
        for (const language of ['php', 'javascript']) {
            const loaded = await service.load(language);
            let state = textmate.INITIAL;
            const lines = [];

            if (language === 'php') {
                lines.push('<?php');
            }

            lines.push('/**', ' * @param string|null $dump Description', ' */');
            lines.push('const example = "/** @param string inside a string */";');
            lines.push('const result = 42;');
            const comments = [];

            for (const line of lines) {
                const result = loaded.grammar.tokenizeLine(line, state);
                state = result.ruleStack;
                comments.push(collectCommentSpans(result.tokens, line.length));
            }

            const annotationLine = lines.findIndex(function (line) { return line.startsWith(' * @param'); });
            const spans = comments[annotationLine];
            assert.equal(spans.length, 1, language + ': annotation is uniformly covered');
            assert.equal(spans[0].start, 0);
            assert.equal(spans[0].end, lines[annotationLine].length);
            assert.equal(comments[comments.length - 2].length, 0, language + ': string is untouched');
            assert.equal(comments[comments.length - 1].length, 0, language + ': code after closing comment is untouched');
        }

        assert.equal(await service.load('language-without-grammar'), null);
    } finally {
        service.dispose();
    }
});

test('comment styling follows theme inheritance and user customizations', async function () {
    const theme = await readTheme(path.join(fixturePath, 'dark_plus.json'));
    const styles = new CommentStyles(theme);

    try {
        const style = await styles.get('text.html.php', 'comment.block.php');
        assert.equal(style.color.toUpperCase(), '#6A9955');
        assert.equal(style.fontWeight, 'normal');
    } finally {
        styles.dispose();
    }

    theme.settings.push(...customizationRules({
        comments: '#123456',
        '[Dark+*]': { textMateRules: [{ scope: 'source.js comment', settings: { foreground: '#ABCDEF', fontStyle: 'italic' } }] }
    }, 'Dark+ (default dark)'));
    const customized = new CommentStyles(theme);

    try {
        assert.equal((await customized.get('text.html.php', 'comment.block.php')).color.toUpperCase(), '#123456');
        const javascript = await customized.get('source.js', 'comment.block.js');
        assert.equal(javascript.color.toUpperCase(), '#ABCDEF');
        assert.equal(javascript.fontStyle, 'italic');
    } finally {
        customized.dispose();
    }
});

test('documentation scopes from other language families become ordinary comments', function () {
    const cases = [
        ['source.cs', 'comment.block.documentation.cs', 'entity.name.tag.cs'],
        ['source.cpp', 'comment.block.documentation.cpp', 'keyword.other.doxygen'],
        ['source.python', 'string.quoted.multi.docstring.multi.python', 'keyword.other']
    ];

    for (const scopes of cases) {
        const spans = collectCommentSpans([{ startIndex: 0, endIndex: 20, scopes: scopes }], 20);
        assert.equal(spans.length, 1);
        assert.ok(spans[0].scope.startsWith('comment.'));
        assert.doesNotMatch(spans[0].scope, /documentation|docstring/);
    }
});
