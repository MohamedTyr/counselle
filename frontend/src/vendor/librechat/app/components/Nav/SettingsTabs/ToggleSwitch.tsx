// Vendored from upstream client/src/components/Nav/SettingsTabs/ToggleSwitch.tsx @ 197a1dc4
// Rewire (Recoil→props): the Recoil/jotai `stateAtom` branches (RecoilToggle /
//   JotaiToggle / isRecoilState) collapse into one component taking controlled
//   `checked` + `onCheckedChange` props; `localizationKey` → pre-localized `label`
//   string (Counselle callers pass plain strings). Row JSX + classes byte-identical
//   to upstream's toggle body.
import { Switch, InfoHoverCard, ESide } from '@librechat/client';

interface ToggleSwitchProps {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  label: string;
  hoverCardText?: string;
  switchId: string;
  showSwitch?: boolean;
  disabled?: boolean;
  strongLabel?: boolean;
}

const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  checked,
  onCheckedChange,
  label,
  hoverCardText,
  switchId,
  showSwitch = true,
  disabled = false,
  strongLabel = false,
}) => {
  if (!showSwitch) {
    return null;
  }

  const labelId = `${switchId}-label`;

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center space-x-2">
        <div id={labelId}>{strongLabel ? <strong>{label}</strong> : label}</div>
        {hoverCardText && <InfoHoverCard side={ESide.Bottom} text={hoverCardText} />}
      </div>
      <Switch
        id={switchId}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="ml-4"
        data-testid={switchId}
        aria-labelledby={labelId}
      />
    </div>
  );
};

export default ToggleSwitch;
