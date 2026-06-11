// Vendored from upstream client/src/components/Nav/AccountSettings.tsx @ 197a1dc4
// Subtractions: token balance (useGetUserBalance), My Files (MyFilesModal, FileText),
//   Help/FAQ link (startupConfig.helpAndFaqURL), useGetStartupConfig, useAuthContext.
// Rewire: Settings → no-op handler (FE-5 wires this); logout → no-op (FE-5 wires this).
import { memo, useRef } from 'react';
import * as Menu from '@ariakit/react/menu';
import { LogOut } from 'lucide-react';
import { GearIcon, DropdownMenuSeparator, Avatar } from '@librechat/client';
import { useLocalize } from '~/hooks';

function AccountSettings({ collapsed = false }: { collapsed?: boolean }) {
  const localize = useLocalize();
  const accountSettingsButtonRef = useRef<HTMLButtonElement>(null);

  // FE-5 wires real auth; placeholder user for FE-1.
  const user = { id: 'placeholder', name: 'You', email: 'you@example.com' };

  return (
    <Menu.MenuProvider placement={collapsed ? 'right-end' : undefined}>
      <Menu.MenuButton
        ref={accountSettingsButtonRef}
        aria-label={localize('com_nav_account_settings')}
        data-testid="nav-user"
        className={
          collapsed
            ? 'flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-surface-active-alt aria-[expanded=true]:bg-surface-active-alt'
            : 'mt-text-sm flex h-auto w-full items-center gap-2 rounded-xl p-2 text-sm transition-all duration-200 ease-in-out hover:bg-surface-active-alt aria-[expanded=true]:bg-surface-active-alt'
        }
      >
        <div
          className={collapsed ? 'size-7 flex-shrink-0' : '-ml-0.9 -mt-0.8 h-8 w-8 flex-shrink-0'}
        >
          <div className="relative flex">
            <Avatar user={user} size={collapsed ? 28 : 32} />
          </div>
        </div>
        {!collapsed && (
          <div
            className="mt-2 grow overflow-hidden text-ellipsis whitespace-nowrap text-left text-text-primary"
            style={{ marginTop: '0', marginLeft: '0' }}
          >
            {user?.name ?? localize('com_nav_user')}
          </div>
        )}
      </Menu.MenuButton>
      <Menu.Menu
        portal
        className="account-settings-popover popover-ui z-[125] w-[305px] rounded-lg md:w-[244px]"
        style={{
          transformOrigin: collapsed ? 'left bottom' : 'bottom',
          translate: collapsed ? '4px 0' : '0 -4px',
        }}
      >
        <div className="text-token-text-secondary ml-3 mr-2 py-2 text-sm" role="note">
          {user?.email}
        </div>
        <DropdownMenuSeparator />
        <Menu.MenuItem
          onClick={() => { /* FE-5 wires this */ }}
          className="select-item text-sm"
        >
          <GearIcon className="icon-md" aria-hidden="true" />
          {localize('com_nav_settings')}
        </Menu.MenuItem>
        <DropdownMenuSeparator />
        <Menu.MenuItem
          onClick={() => { /* FE-5 wires this */ }}
          className="select-item text-sm"
        >
          <LogOut className="icon-md" aria-hidden="true" />
          {localize('com_nav_log_out')}
        </Menu.MenuItem>
      </Menu.Menu>
    </Menu.MenuProvider>
  );
}

export default memo(AccountSettings);
