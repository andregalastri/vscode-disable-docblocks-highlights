'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const textmate = require('vscode-textmate');
const oniguruma = require('vscode-oniguruma');

let wasmReady;

async function getOnigLib() {
    if (!wasmReady) {
        wasmReady = fs.readFile(require.resolve('vscode-oniguruma/release/onig.wasm')).then(function (buffer) {
            return oniguruma.loadWASM(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
        });
    }

    await wasmReady;

    return {
        createOnigScanner: function (patterns) { return new oniguruma.OnigScanner(patterns); },
        createOnigString: function (value) { return new oniguruma.OnigString(value); }
    };
}

class GrammarService {
    constructor(extensions, log) {
        this.grammars = new Map();
        this.languages = new Map();
        this.injections = new Map();
        this.log = log;

        for (const extension of extensions) {
            const grammars = extension.packageJSON.contributes?.grammars || [];

            for (const grammar of grammars) {
                if (!grammar.scopeName || !grammar.path) {
                    continue;
                }

                this.grammars.set(grammar.scopeName, path.resolve(extension.extensionPath, grammar.path));

                if (grammar.language) {
                    this.languages.set(grammar.language, grammar.scopeName);
                }

                for (const target of grammar.injectTo || []) {
                    const injections = this.injections.get(target) || [];
                    injections.push(grammar.scopeName);
                    this.injections.set(target, injections);
                }
            }
        }

        this.registry = new textmate.Registry({
            onigLib: getOnigLib(),
            loadGrammar: this.loadRawGrammar.bind(this),
            getInjections: this.getInjections.bind(this)
        });
    }

    getInjections(scope) {
        const found = new Set();
        const parts = scope.split('.');

        for (let index = 1; index <= parts.length; index++) {
            for (const injection of this.injections.get(parts.slice(0, index).join('.')) || []) {
                found.add(injection);
            }
        }

        return [...found];
    }

    async loadRawGrammar(scope) {
        const filePath = this.grammars.get(scope);

        if (!filePath) {
            return null;
        }

        try {
            const content = await fs.readFile(filePath, 'utf8');
            return textmate.parseRawGrammar(content, filePath);
        } catch (error) {
            this.log('Cannot read grammar ' + scope + ': ' + error.message);
            return null;
        }
    }

    async load(language) {
        const scope = this.languages.get(language);

        if (!scope) {
            return null;
        }

        const grammar = await this.registry.loadGrammar(scope);

        if (!grammar) {
            return null;
        }

        return { scope: scope, grammar: grammar };
    }

    dispose() {
        this.registry.dispose();
    }
}

module.exports = { GrammarService, getOnigLib };
