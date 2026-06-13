/**
 * Counselle-native "Default sources" settings row (FE-5, Settings → General).
 *
 * Lives in src/components/source-control/ (OUR namespace, not vendor/).
 * Writes the DEFAULT source config for NEW chats to localStorage
 * 'counselle:sourceDefaults' via sourceStore. Per-chat overrides still live in
 * the composer's SourceDropdown. Rows reuse the vendored ToggleSwitch
 * (upstream SettingsTabs row grammar); the Database row is fixed on, matching
 * SourceDropdown.
 */
import { useCallback, useState } from 'react';
import ToggleSwitch from '~/components/Nav/SettingsTabs/ToggleSwitch';
import { getDefaultSourceConfig, type SourceConfig } from '@/api/mock/sourceStore';
import { usePersistDefaultSources } from '@/app/settingsSync';

export default function DefaultSources() {
  const [config, setConfig] = useState<SourceConfig>(() => getDefaultSourceConfig());
  const persistDefaults = usePersistDefaultSources();

  const patch = useCallback(
    (partial: Partial<SourceConfig>) => {
      // Optimistic localStorage + server PATCH so the choice survives a reload.
      setConfig(persistDefaults(partial));
    },
    [persistDefaults],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col">
        <div>Default sources</div>
        <div className="text-xs text-text-secondary">
          Applied to new chats. Each chat can still override its own sources.
        </div>
      </div>
      <ToggleSwitch
        checked={true}
        onCheckedChange={() => undefined}
        label="Counselle database"
        switchId="defaultSourceDatabase"
        disabled
      />
      <ToggleSwitch
        checked={config.webSearch}
        onCheckedChange={(value) => patch({ webSearch: value })}
        label="Web search"
        switchId="defaultSourceWebSearch"
      />
      <ToggleSwitch
        checked={config.eduSources}
        onCheckedChange={(value) => patch({ eduSources: value })}
        label=".edu sources"
        switchId="defaultSourceEdu"
      />
      <ToggleSwitch
        checked={config.reddit}
        onCheckedChange={(value) => patch({ reddit: value })}
        label="Reddit"
        switchId="defaultSourceReddit"
      />
    </div>
  );
}
