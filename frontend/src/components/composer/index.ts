/**
 * Public surface of the composer feature module.
 *
 * Re-exports the `CounselleComposer` component and the `ComposerState`/`SourceId`
 * types. Consumers import from here, not from the internal split modules.
 */
import './composer.css';

export { CounselleComposer } from './CounselleComposer';
export type { ComposerState } from './CounselleComposer';
export type { SourceId } from './SourcesControl';
