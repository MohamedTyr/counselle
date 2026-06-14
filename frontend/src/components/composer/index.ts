/**
 * Public surface of the composer feature module.
 *
 * Re-exports the `CounselleComposer` component and the `SourceId` type.
 * Consumers import from here, not from the internal split modules.
 */
import './composer.css';

export { CounselleComposer } from './CounselleComposer';
export type { CounselleComposerProps } from './CounselleComposer';
export type { SourceId } from './SourcesControl';
export type { SourceConfig } from '@/api/mock/sourceStore';
