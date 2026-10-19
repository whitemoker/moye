import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { color, oneDarkHighlightStyle } from '@codemirror/theme-one-dark'

// Keep the language token groups, but resolve their colors from Moye's theme.
// CSS variables also update existing and lazily mounted blocks without replacing
// their editor state, selection or undo history when the app theme changes.
const tokenColors = new Map([
  [color.ivory, 'var(--text)'],
  [color.violet, 'var(--code-keyword)'],
  [color.coral, 'var(--code-name)'],
  [color.malibu, 'var(--code-function)'],
  [color.whiskey, 'var(--code-constant)'],
  [color.chalky, 'var(--code-number)'],
  [color.cyan, 'var(--code-operator)'],
  [color.stone, 'var(--code-comment)'],
  [color.sage, 'var(--code-string)'],
  [color.invalid, 'var(--text)'],
])

export const codeBlockTheme = [
  EditorView.theme({
    '&': { color: 'var(--text)', backgroundColor: 'var(--code)' },
    '.cm-content': { caretColor: 'var(--text)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)' },
    '.cm-gutters': { color: 'var(--code-comment)', backgroundColor: 'var(--code)', border: 'none' },
    '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--code-active)' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'var(--code-selection)' },
    '.cm-selectionMatch': { backgroundColor: 'var(--code-selection)' },
    '&.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--code-selection)' },
    '&.cm-focused .cm-nonmatchingBracket': { outline: '1px solid var(--code-name)' },
    '.cm-foldPlaceholder': { color: 'var(--text)', backgroundColor: 'var(--hover)', border: 'none' },
    '.cm-panels, .cm-tooltip': { color: 'var(--text)', backgroundColor: 'var(--side)', borderColor: 'var(--border)' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { color: 'var(--text)', backgroundColor: 'var(--accent-light)' },
  }),
  syntaxHighlighting(HighlightStyle.define(oneDarkHighlightStyle.specs.map(spec => ({
    ...spec,
    ...(typeof spec.color === 'string' ? { color: tokenColors.get(spec.color) ?? 'var(--text)' } : {}),
  })))),
]
