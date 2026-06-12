// Vendored from upstream client/src/components/Auth/SocialButton.tsx @ 197a1dc4
// Rewire: `<a href={serverDomain}/oauth/{path}>` → button with onClick (mock
// auth has no OAuth server); classes + structure byte-identical.
import React from 'react';

const SocialButton = ({ id, enabled, onClick, Icon, label }) => {
  if (!enabled) {
    return null;
  }

  return (
    <div className="mt-2 flex gap-x-2">
      <button
        type="button"
        aria-label={`${label}`}
        className="flex w-full items-center space-x-3 rounded-2xl border border-border-light bg-surface-primary px-5 py-3 text-text-primary transition-colors duration-200 hover:bg-surface-tertiary"
        onClick={onClick}
        data-testid={id}
      >
        <Icon />
        <p>{label}</p>
      </button>
    </div>
  );
};

export default SocialButton;
