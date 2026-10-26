'use strict';

// Grammar scopes, rather than a source-code regex, keep comment-like strings intact.
function getCommentScope(scopes) {
    for (const scope of scopes) {
        if (scope === 'comment' || scope.startsWith('comment.')) {
            return normalizeCommentScope(scope);
        }

        // Python grammars classify docstrings as strings instead of comments.
        if (scope.startsWith('string.') && /\.(docstring|documentation)(\.|$)/.test(scope)) {
            const language = scope.split('.').pop();
            return 'comment.block.' + language;
        }
    }

    return null;
}

function normalizeCommentScope(scope) {
    const parts = scope.split('.').filter(function (part) {
        return !/^(documentation|docstring|doc|phpdoc|javadoc|jsdoc|doxygen|xml-doc)$/.test(part);
    });

    return parts.join('.');
}

function collectCommentSpans(tokens, lineLength) {
    const spans = [];

    for (const token of tokens) {
        const scope = getCommentScope(token.scopes);
        const end = Math.min(token.endIndex, lineLength);

        if (!scope || end <= token.startIndex) {
            continue;
        }

        const previous = spans[spans.length - 1];

        if (previous && previous.end === token.startIndex && previous.scope === scope) {
            previous.end = end;
        } else {
            spans.push({ start: token.startIndex, end: end, scope: scope });
        }
    }

    return spans;
}

module.exports = { getCommentScope, normalizeCommentScope, collectCommentSpans };
