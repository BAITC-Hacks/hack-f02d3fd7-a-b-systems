import { useState } from 'react';

export function UserAvatar({ id, name, hasAvatar, className = '', version = 0 }: {
  id: string; name: string; hasAvatar: boolean; className?: string; version?: number;
}) {
  const [broken, setBroken] = useState(false);
  const initials = name.split(' ').filter(Boolean).slice(0,2).map(word => word[0]).join('').toUpperCase();
  return <span className={`avatar user-avatar ${className}`} aria-label={name}>
    {hasAvatar && !broken ? <img src={`/api/users/${id}/avatar?v=${version}`} alt="" onError={() => setBroken(true)} /> : initials}
  </span>;
}
