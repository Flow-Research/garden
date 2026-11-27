/**
 * Public surface of the `./composer` subsystem (Task 12, 2026-09-08 chat
 * composer overhaul). `../chat-panel-controller.tsx` (Task 13) imports the
 * orchestrator and the shared helpers/types from here instead of reaching
 * into `../chat-composer.tsx` directly.
 */
export { Composer, type ComposerHandle, type ComposerProps } from './composer'
/**
 * `EMPTY_INTRO_EASE` lives with the pills rather than in the controller so the
 * pill animation and the composer's lift animation cannot drift apart — the
 * controller imports it from here and keeps no local copy (Task 13 ruling).
 */
export { ComposerSuggestions, EMPTY_INTRO_EASE } from './composer-suggestions'
export {
  ACCEPTED_FILE_TYPES,
  COMPOSER_INLINE_CHIP_ICON_CLASS_NAME,
  COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME,
  COMPOSER_INLINE_SKILL_CHIP_CLASS_NAME,
  COMPOSER_WIDTH_CLASS_NAME,
  SkillGlyph,
  createFileList,
  normalizeStatus,
  shouldPersistAsDocument,
  uploadAgentDocuments,
  type ComposerThreadDocument,
  type PreviewAttachment,
} from './composer-helpers'
