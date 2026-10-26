'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const jsonc = require('jsonc-parser');
const textmate = require('vscode-textmate');
const { getOnigLib } = require('./grammar-service');

async function readTheme(filePath, visited = new Set()) {
    const absolute = path.resolve(filePath);

    if (visited.has(absolute)) {
        throw new Error('Circular theme include: ' + absolute);
    }

    visited.add(absolute);
    const content = await fs.readFile(absolute, 'utf8');
    let theme;

    if (/\.tmTheme$/i.test(absolute)) {
        theme = textmate.parseRawGrammar(content, absolute);
    } else {
        const errors = [];
        theme = jsonc.parse(content, errors, { allowTrailingComma: true });

        if (!theme || errors.length > 0) {
            throw new Error('Invalid theme file: ' + absolute);
        }
    }

    let parent = { settings: [], colors: {} };

    if (theme.include) {
        parent = await readTheme(path.resolve(path.dirname(absolute), theme.include), visited);
    }

    let rules = theme.tokenColors || theme.settings || [];

    if (typeof rules === 'string') {
        const tokenTheme = await readTheme(path.resolve(path.dirname(absolute), rules), visited);
        rules = tokenTheme.settings;
    }

    return {
        settings: parent.settings.concat(rules),
        colors: Object.assign({}, parent.colors, theme.colors)
    };
}

function matchesTheme(selector, name) {
    const pattern = selector.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp('^' + pattern + '$').test(name);
}

function customizationRules(customizations, themeName) {
    const rules = [];

    function append(settings) {
        if (settings.comments) {
            let style = settings.comments;

            if (typeof style === 'string') {
                style = { foreground: style };
            }

            rules.push({ scope: 'comment', settings: style });
        }

        rules.push(...(settings.textMateRules || []));
    }

    append(customizations);

    for (const [key, value] of Object.entries(customizations)) {
        const selectors = [...key.matchAll(/\[([^\]]+)\]/g)];

        if (selectors.some(function (selector) { return matchesTheme(selector[1], themeName); })) {
            append(value);
        }
    }

    return rules;
}

class CommentStyles {
    constructor(theme) {
        this.styles = new Map();
        this.grammars = new Map();
        const grammars = this.grammars;
        this.registry = new textmate.Registry({
            onigLib: getOnigLib(),
            theme: { settings: theme.settings },
            loadGrammar: async function (scope) {
                return {
                    scopeName: scope,
                    patterns: [{ match: '.+', name: grammars.get(scope) }]
                };
            }
        });
    }

    async get(rootScope, commentScope) {
        const key = rootScope + '|' + commentScope;

        if (!this.styles.has(key)) {
            // Extra scope components keep parent selectors (e.g. source.php) valid.
            const scope = rootScope + '.galastri-comment-style.' + this.styles.size;
            this.grammars.set(scope, commentScope);
            this.styles.set(key, this.resolve(scope));
        }

        return this.styles.get(key);
    }

    async resolve(key) {
        const grammar = await this.registry.loadGrammar(key);
        const tokens = grammar.tokenizeLine2('comment', textmate.INITIAL).tokens;
        const metadata = tokens[1];
        const colorIndex = (metadata >>> 15) & 0x1ff;
        const fontStyle = (metadata >>> 11) & 0xf;

        return {
            color: this.registry.getColorMap()[colorIndex],
            fontStyle: (fontStyle & 1) ? 'italic' : 'normal',
            fontWeight: (fontStyle & 2) ? 'bold' : 'normal',
            textDecoration: [
                (fontStyle & 4) ? 'underline' : '',
                (fontStyle & 8) ? 'line-through' : ''
            ].filter(Boolean).join(' ') || 'none'
        };
    }

    dispose() {
        this.registry.dispose();
    }
}

class ThemeService {
    constructor(vscode, log) {
        this.vscode = vscode;
        this.log = log;
        this.cache = new Map();
    }

    async load(document) {
        const themeName = this.vscode.workspace.getConfiguration('workbench').get('colorTheme');
        const customizations = this.vscode.workspace.getConfiguration('editor', document).get('tokenColorCustomizations', {});
        const colors = this.vscode.workspace.getConfiguration('workbench', document).get('colorCustomizations', {});
        const cacheKey = JSON.stringify([themeName, customizations, colors]);

        if (!this.cache.has(cacheKey)) {
            this.cache.set(cacheKey, this.create(themeName, customizations, colors));
        }

        return this.cache.get(cacheKey);
    }

    async create(themeName, customizations, colorCustomizations) {
        for (const extension of this.vscode.extensions.all) {
            for (const contribution of extension.packageJSON.contributes?.themes || []) {
                if (contribution.id !== themeName && contribution.label !== themeName) {
                    continue;
                }

                const theme = await readTheme(path.resolve(extension.extensionPath, contribution.path));
                let foreground = theme.colors['editor.foreground'];
                const matchingColors = Object.assign({}, colorCustomizations);

                for (const [selector, overrides] of Object.entries(colorCustomizations)) {
                    if (selector.startsWith('[') && [...selector.matchAll(/\[([^\]]+)\]/g)].some(function (match) {
                        return matchesTheme(match[1], themeName);
                    })) {
                        Object.assign(matchingColors, overrides);
                    }
                }

                foreground = matchingColors['editor.foreground'] || foreground;

                if (foreground) {
                    theme.settings.unshift({ settings: { foreground: foreground } });
                }

                theme.settings.push(...customizationRules(customizations, themeName));
                return new CommentStyles(theme);
            }
        }

        this.log('Active theme not found: ' + themeName + '. No decorations applied.');
        return null;
    }

    async dispose() {
        for (const promise of this.cache.values()) {
            const styles = await promise.catch(function () { return null; });

            if (styles) {
                styles.dispose();
            }
        }

        this.cache.clear();
    }
}

module.exports = { readTheme, customizationRules, matchesTheme, CommentStyles, ThemeService };
