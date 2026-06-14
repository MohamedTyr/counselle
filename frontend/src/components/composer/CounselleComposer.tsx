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
import { ArrowUp, Paperclip, Square, X, StopCircle, Mic, BrainCog } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@librechat/client/utils';
import { SourcesControl, type SourceId, SUBREDDITS } from './SourcesControl';
import { Button } from './primitives';
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputActions,
  PromptInputAction,
} from './PromptInput';
import { VoiceRecorder } from './VoiceRecorder';
import { ImageViewDialog } from './ImageViewDialog';

// Embedded CSS for minimal custom styles. Phase 2 moves this to a scoped
// stylesheet; kept here verbatim for now.
const styles = `
  *:focus-visible {
    outline-offset: 0 !important;
    --ring-offset: 0 !important;
  }
  textarea::-webkit-scrollbar {
    width: 6px;
  }
  textarea::-webkit-scrollbar-track {
    background: transparent;
  }
  textarea::-webkit-scrollbar-thumb {
    background-color: #444444;
    border-radius: 3px;
  }
  textarea::-webkit-scrollbar-thumb:hover {
    background-color: #555555;
  }
`;

// Inject styles into document
if (typeof document !== 'undefined') {
  const styleSheet = document.createElement('style');
  styleSheet.innerText = styles;
  document.head.appendChild(styleSheet);
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;

const isImageFile = (file: File) => file.type.startsWith('image/');

// ── Counselle adaptation: meta surfaced for the lab readout / future wiring ──
export interface ComposerState {
  text: string;
  sources: SourceId[];
  subreddits: string[];
  thinking: boolean;
}

// Main Composer — upstream PromptInputBox, toggle cluster adapted to sources.
interface CounselleComposerProps {
  onSend?: (message: string, files?: File[]) => void;
  onChange?: (state: ComposerState) => void;
  isLoading?: boolean;
  placeholder?: string;
  className?: string;
}
export const CounselleComposer = React.forwardRef(function CounselleComposer(
  props: CounselleComposerProps,
  ref: React.Ref<HTMLDivElement>,
) {
  const { onSend = () => {}, onChange, isLoading = false, placeholder = 'Ask anything about any school…', className } = props;
  const [input, setInput] = React.useState('');
  const [files, setFiles] = React.useState<File[]>([]);
  const [filePreview, setFilePreview] = React.useState<string | null>(null);
  const [selectedImage, setSelectedImage] = React.useState<string | null>(null);
  const [isRecording, setIsRecording] = React.useState(false);
  // Counselle state (replaces showSearch / showThink / showCanvas)
  const [thinking, setThinking] = React.useState(false);
  const [activeSources, setActiveSources] = React.useState<Set<SourceId>>(new Set(['web', 'edu', 'reddit']));
  const [subs, setSubs] = React.useState<string[]>(SUBREDDITS.slice(0, 3));
  const [sourcesOpen, setSourcesOpen] = React.useState(false);
  const uploadInputRef = React.useRef<HTMLInputElement>(null);
  const promptBoxRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    onChange?.({ text: input, sources: [...activeSources], subreddits: subs, thinking });
  }, [input, activeSources, subs, thinking, onChange]);

  const processFile = React.useCallback((file: File) => {
    // Guard-and-return: only images under the size cap are accepted. There is no
    // user-facing error channel and files are never transmitted, so a silent
    // bail is correct here (Phase-1 cleanup of the old console.log swallows).
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

  const handlePaste = React.useCallback(
    (e: ClipboardEvent) => {
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

  React.useEffect(() => {
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [handlePaste]);

  const handleSubmit = React.useCallback(() => {
    if (input.trim() || files.length > 0) {
      onSend(input, files);
      setInput('');
      setFiles([]);
      setFilePreview(null);
    }
  }, [input, files, onSend]);

  const handleStartRecording = React.useCallback(() => console.log('Started recording'), []);

  const handleStopRecording = React.useCallback(
    (duration: number) => {
      console.log(`Stopped recording after ${duration} seconds`);
      setIsRecording(false);
      onSend(`[Voice message - ${duration} seconds]`, []);
    },
    [onSend],
  );

  const hasContent = input.trim() !== '' || files.length > 0;

  return (
    <>
      <PromptInput
        value={input}
        onValueChange={setInput}
        isLoading={isLoading}
        onSubmit={handleSubmit}
        className={cn(
          'w-full transition-all duration-300 ease-in-out',
          'bg-white border-gray-200 shadow-[0_8px_30px_rgba(0,0,0,0.08)]',
          'dark:bg-[#1F2023] dark:border-[#444444] dark:shadow-[0_8px_30px_rgba(0,0,0,0.24)]',
          isRecording && 'border-red-500/70 dark:border-red-500/70',
          className,
        )}
        disabled={isLoading || isRecording}
        ref={ref || promptBoxRef}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {files.length > 0 && !isRecording && filePreview && (
          <div className="flex flex-wrap gap-2 p-0 pb-1 transition-all duration-300">
            {files.map((file, index) => (
              <div key={index} className="relative group">
                {file.type.startsWith('image/') && (
                  <div
                    className="w-16 h-16 rounded-xl overflow-hidden cursor-pointer transition-all duration-300"
                    onClick={() => openImageModal(filePreview)}
                  >
                    <img src={filePreview} alt={file.name} className="h-full w-full object-cover" />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveFile();
                      }}
                      className="absolute top-1 right-1 rounded-full bg-black/70 p-0.5 opacity-100 transition-opacity"
                    >
                      <X className="h-3 w-3 text-white" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className={cn('transition-all duration-300', isRecording ? 'h-0 overflow-hidden opacity-0' : 'opacity-100')}>
          <PromptInputTextarea placeholder={thinking ? 'Think deeply…' : placeholder} className="text-base" />
        </div>

        {isRecording && (
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

            <div className="flex items-center">
              {/* Counselle adaptation: sources dropdown (was Search) */}
              <SourcesControl
                open={sourcesOpen}
                setOpen={setSourcesOpen}
                active={activeSources}
                setActive={setActiveSources}
                subs={subs}
                setSubs={setSubs}
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

              {/* Think pill — kept verbatim from upstream (future thinking mode) */}
              <button
                type="button"
                onClick={() => setThinking((prev) => !prev)}
                className={cn(
                  'rounded-full transition-all flex items-center gap-1 px-2 py-1 border h-8',
                  thinking
                    ? 'ml-2.5 bg-[#8B5CF6]/15 border-[#8B5CF6] text-[#8B5CF6]'
                    : 'ml-0 bg-transparent border-transparent text-gray-500 hover:text-gray-700 dark:text-[#9CA3AF] dark:hover:text-[#D1D5DB]',
                )}
              >
                <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
                  <motion.div
                    animate={{ rotate: thinking ? 360 : 0, scale: thinking ? 1.1 : 1 }}
                    whileHover={{ rotate: thinking ? 360 : 15, scale: 1.1, transition: { type: 'spring', stiffness: 300, damping: 10 } }}
                    transition={{ type: 'spring', stiffness: 260, damping: 25 }}
                  >
                    <BrainCog className={cn('w-4 h-4', thinking ? 'text-[#8B5CF6]' : 'text-inherit')} />
                  </motion.div>
                </div>
                <AnimatePresence>
                  {thinking && (
                    <motion.span
                      initial={{ width: 0, opacity: 0 }}
                      animate={{ width: 'auto', opacity: 1 }}
                      exit={{ width: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="text-xs overflow-hidden whitespace-nowrap text-[#8B5CF6] flex-shrink-0"
                    >
                      Think
                    </motion.span>
                  )}
                </AnimatePresence>
              </button>
            </div>
          </div>

          <PromptInputAction
            tooltip={isLoading ? 'Stop generation' : isRecording ? 'Stop recording' : hasContent ? 'Send message' : 'Voice message'}
          >
            <Button
              variant="default"
              size="icon"
              className={cn(
                'h-8 w-8 rounded-full transition-all duration-200',
                // idle + hasContent use the (theme-aware) filled default variant;
                // only recording overrides to a transparent, red-iconed button.
                isRecording && '!bg-transparent hover:!bg-gray-100 dark:hover:!bg-gray-600/30',
              )}
              onClick={() => {
                if (isRecording) setIsRecording(false);
                else if (hasContent) handleSubmit();
                else setIsRecording(true);
              }}
              disabled={isLoading && !hasContent}
            >
              {isLoading ? (
                <Square className="h-4 w-4 fill-current animate-pulse" />
              ) : isRecording ? (
                <StopCircle className="h-5 w-5 text-red-500" />
              ) : hasContent ? (
                <ArrowUp className="h-4 w-4 text-current" />
              ) : (
                <Mic className="h-5 w-5 text-current transition-colors" />
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
