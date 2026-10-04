import React from 'react';

export type IconName =
  | 'play'
  | 'stop'
  | 'terminal'
  | 'sun'
  | 'moon'
  | 'user'
  | 'document'
  | 'refresh'
  | 'sliders'
  | 'alert'
  | 'check'
  | 'minus'
  | 'help'
  | 'shield'
  | 'info'
  | 'chevron-right'
  | 'file-question';

const ICON_PATHS: Record<IconName, React.ReactNode> = {
  play: <path d="m6 4 8 5-8 5V4Z" />,
  stop: <rect x="5" y="5" width="8" height="8" rx="1" />,
  terminal: <><path d="m4 5 3 3-3 3" /><path d="M9 12h4" /></>,
  sun: <><circle cx="9" cy="9" r="3" /><path d="M9 1.5v1.3M9 15.2v1.3M1.5 9h1.3M15.2 9h1.3M3.7 3.7l.9.9M13.4 13.4l.9.9M14.3 3.7l-.9.9M4.6 13.4l-.9.9" /></>,
  moon: <path d="M15 11.3A6.5 6.5 0 0 1 6.7 3a5.8 5.8 0 1 0 8.3 8.3Z" />,
  user: <><circle cx="9" cy="6" r="3" /><path d="M3.5 16c.5-3.2 2.3-4.8 5.5-4.8s5 1.6 5.5 4.8" /></>,
  document: <><path d="M5 2.5h5l3 3v10H5z" /><path d="M10 2.5v3h3M7.5 9h3M7.5 12h3" /></>,
  refresh: <><path d="M14.5 6A6 6 0 0 0 4 4.3L2.5 6" /><path d="M2.5 2.8V6H6M3.5 12A6 6 0 0 0 14 13.7l1.5-1.7" /><path d="M15.5 15.2V12H12" /></>,
  sliders: <><path d="M3 5h5M12 5h3M3 13h3M10 13h5" /><circle cx="10" cy="5" r="2" /><circle cx="8" cy="13" r="2" /></>,
  alert: <><path d="M9 2.5 16 15H2L9 2.5Z" /><path d="M9 7v3.5M9 13h.01" /></>,
  check: <path d="m4 9.5 3 3 7-8" />,
  minus: <path d="M5 9h8" />,
  help: <><circle cx="9" cy="9" r="6.5" /><path d="M7 7a2 2 0 1 1 3 1.7c-.7.4-1 .8-1 1.6" /><path d="M9 13h.01" /></>,
  shield: <><path d="M9 2.5 14.5 5v4c0 3.5-2.3 5.8-5.5 7-3.2-1.2-5.5-3.5-5.5-7V5L9 2.5Z" /><path d="m6.5 9 1.8 1.8L11.8 7" /></>,
  info: <><circle cx="9" cy="9" r="6.5" /><path d="M9 8.5v4M9 6h.01" /></>,
  'chevron-right': <path d="m7 4.5 4.5 4.5L7 13.5" />,
  'file-question': <><path d="M5 2.5h5l3 3v10H5z" /><path d="M10 2.5v3h3" /><path d="M7.5 9.5c0-.8.7-1.2 1.3-1.2.7 0 1.2.5 1.2 1.1 0 .9-1.2 1-1.2 1.9" /><path d="M8.8 13.2h.01" /></>,
};

export const Icon: React.FC<{ name: IconName; className?: string }> = ({ name, className }) => (
  <svg
    className={className ? `icon ${className}` : 'icon'}
    viewBox="0 0 18 18"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {ICON_PATHS[name]}
  </svg>
);

export const AppMark: React.FC = () => (
  <svg className="app-mark" viewBox="0 0 128 128" aria-hidden="true">
    <rect width="128" height="128" rx="30" fill="currentColor" />
    <ellipse className="app-mark-orbit app-mark-orbit-primary" cx="64" cy="64" rx="47" ry="27" transform="rotate(-24 64 64)" />
    <ellipse className="app-mark-orbit app-mark-orbit-secondary" cx="64" cy="64" rx="27" ry="48" transform="rotate(31 64 64)" />
    <path className="app-mark-arc" d="M23 74c13 24 48 34 75 16" />
    <path className="app-mark-monogram" d="M36 42h12v17h12V42h12v44H60V70H48v16H36V42Zm43 0h12v17h9V42h12v44h-12V70h-9v16H79V42Z" />
    <circle className="app-mark-satellite" cx="104" cy="38" r="7" />
    <circle className="app-mark-node" cx="25" cy="73" r="3.5" />
    <circle className="app-mark-star" cx="91" cy="23" r="2.5" />
  </svg>
);
