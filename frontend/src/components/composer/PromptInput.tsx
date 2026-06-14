/**
 * PromptInput — the composer's compound input shell.
 *
 * Provides the shared `PromptInputContext` (value/setValue/onSubmit/isLoading/
 * disabled/maxHeight) and the pieces that consume it: the bordered rounded
 * container (`PromptInput`), the auto-sizing `PromptInputTextarea`, and the
 * `PromptInputActions`/`PromptInputAction` tooltip-wrapped action row. Extracted
 * verbatim from the lab composer; the key-handler rewrite is a later phase.
 */
import React from 'react';
import { cn } from '@librechat/client/utils';
import {
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './primitives';

interface PromptInputContextType {
  isLoading: boolean;
  value: string;
  setValue: (value: string) => void;
  maxHeight: number | string;
  onSubmit?: () => void;
  disabled?: boolean;
  enterToSend: boolean;
}
const PromptInputContext = React.createContext<PromptInputContextType>({
  isLoading: false,
  value: '',
  setValue: () => {},
  maxHeight: 240,
  onSubmit: undefined,
  disabled: false,
  enterToSend: true,
});
function usePromptInput() {
  const context = React.useContext(PromptInputContext);
  if (!context) throw new Error('usePromptInput must be used within a PromptInput');
  return context;
}

interface PromptInputProps {
  isLoading?: boolean;
  value: string;
  onValueChange: (value: string) => void;
  maxHeight?: number | string;
  onSubmit?: () => void;
  enterToSend?: boolean;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  onPaste?: (e: React.ClipboardEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
}
export const PromptInput = React.forwardRef<HTMLDivElement, PromptInputProps>(
  function PromptInput(
    {
      className,
      isLoading = false,
      maxHeight = 240,
      value,
      onValueChange,
      onSubmit,
      enterToSend = true,
      children,
      disabled = false,
      onPaste,
      onDragOver,
      onDragLeave,
      onDrop,
    },
    ref,
  ) {
    return (
      <TooltipProvider>
        <PromptInputContext.Provider
          value={{
            isLoading,
            value: value,
            setValue: onValueChange,
            maxHeight,
            onSubmit,
            disabled,
            enterToSend,
          }}
        >
          <div
            ref={ref}
            className={cn(
              'counselle-composer',
              'rounded-3xl border p-2 transition-all duration-300',
              'border-gray-200 bg-white shadow-[0_8px_30px_rgba(0,0,0,0.08)]',
              'dark:border-[#444444] dark:bg-[#1F2023] dark:shadow-[0_8px_30px_rgba(0,0,0,0.24)]',
              isLoading && 'border-red-500/70 dark:border-red-500/70',
              className,
            )}
            onPaste={onPaste}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            {children}
          </div>
        </PromptInputContext.Provider>
      </TooltipProvider>
    );
  },
);

interface PromptInputTextareaProps {
  disableAutosize?: boolean;
  placeholder?: string;
}
export const PromptInputTextarea = React.forwardRef<
  HTMLTextAreaElement,
  PromptInputTextareaProps & React.ComponentProps<typeof Textarea>
>(function PromptInputTextarea(
  { className, onKeyDown, disableAutosize = false, placeholder, ...props },
  forwardedRef,
) {
  const { value, setValue, maxHeight, onSubmit, disabled, isLoading, enterToSend } =
    usePromptInput();
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  // Bridge the forwarded ref (container autofocus/autosave) with the internal
  // ref used for autosize, without clobbering either.
  const setRefs = React.useCallback(
    (node: HTMLTextAreaElement | null) => {
      textareaRef.current = node;
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    },
    [forwardedRef],
  );

  React.useEffect(() => {
    if (disableAutosize || !textareaRef.current) return;
    textareaRef.current.style.height = 'auto';
    textareaRef.current.style.height =
      typeof maxHeight === 'number'
        ? `${Math.min(textareaRef.current.scrollHeight, maxHeight)}px`
        : `min(${textareaRef.current.scrollHeight}px, ${maxHeight})`;
  }, [value, maxHeight, disableAutosize]);

  // Enter handling mirrors useTextarea.ts: IME guard, no double-send while
  // streaming, then enterToSend selects Enter-vs-Ctrl/Cmd-Enter as the send key.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.key === 'Process' || e.nativeEvent.keyCode === 229) return; // IME guard (incl. Safari)
    if (e.key !== 'Enter') {
      onKeyDown?.(e);
      return;
    }
    if (isLoading) {
      e.preventDefault();
      return;
    }
    const isModEnter = e.metaKey || e.ctrlKey;
    if (enterToSend) {
      if (!e.shiftKey) {
        e.preventDefault();
        onSubmit?.();
        return;
      }
    } else if (isModEnter) {
      e.preventDefault();
      onSubmit?.();
      return;
    }
    onKeyDown?.(e);
  };

  return (
    <Textarea
      ref={setRefs}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      className={cn('text-base', className)}
      disabled={disabled}
      placeholder={placeholder}
      {...props}
    />
  );
});

type PromptInputActionsProps = React.HTMLAttributes<HTMLDivElement>;
export const PromptInputActions: React.FC<PromptInputActionsProps> = ({
  children,
  className,
  ...props
}) => (
  <div className={cn('flex items-center gap-2', className)} {...props}>
    {children}
  </div>
);

interface PromptInputActionProps extends React.ComponentProps<typeof Tooltip> {
  tooltip: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}
export const PromptInputAction: React.FC<PromptInputActionProps> = ({
  tooltip,
  children,
  className,
  side = 'top',
  ...props
}) => {
  const { disabled } = usePromptInput();
  return (
    <Tooltip {...props}>
      <TooltipTrigger asChild disabled={disabled}>
        {children}
      </TooltipTrigger>
      <TooltipContent side={side} className={className}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
};
