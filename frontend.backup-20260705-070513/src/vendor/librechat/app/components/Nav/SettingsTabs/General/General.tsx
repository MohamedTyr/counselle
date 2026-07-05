// Vendored from upstream client/src/components/Nav/SettingsTabs/General/General.tsx @ 197a1dc4
// Subtractions: LangSelector (English-only, PRD), the four toggleSwitchConfigs rows
//   (enableUserMsgMarkdown / autoScroll / keepScreenAwake / newChatSwitchToHistory —
//   their Recoil prefs aren't surfaced in MVP2), ArchivedChats (no archive feature),
//   js-cookie + recoil imports.
// Addition (Counselle-native): <DefaultSources /> row — the default source config
//   for new chats (PRD-mvp2; localStorage 'counselle:sourceDefaults').
import React, { useContext } from 'react';
import { Dropdown, ThemeContext } from '@librechat/client';
import DefaultSources from '@/components/source-control/DefaultSources';
import { usePersistTheme } from '@/app/settingsSync';
import { useLocalize } from '~/hooks';

export const ThemeSelector = ({
  theme,
  onChange,
  portal = true,
}: {
  theme: string;
  onChange: (value: string) => void;
  portal?: boolean;
}) => {
  const localize = useLocalize();

  const themeOptions = [
    { value: 'system', label: localize('com_nav_theme_system') },
    { value: 'dark', label: localize('com_nav_theme_dark') },
    { value: 'light', label: localize('com_nav_theme_light') },
  ];

  const labelId = 'theme-selector-label';

  return (
    <div className="flex items-center justify-between">
      <div id={labelId}>{localize('com_nav_theme')}</div>

      <Dropdown
        value={theme}
        onChange={onChange}
        options={themeOptions}
        sizeClasses="w-[180px]"
        testId="theme-selector"
        className="z-50"
        aria-labelledby={labelId}
        portal={portal}
      />
    </div>
  );
};

function General() {
  // B5b: theme reads from the ThemeProvider; writes go through usePersistTheme
  // (local-optimistic flip + PATCH /v1/me, server settings preserved).
  const { theme } = useContext(ThemeContext);
  const changeTheme = usePersistTheme();

  return (
    <div className="flex flex-col gap-3 p-1 text-sm text-text-primary">
      <div className="pb-3">
        <ThemeSelector theme={theme} onChange={changeTheme} />
      </div>
      <div className="pb-3">
        <DefaultSources />
      </div>
    </div>
  );
}

export default React.memo(General);
