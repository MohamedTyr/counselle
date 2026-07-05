/**
 * Vendored from upstream client/src/components/Chat/Messages/MessageIcon.tsx +
 * Endpoints/Icon.tsx (pinned 197a1dc4), collapsed: endpoint/assistant/agent
 * icon resolution dropped (single fixed assistant). The user fallback chip is
 * upstream's UserAvatar fallback byte-for-byte; the assistant mark is a
 * Counselle "C" roundel sized like their endpoint icons.
 */
import { memo } from 'react';
import { UserIcon } from '@librechat/client';
import type { TMessageIcon } from '~/common';

type MessageIconProps = {
  iconData?: TMessageIcon;
};

const MessageIcon = memo(({ iconData }: MessageIconProps) => {
  if (iconData?.isCreatedByUser === true) {
    return (
      <div
        title={iconData.modelLabel}
        style={{ width: 28.8, height: 28.8 }}
        className="relative flex items-center justify-center"
      >
        <div
          style={{
            backgroundColor: 'rgb(121, 137, 255)',
            width: '20px',
            height: '20px',
            boxShadow: 'rgba(240, 246, 252, 0.1) 0px 0px 0px 1px',
          }}
          className="relative flex h-9 w-9 items-center justify-center rounded-sm p-1 text-white"
        >
          <UserIcon />
        </div>
      </div>
    );
  }

  return (
    <div
      title="Counselle"
      style={{ width: 28.8, height: 28.8 }}
      className="relative flex items-center justify-center"
    >
      <div
        className="flex items-center justify-center rounded-full bg-text-primary text-xs font-semibold text-surface-primary"
        style={{ width: '24px', height: '24px' }}
      >
        C
      </div>
    </div>
  );
});

MessageIcon.displayName = 'MessageIcon';

export default MessageIcon;
