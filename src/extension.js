'use strict';

const vscode = require('vscode');
const textmate = require('vscode-textmate');
const { GrammarService } = require('./grammar-service');
const { ThemeService } = require('./theme');
const { collectCommentSpans } = require('./comments');

function activate(context) {
    const output = vscode.window.createOutputChannel('Galastri DocBlocks');
    const log = function (message) { output.appendLine(message); };
    log('Galastri DocBlocks ' + context.extension.packageJSON.version + ' activated. Remote: ' + (vscode.env.remoteName || 'none'));
    let grammars = new GrammarService(vscode.extensions.all, log);
    let themes = new ThemeService(vscode, log);
    const documents = new Map();
    const decorations = new Map();
    const timers = new Map();
    const reports = new Map();
    let generation = 0;
    let disposed = false;

    function clearEditor(editor) {
        for (const decoration of decorations.values()) {
            editor.setDecorations(decoration, []);
        }
    }

    function reset() {
        generation++;
        documents.clear();
        reports.clear();

        for (const timer of timers.values()) {
            clearTimeout(timer);
        }

        timers.clear();

        for (const decoration of decorations.values()) {
            decoration.dispose();
        }

        decorations.clear();
        themes.dispose().catch(log);
        themes = new ThemeService(vscode, log);

        for (const editor of vscode.window.visibleTextEditors) {
            schedule(editor.document);
        }
    }

    function schedule(document) {
        const key = document.uri.toString();
        clearTimeout(timers.get(key));
        timers.set(key, setTimeout(function () {
            timers.delete(key);
            update(document).catch(function (error) { log(error.stack || error.message); });
        }, 100));
    }

    async function update(document) {
        if (disposed || document.isClosed) {
            return;
        }

        const editors = vscode.window.visibleTextEditors.filter(function (editor) {
            return editor.document === document;
        });

        if (editors.length === 0) {
            return;
        }

        const settings = vscode.workspace.getConfiguration('disableDocblocksHighlights', document);

        if (!settings.get('enabled', true) || settings.get('excludedLanguages', []).includes(document.languageId)) {
            editors.forEach(clearEditor);
            return;
        }

        const version = document.version;
        const currentGeneration = generation;
        const loaded = await grammars.load(document.languageId);
        const styles = await themes.load(document);

        if (isStale()) {
            return;
        }

        if (!loaded || !styles) {
            log('Skipped ' + document.languageId + ': grammar=' + Boolean(loaded) + ', theme=' + Boolean(styles));
            editors.forEach(clearEditor);
            return;
        }

        const key = document.uri.toString();
        let cached = documents.get(key);

        if (!cached || cached.language !== document.languageId) {
            cached = { language: document.languageId, lines: [] };
            documents.set(key, cached);
        }

        // Tokenize up to the visible area; preceding lines supply multiline state.
        let lastLine = 0;

        for (const editor of editors) {
            for (const range of editor.visibleRanges) {
                lastLine = Math.max(lastLine, range.end.line);
            }
        }

        lastLine = Math.min(document.lineCount - 1, lastLine);
        let state = textmate.INITIAL;
        let sliceStarted = performance.now();

        for (let line = 0; line <= lastLine; line++) {
            let entry = cached.lines[line];

            if (!entry) {
                const content = document.lineAt(line).text;
                // Complete each line so multiline comment state remains accurate.
                // Cold PHP grammars can exceed 20 ms even on ordinary source lines.
                const result = loaded.grammar.tokenizeLine(content, state);

                entry = {
                    state: result.ruleStack,
                    spans: collectCommentSpans(result.tokens, content.length)
                };
                cached.lines[line] = entry;
            }

            state = entry.state;

            // Yield between complete lines instead of abandoning the whole document.
            if (performance.now() - sliceStarted >= 8) {
                await new Promise(function (resolve) { setImmediate(resolve); });

                if (isStale()) {
                    return;
                }

                sliceStarted = performance.now();
            }
        }

        for (const editor of editors) {
            const grouped = new Map();

            for (const visible of editor.visibleRanges) {
                for (let line = visible.start.line; line <= Math.min(visible.end.line, lastLine); line++) {
                    for (const span of cached.lines[line].spans) {
                        const style = await styles.get(loaded.scope, span.scope);

                        if (isStale()) {
                            return;
                        }

                        const styleKey = JSON.stringify(style);

                        if (!decorations.has(styleKey)) {
                            decorations.set(styleKey, vscode.window.createTextEditorDecorationType(style));
                        }

                        const decoration = decorations.get(styleKey);
                        const ranges = grouped.get(decoration) || [];
                        ranges.push(new vscode.Range(line, span.start, line, span.end));
                        grouped.set(decoration, ranges);
                    }
                }
            }

            for (const decoration of decorations.values()) {
                editor.setDecorations(decoration, grouped.get(decoration) || []);
            }

            const count = [...grouped.values()].reduce(function (sum, ranges) { return sum + ranges.length; }, 0);
            const report = JSON.stringify({ version: version, count: count, styles: [...grouped.keys()].length });

            if (reports.get(key) !== report) {
                reports.set(key, report);
                log(document.languageId + ': grammar=' + loaded.scope + ', visible comment ranges=' + count + ', styles=' + grouped.size);

                for (const [styleKey, decoration] of decorations) {
                    if (grouped.has(decoration)) {
                        log('Comment style: ' + styleKey);
                    }
                }
            }
        }

        function isStale() {
            return disposed || currentGeneration !== generation || document.isClosed || document.version !== version;
        }
    }

    context.subscriptions.push(
        output,
        vscode.window.onDidChangeVisibleTextEditors(function (editors) {
            editors.forEach(function (editor) { schedule(editor.document); });
        }),
        vscode.window.onDidChangeActiveTextEditor(function (editor) {
            if (editor) { schedule(editor.document); }
        }),
        vscode.window.onDidChangeTextEditorVisibleRanges(function (event) { schedule(event.textEditor.document); }),
        vscode.workspace.onDidChangeTextDocument(function (event) {
            const key = event.document.uri.toString();
            const cached = documents.get(key);

            if (cached && event.contentChanges.length > 0) {
                const firstLine = Math.min(...event.contentChanges.map(function (change) { return change.range.start.line; }));
                cached.lines.length = Math.min(cached.lines.length, firstLine);
            }

            schedule(event.document);
        }),
        vscode.workspace.onDidCloseTextDocument(function (document) {
            const key = document.uri.toString();
            documents.delete(key);
            clearTimeout(timers.get(key));
            timers.delete(key);
        }),
        vscode.window.onDidChangeActiveColorTheme(reset),
        vscode.workspace.onDidChangeConfiguration(function (event) {
            if (event.affectsConfiguration('disableDocblocksHighlights') ||
                event.affectsConfiguration('editor.tokenColorCustomizations') ||
                event.affectsConfiguration('workbench.colorCustomizations') ||
                event.affectsConfiguration('workbench.colorTheme')) {
                reset();
            }
        }),
        vscode.extensions.onDidChange(function () {
            generation++;
            grammars.dispose();
            grammars = new GrammarService(vscode.extensions.all, log);
            reset();
        }),
        vscode.commands.registerCommand('disableDocblocksHighlights.toggle', async function () {
            const settings = vscode.workspace.getConfiguration('disableDocblocksHighlights');
            await settings.update('enabled', !settings.get('enabled', true), vscode.ConfigurationTarget.Global);
        }),
        vscode.commands.registerCommand('disableDocblocksHighlights.diagnose', async function () {
            output.show(true);
            const editor = vscode.window.activeTextEditor;

            if (!editor) {
                log('No active text editor.');
                return;
            }

            const document = editor.document;
            const settings = vscode.workspace.getConfiguration('disableDocblocksHighlights', document);
            log('Diagnosis: version=' + context.extension.packageJSON.version + ', language=' + document.languageId +
                ', scheme=' + document.uri.scheme + ', enabled=' + settings.get('enabled', true) +
                ', excluded=' + JSON.stringify(settings.get('excludedLanguages', [])));
            log('Theme: ' + vscode.workspace.getConfiguration('workbench').get('colorTheme'));
            documents.delete(document.uri.toString());
            reports.delete(document.uri.toString());
            await update(document);
            log('Diagnosis finished.');
        }),
        {
            dispose: function () {
                disposed = true;
                generation++;
                for (const timer of timers.values()) { clearTimeout(timer); }
                for (const decoration of decorations.values()) { decoration.dispose(); }
                documents.clear();
                grammars.dispose();
                themes.dispose().catch(function () {});
            }
        }
    );

    vscode.window.visibleTextEditors.forEach(function (editor) { schedule(editor.document); });
}

module.exports = { activate };
