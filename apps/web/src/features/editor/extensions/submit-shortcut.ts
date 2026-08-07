import { Extension } from '@tiptap/core'

interface SubmitShortcutOptions {
  submitOnEnter: boolean
}

/**
 * Adds editor submission shortcuts while preserving IME composition, code-block
 * newlines, and normal Enter behavior when the caller declines submission.
 */
export function createSubmitExtension(
  submit: () => boolean,
  { submitOnEnter }: SubmitShortcutOptions,
) {
  return Extension.create({
    name: 'gardenSubmitShortcut',
    addKeyboardShortcuts() {
      const shortcuts: Record<string, () => boolean> = {
        'Mod-Enter': submit,
      }

      if (submitOnEnter) {
        shortcuts.Enter = () => {
          if (this.editor.view.composing || this.editor.isActive('codeBlock')) {
            return false
          }
          return submit()
        }
      }

      return shortcuts
    },
  })
}
