// Vendored from upstream client/src/components/Nav/SearchBar.tsx @ 197a1dc4
// Subtractions: Recoil store.search, useNewConvo, navigate('/search'), QueryKeys,
//   useConversationsInfiniteQuery integration (content search dropped).
// Rewire: search state → controlled props (searchQuery + onSearchChange);
//   filters conversation list by title only (per brief).
import React, { forwardRef, useState, useCallback, useRef } from 'react';
import { Search, X } from 'lucide-react';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type SearchBarProps = {
  isSmallScreen?: boolean;
  /** Controlled search value — passed from ConversationsSection. */
  searchQuery?: string;
  onSearchChange?: (value: string) => void;
};

const SearchBar = forwardRef((props: SearchBarProps, ref: React.Ref<HTMLDivElement>) => {
  const localize = useLocalize();
  const { isSmallScreen, searchQuery = '', onSearchChange } = props;

  const inputRef = useRef<HTMLInputElement>(null);
  const showClearIcon = searchQuery.length > 0;

  const clearText = useCallback(() => {
    onSearchChange?.('');
    inputRef.current?.focus();
  }, [onSearchChange]);

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onSearchChange?.(e.target.value);
  };

  return (
    <div
      ref={ref}
      className="group relative flex h-9 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg border-2 border-transparent px-3 py-1.5 text-text-primary focus-within:border-ring-primary focus-within:bg-surface-active-alt hover:bg-surface-active-alt"
    >
      <Search
        aria-hidden="true"
        className="absolute left-3 h-4 w-4 text-text-secondary group-focus-within:text-text-primary group-hover:text-text-primary"
      />
      <input
        type="text"
        ref={inputRef}
        className="m-0 mr-0 w-full border-none bg-transparent p-0 pl-7 text-sm leading-tight placeholder-text-secondary placeholder-opacity-100 focus-visible:outline-none group-focus-within:placeholder-text-primary group-hover:placeholder-text-primary"
        value={searchQuery}
        onChange={onChange}
        onKeyDown={(e) => {
          e.code === 'Space' ? e.stopPropagation() : null;
        }}
        aria-label={localize('com_nav_search_placeholder')}
        placeholder={localize('com_nav_search_placeholder')}
        autoComplete="off"
        dir="auto"
      />
      <button
        type="button"
        aria-label={localize('com_ui_clear_search')}
        className={cn(
          'absolute right-[7px] flex h-5 w-5 items-center justify-center rounded-full border-none bg-transparent p-0 transition-opacity duration-200',
          showClearIcon ? 'opacity-100' : 'opacity-0',
          isSmallScreen === true ? 'right-[16px]' : '',
        )}
        onClick={clearText}
        tabIndex={showClearIcon ? 0 : -1}
        disabled={!showClearIcon}
      >
        <X className="h-5 w-5 cursor-pointer" aria-hidden="true" />
      </button>
    </div>
  );
});

export default SearchBar;
