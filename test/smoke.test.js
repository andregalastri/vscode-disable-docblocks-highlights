'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const textmate = require('vscode-textmate');
const { GrammarService } = require('../src/grammar-service');
const { collectCommentSpans } = require('../src/comments');
const { readTheme, CommentStyles, customizationRules } = require('../src/theme');

const fixturePath = path.join(__dirname, 'fixtures');

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
