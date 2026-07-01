/**
 * CounselleComposer — the chat composer surface (upstream 21st.dev
 * `easemize/ai-prompt-box`, with the Search/Think/Canvas pills replaced by
 * Counselle's source selection).
 *
 * This is the main `forwardRef` export only: composer state, the extracted
 * file/drag/paste/submit handlers, and the return JSX. The compound input, the
 * primitives, the sources dropdown, the voice recorder, and the image dialog
 * live in sibling modules. Behavior is preserved verbatim this phase — wiring,
 * the key-handler rewrite, and the decorative-control fixes are later phases.
 *
 * Upstream source: npx shadcn@latest add https://21st.dev/r/easemize/ai-prompt-box
 */
import React from 'react';
import { ArrowUp, Paperclip, Square, StopCircle, Mic } from 'lucide-react';
import { cn } from '@librechat/client/utils';
import type { SourceConfig } from '@/api/sourceConfigStore';
import { SourcesControl, type SourceId } from './SourcesControl';
import { ResponseModeControl } from './ResponseModeControl';
import { Button } from './primitives';
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputActions,
  PromptInputAction,
} from './PromptInput';
import { VoiceRecorder } from './VoiceRecorder';
import { ImageViewDialog } from './ImageViewDialog';

const MAX_FILE_BYTES = 10 * 1024 * 1024;

// No image/voice channel exists in the MVP2 turn endpoint, so these affordances
// are hidden rather than shown as silent no-ops that drop files / record nothing
// (FE-M3 — never promise a capability the backend can't fulfill). Flip to true
// when a real upload/voice channel lands (and add the send-side wiring + an
// honest rejection toast then).
const IMAGE_UPLOAD_ENABLED = false;
const VOICE_ENABLED = false;

const isImageFile = (file: File) => file.type.startsWith('image/');

// Main Composer — upstream PromptInputBox, toggle cluster adapted to sources.
// Fully controlled: text and source state are owned by the container; the
// composer keeps only local UI state (files, recording, thinking, popover).
export interface CounselleComposerProps {
  value: string; // controlled text
  onValueChange: (v: string) => void;
  onSend: () => void; // container does trim/submit/clear
  onStop?: () => void; // cancel a streaming turn
  isLoading?: boolean; // = isSubmitting
  enterToSend?: boolean; // from app pref; default true
  placeholder?: string;
  className?: string;
  active: Set<SourceId>; // controlled sources
  subs: string[]; // controlled subreddits (r/-prefixed)
  onSourcesChange: (patch: Partial<SourceConfig>) => void;
  /** Show the ResponseModeControl pill (hidden when deep_research_enabled=false). */
  deepResearchEnabled?: boolean;
  /** Mark submit as blocked by a higher-level gate without disabling typing. */
  inputDisabled?: boolean;
}
export const CounselleComposer = React.forwardRef<HTMLTextAreaElement, CounselleComposerProps>(
  function CounselleComposer(props, ref) {
    const {
      value,
      onValueChange,
      onSend,
      onStop,
      isLoading = false,
      enterToSend = true,
      placeholder = 'Ask anything about any school…',
      className,
      active,
      subs,
      onSourcesChange,
      deepResearchEnabled = false,
      inputDisabled = false,
    } = props;
    const [files, setFiles] = React.useState<File[]>([]);
    const [filePreview, setFilePreview] = React.useState<string | null>(null);
    const [selectedImage, setSelectedImage] = React.useState<string | null>(null);
    const [isRecording, setIsRecording] = React.useState(false);
    const [sourcesOpen, setSourcesOpen] = React.useState(false);
    const uploadInputRef = React.useRef<HTMLInputElement>(null);
    const promptBoxRef = React.useRef<HTMLDivElement>(null);

    const processFile = React.useCallback((file: File) => {
    // Upload is hidden (FE-M3): no image channel exists in the turn endpoint, so
    // a dropped/pasted file must do nothing visible — not even silently populate
    // a preview. When a real upload channel lands, flip IMAGE_UPLOAD_ENABLED.
    if (!IMAGE_UPLOAD_ENABLED) return;
    if (!isImageFile(file)) return;
    if (file.size > MAX_FILE_BYTES) return;
    setFiles([file]);
    const reader = new FileReader();
    reader.onload = (e) => setFilePreview(e.target?.result as string);
    reader.readAsDataURL(file);
  }, []);

  const handleDragOver = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = React.useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const droppedFiles = Array.from(e.dataTransfer.files);
      const imageFiles = droppedFiles.filter((file) => isImageFile(file));
      if (imageFiles.length > 0) processFile(imageFiles[0]);
    },
    [processFile],
  );

  const handleRemoveFile = React.useCallback(() => {
    setFilePreview(null);
    setFiles([]);
  }, []);

  const openImageModal = React.useCallback((imageUrl: string) => setSelectedImage(imageUrl), []);

  // Scoped paste: attached to the composer root (not document), so it only
  // captures images pasted INTO the composer.
  const handlePaste = React.useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            processFile(file);
            break;
          }
        }
      }
    },
    [processFile],
  );

  // Controlled text: the container owns trim/submit/clear via RHF. The composer
  // clears only its local file preview after a send; the text is never touched
  // here.
  const handleSubmit = React.useCallback(() => {
    onSend();
    setFiles([]);
    setFilePreview(null);
  }, [onSend]);

  const handleStartRecording = React.useCallback(() => {}, []);

  // Recording is decorative: stopping just exits the recording UI and submits
  // nothing. The duration is ignored — the turn endpoint has no voice channel.
  const handleStopRecording = React.useCallback(() => {
    setIsRecording(false);
  }, []);

  const hasContent = value.trim() !== '' || files.length > 0;

  return (
    <>
      <PromptInput
        value={value}
        onValueChange={onValueChange}
        isLoading={isLoading}
        disabled={isRecording}
        enterToSend={enterToSend}
        onSubmit={handleSubmit}
        className={cn(
          'w-full transition-all duration-300 ease-in-out',
          'bg-white border-gray-200 shadow-[0_8px_30px_rgba(0,0,0,0.08)]',
          'dark:bg-[#1F2023] dark:border-[#444444] dark:shadow-[0_8px_30px_rgba(0,0,0,0.24)]',
          isRecording && 'border-red-500/70 dark:border-red-500/70',
          className,
        )}
        ref={promptBoxRef}
        onPaste={handlePaste}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* File preview removed (FE-L8): upload is hidden (FE-M3), so there is
            never a file to preview. Re-add a single-file preview here if a real
            upload channel lands. */}

        <div className={cn('transition-all duration-300', isRecording ? 'h-0 overflow-hidden opacity-0' : 'opacity-100')}>
          <PromptInputTextarea ref={ref} placeholder={placeholder} className="text-base" />
        </div>

        {/* Voice affordance gated off (FE-M3): no voice channel exists. */}
        {VOICE_ENABLED && isRecording && (
          <VoiceRecorder
            isRecording={isRecording}
            onStartRecording={handleStartRecording}
            onStopRecording={handleStopRecording}
          />
        )}

        <PromptInputActions className="flex items-center justify-between gap-2 p-0 pt-2">
          <div
            className={cn(
              'flex items-center gap-1 transition-opacity duration-300',
              isRecording ? 'opacity-0 invisible h-0' : 'opacity-100 visible',
            )}
          >
            {/* Upload affordance gated off (FE-M3): no image channel exists. */}
            {IMAGE_UPLOAD_ENABLED && (
              <PromptInputAction tooltip="Upload image">
                <button
                  onClick={() => uploadInputRef.current?.click()}
                  className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full transition-colors text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-[#9CA3AF] dark:hover:bg-gray-600/30 dark:hover:text-[#D1D5DB]"
                  disabled={isRecording}
                >
                  <Paperclip className="h-5 w-5 transition-colors" />
                  <input
                    ref={uploadInputRef}
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) processFile(e.target.files[0]);
                      if (e.target) e.target.value = '';
                    }}
                    accept="image/*"
                  />
                </button>
              </PromptInputAction>
            )}

            <div className="flex items-center">
              {/* Counselle adaptation: sources dropdown (was Search) */}
              <SourcesControl
                open={sourcesOpen}
                setOpen={setSourcesOpen}
                active={active}
                setActive={(next) =>
                  onSourcesChange({
                    webSearch: next.has('web'),
                    eduSources: next.has('edu'),
                    reddit: next.has('reddit'),
                  })
                }
                subs={subs}
                setSubs={(next) => onSourcesChange({ selectedSubreddits: next })}
              />

              <div
                className={cn(
                  'h-5 w-px bg-gray-200 dark:bg-white/10 transition-[margin] duration-200 mr-1',
                  // When Sources expands into its bordered pill, its visible edge moves
                  // to the button border; widen the left gap so it stays visually
                  // symmetric with the (border-less) gear glyph on the right.
                  sourcesOpen ? 'ml-3.5' : 'ml-1',
                )}
              />

              {deepResearchEnabled && (
                <>
                  <span className="h-5 w-px bg-gray-200 dark:bg-white/10 ml-1 mr-1" />
                  <ResponseModeControl disabled={isLoading} />
                </>
              )}
            </div>
          </div>

          <PromptInputAction
            tooltip={
              isLoading
                ? 'Stop generation'
                : VOICE_ENABLED && isRecording
                  ? 'Stop recording'
                  : VOICE_ENABLED && !hasContent
                    ? 'Voice message'
                    : 'Send message'
            }
          >
            <Button
              variant="default"
              size="icon"
              disabled={!isLoading && !(VOICE_ENABLED && isRecording) && !hasContent}
              aria-disabled={inputDisabled || undefined}
              className={cn(
                'h-8 w-8 rounded-full transition-all duration-200',
                // idle + hasContent use the (theme-aware) filled default variant;
                // only recording overrides to a transparent, red-iconed button.
                VOICE_ENABLED && isRecording && '!bg-transparent hover:!bg-gray-100 dark:hover:!bg-gray-600/30',
              )}
              onClick={() => {
                // Precedence: recording → loading(stop) → send. The voice/record
                // fallback is gated off (FE-M3) — with VOICE_ENABLED false the
                // button is disabled rather than entering a recording UI that
                // submits nothing.
                if (inputDisabled) {
                  handleSubmit();
                  return;
                }
                if (VOICE_ENABLED && isRecording) setIsRecording(false);
                else if (isLoading) onStop?.();
                else if (hasContent) handleSubmit();
                else if (VOICE_ENABLED) setIsRecording(true);
              }}
            >
              {VOICE_ENABLED && isRecording ? (
                <StopCircle className="h-5 w-5 text-red-500" />
              ) : isLoading ? (
                <Square className="h-4 w-4 fill-current animate-pulse" />
              ) : hasContent ? (
                <ArrowUp className="h-4 w-4 text-current" />
              ) : VOICE_ENABLED ? (
                <Mic className="h-5 w-5 text-current transition-colors" />
              ) : (
                <ArrowUp className="h-4 w-4 text-current" />
              )}
            </Button>
          </PromptInputAction>
        </PromptInputActions>
      </PromptInput>

      <ImageViewDialog imageUrl={selectedImage} onClose={() => setSelectedImage(null)} />
    </>
  );
});
CounselleComposer.displayName = 'CounselleComposer';
