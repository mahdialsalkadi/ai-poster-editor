import type { ReactNode } from 'react';

export type IconName =
  | 'templates'
  | 'elements'
  | 'text'
  | 'uploads'
  | 'layers'
  | 'sparkles'
  | 'user'
  | 'undo'
  | 'redo'
  | 'save'
  | 'download'
  | 'copy'
  | 'import'
  | 'eye'
  | 'eyeOff'
  | 'lock'
  | 'unlock'
  | 'trash'
  | 'duplicate'
  | 'front'
  | 'forward'
  | 'back'
  | 'backward'
  | 'up'
  | 'down'
  | 'plus'
  | 'minus'
  | 'close'
  | 'check'
  | 'chevronDown'
  | 'alignLeft'
  | 'alignCenter'
  | 'alignRight'
  | 'alignJustify'
  | 'alignTop'
  | 'alignMiddle'
  | 'alignBottom'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'rotate'
  | 'grid'
  | 'fit'
  | 'image'
  | 'shape'
  | 'textLayer'
  | 'svgLayer'
  | 'warning'
  | 'play'
  | 'zoomIn'
  | 'zoomOut'
  | 'panel'
  | 'more';

const PATHS: Record<IconName, ReactNode> = {
  templates: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  elements: (
    <>
      <circle cx="8.5" cy="8.5" r="4.5" />
      <rect x="12.5" y="12.5" width="8" height="8" rx="2" />
    </>
  ),
  text: (
    <>
      <path d="M5 6.5V4.5h14v2" />
      <path d="M12 4.5v15" />
      <path d="M9 19.5h6" />
    </>
  ),
  uploads: (
    <>
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12 9 5 9-5" />
      <path d="m3 16 9 5 9-5" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 3.5 13.7 9l5.3 1.7-5.3 1.7L12 18l-1.7-5.6L5 10.7 10.3 9 12 3.5Z" />
      <path d="m18.5 15 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20c.8-3.5 3.5-5.5 7-5.5s6.2 2 7 5.5" />
    </>
  ),
  undo: (
    <>
      <path d="m9 7-5 5 5 5" />
      <path d="M4 12h9a6 6 0 0 1 6 6v1" />
    </>
  ),
  redo: (
    <>
      <path d="m15 7 5 5-5 5" />
      <path d="M20 12h-9a6 6 0 0 0-6 6v1" />
    </>
  ),
  save: (
    <>
      <path d="M5 3.5h11l3 3v14H5v-17Z" />
      <path d="M8 3.5v6h7v-6" />
      <rect x="8" y="13" width="8" height="5" rx="1" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M4 20h16" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a1 1 0 0 1 1-1h10" />
    </>
  ),
  import: (
    <>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M4 20h16" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M4.5 5.5 19.5 18.5" />
      <path d="M9.4 7.1A10.4 10.4 0 0 1 12 6.5c6 0 9.5 5.5 9.5 5.5a17 17 0 0 1-2.4 3" />
      <path d="M6.2 8.6A17 17 0 0 0 2.5 12S6 17.5 12 17.5a9.8 9.8 0 0 0 3.1-.5" />
      <path d="M10.3 10.3a2.6 2.6 0 0 0 3.4 3.4" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </>
  ),
  unlock: (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 7-2.6" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="m6 7 1 13h10l1-13" />
      <path d="M10 11v5M14 11v5" />
    </>
  ),
  duplicate: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
      <path d="M14 12v4M12 14h4" />
    </>
  ),
  front: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </>
  ),
  forward: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
      <path d="M14 17v-6M11 14l3-3 3 3" />
    </>
  ),
  back: (
    <>
      <rect x="4" y="4" width="12" height="12" rx="2" />
      <path d="M8 16v2a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-2" />
    </>
  ),
  backward: (
    <>
      <rect x="4" y="4" width="12" height="12" rx="2" />
      <path d="M8 16v2a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-2" />
      <path d="M10 11v6M7 14l3 3 3-3" />
    </>
  ),
  up: <path d="m6 14 6-6 6 6" />,
  down: <path d="m6 10 6 6 6-6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  check: <path d="m5 12 5 5L19 7" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  alignLeft: <path d="M4 6h16M4 10h10M4 14h16M4 18h10" />,
  alignCenter: <path d="M4 6h16M7 10h10M4 14h16M7 18h10" />,
  alignRight: <path d="M4 6h16M10 10h10M4 14h16M10 18h10" />,
  alignJustify: <path d="M4 6h16M4 10h16M4 14h16M4 18h16" />,
  alignTop: (
    <>
      <path d="M4 4h16" />
      <path d="M7 8v8M12 8v12M17 8v5" />
    </>
  ),
  alignMiddle: (
    <>
      <path d="M4 12h16" />
      <path d="M7 7v3M7 14v3M12 5v4M12 15v4M17 8v2M17 14v2" />
    </>
  ),
  alignBottom: (
    <>
      <path d="M4 20h16" />
      <path d="M7 8v8M12 4v12M17 11v5" />
    </>
  ),
  bold: (
    <>
      <path d="M7 4h6a4 4 0 0 1 0 8H7V4Z" />
      <path d="M7 12h7a4 4 0 0 1 0 8H7v-8Z" />
    </>
  ),
  italic: <path d="M10 4h8M6 20h8M14.5 4 9.5 20" />,
  underline: (
    <>
      <path d="M7 4v6a5 5 0 0 0 10 0V4" />
      <path d="M5 20h14" />
    </>
  ),
  rotate: (
    <>
      <path d="M20 12a8 8 0 1 1-2.4-5.7" />
      <path d="M20 4v5h-5" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M4 10h16M10 4v16" />
    </>
  ),
  fit: <path d="M9 4H4v5M15 4h5v5M20 15v5h-5M4 15v5h5" />,
  image: (
    <>
      <rect x="3.5" y="4" width="17" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="m4.5 18 5-5 4 4 3-3 4 4" />
    </>
  ),
  shape: (
    <>
      <rect x="4" y="4" width="10" height="10" rx="2" />
      <circle cx="16" cy="16" r="5" />
    </>
  ),
  textLayer: (
    <>
      <path d="M5 6.5V4.5h14v2" />
      <path d="M12 4.5v15" />
      <path d="M9 19.5h6" />
    </>
  ),
  svgLayer: (
    <>
      <path d="M4 20 20 4" />
      <circle cx="7" cy="7" r="3" />
      <rect x="14" y="14" width="6" height="6" rx="1" />
    </>
  ),
  warning: (
    <>
      <path d="M12 3.5 21 20H3L12 3.5Z" />
      <path d="M12 9v5" />
      <path d="M12 17.2v.1" />
    </>
  ),
  play: <path d="M8 5v14l11-7Z" fill="currentColor" stroke="none" />,
  zoomIn: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 4.5 4.5" />
      <path d="M10.5 7.5v6M7.5 10.5h6" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 4.5 4.5" />
      <path d="M7.5 10.5h6" />
    </>
  ),
  panel: (
    <>
      <rect x="3.5" y="4" width="17" height="16" rx="2" />
      <path d="M14 4v16" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
};

export function Icon({
  name,
  size = 20,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
