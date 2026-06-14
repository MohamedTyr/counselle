import React, { useState, useMemo, useCallback, useEffect } from 'react';
import type { TUser } from 'librechat-data-provider';
import { Skeleton } from './Skeleton';
import { UserIcon } from '@librechat/client/svgs';

export interface AvatarProps {
  user?: TUser;
  size?: number;
  className?: string;
  alt?: string;
  showDefaultWhenEmpty?: boolean;
}

/** First letter of the name, else the email's local part — uppercased. Empty when neither. */
function deriveInitial(user?: TUser): string {
  const source = user?.name?.trim() || user?.username?.trim() || user?.email?.trim() || '';
  return source ? source[0].toUpperCase() : '';
}

const Avatar: React.FC<AvatarProps> = ({
  user,
  size = 32,
  className = '',
  alt,
  showDefaultWhenEmpty = true,
}) => {
  // Counselle: dicebear fallback was stripped, so the ONLY real image source is a
  // user-set `user.avatar` URL. Everything else falls back to the themed default
  // (initial monogram, or a user glyph when we have no name/email at all).
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  const avatarUrl = useMemo(() => (user?.avatar ?? '').trim(), [user?.avatar]);
  const hasImage = avatarUrl.length > 0 && !imageError;

  // A new URL must get a fresh load attempt: clear the prior error/loaded flags so a
  // swapped avatar isn't stuck on the monogram (or skipping its skeleton) for the session.
  useEffect(() => {
    setImageError(false);
    setImageLoaded(false);
  }, [avatarUrl]);

  const initial = useMemo(() => deriveInitial(user), [user]);

  const altText = useMemo(
    () => alt || `${user?.name || user?.username || user?.email || 'User'}'s avatar`,
    [alt, user?.name, user?.username, user?.email],
  );

  const handleImageLoad = useCallback(() => setImageLoaded(true), []);
  const handleImageError = useCallback(() => {
    setImageError(true);
    setImageLoaded(false);
  }, []);

  if (!hasImage) {
    if (!showDefaultWhenEmpty) {
      return null;
    }
    // Themed default: a tinted neutral disc with the user's initial. No name → user glyph.
    return (
      <div
        style={{ width: `${size}px`, height: `${size}px` }}
        className={`relative flex select-none items-center justify-center rounded-full bg-surface-tertiary font-medium uppercase text-text-secondary ring-1 ring-inset ring-border-medium ${className}`}
        role="img"
        aria-label={altText}
        data-testid="default-avatar"
      >
        {initial ? (
          <span style={{ fontSize: `${Math.round(size * 0.45)}px`, lineHeight: 1 }}>{initial}</span>
        ) : (
          <UserIcon />
        )}
      </div>
    );
  }

  return (
    <div className="relative" style={{ width: `${size}px`, height: `${size}px` }}>
      {!imageLoaded && (
        <Skeleton className="rounded-full" style={{ width: `${size}px`, height: `${size}px` }} />
      )}
      <img
        style={{
          width: `${size}px`,
          height: `${size}px`,
          display: imageLoaded ? 'block' : 'none',
        }}
        className={`rounded-full object-cover ${className}`}
        src={avatarUrl}
        alt={altText}
        onLoad={handleImageLoad}
        onError={handleImageError}
      />
    </div>
  );
};

export default Avatar;
