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

export const HeaderPrint: React.FC = () => (
  <svg className="header-print" viewBox="0 0 1000 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true" fill="none">
    <g stroke="currentColor" strokeWidth="1">
      <ellipse cx="470" cy="120" rx="560" ry="105" transform="rotate(-12 470 120)" />
      <ellipse cx="470" cy="120" rx="480" ry="80" transform="rotate(-12 470 120)" />
      <ellipse cx="850" cy="50" rx="270" ry="150" transform="rotate(24 850 50)" />
      <path d="M-40 155C250 18 600 210 1040 5" />
    </g>
    <g fill="currentColor">
      <circle cx="215" cy="118" r="3" />
      <circle cx="640" cy="48" r="4" />
      <circle cx="894" cy="117" r="3" />
    </g>
  </svg>
);
