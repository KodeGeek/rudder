/* Rudder — icon set. Consistent 24px viewBox, 1.7 stroke, currentColor. */
import React from "react";

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
  sw?: number;
}

export type IconFn = (p?: IconProps) => React.ReactElement;

const Ic = (paths: React.ReactNode, props: IconProps = {}): React.ReactElement => {
  const { size = 18, sw = 1.7, style, ...rest } = props;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, ...(style || {}) }}
      {...rest}
    >
      {paths}
    </svg>
  );
};

export const Icons: Record<string, IconFn> = {
  grid: (p) => Ic(<><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>, p),
  jobs: (p) => Ic(<><path d="M4 6h16M4 12h16M4 18h10"/><circle cx="19" cy="18" r="2" fill="currentColor" stroke="none"/></>, p),
  clock: (p) => Ic(<><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></>, p),
  activity: (p) => Ic(<path d="M3 12h3.5l2.2-6 4 14 2.6-8H21"/>, p),
  server: (p) => Ic(<><rect x="3" y="4" width="18" height="7" rx="1.6"/><rect x="3" y="13" width="18" height="7" rx="1.6"/><path d="M7 7.5h.01M7 16.5h.01"/></>, p),
  settings: (p) => Ic(<><circle cx="12" cy="12" r="3"/><path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6M18.4 18.4l-1.6-1.6M7.2 7.2 5.6 5.6"/></>, p),
  git: (p) => Ic(<><circle cx="6" cy="6" r="2.4"/><circle cx="6" cy="18" r="2.4"/><circle cx="18" cy="9" r="2.4"/><path d="M6 8.4v7.2M8.2 7.3c5 1 5 1.2 8 1.7M18 11.4c0 4-4.4 3.4-12 3.4"/></>, p),
  play: (p) => Ic(<path d="M7 5.5l11 6.5-11 6.5z" fill="currentColor" stroke="none"/>, p),
  refresh: (p) => Ic(<><path d="M20 11a8 8 0 1 0-.9 4.5"/><path d="M20 5v6h-6"/></>, p),
  check: (p) => Ic(<path d="M5 12.5l4.2 4.2L19 7"/>, p),
  x: (p) => Ic(<path d="M6 6l12 12M18 6 6 18"/>, p),
  alert: (p) => Ic(<><path d="M12 8.5v4.2M12 16h.01"/><path d="M10.3 3.8 2.7 17a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0z"/></>, p),
  chevR: (p) => Ic(<path d="M9 5l7 7-7 7"/>, p),
  chevD: (p) => Ic(<path d="M5 9l7 7 7-7"/>, p),
  chevL: (p) => Ic(<path d="M15 5l-7 7 7 7"/>, p),
  ext: (p) => Ic(<><path d="M14 5h5v5"/><path d="M19 5l-8 8"/><path d="M18 13.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4.5"/></>, p),
  search: (p) => Ic(<><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-3.8-3.8"/></>, p),
  filter: (p) => Ic(<path d="M3 5h18l-7 8v5l-4 2v-7L3 5z"/>, p),
  plus: (p) => Ic(<path d="M12 5v14M5 12h14"/>, p),
  pause: (p) => Ic(<><rect x="7" y="5" width="3.4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.6" y="5" width="3.4" height="14" rx="1" fill="currentColor" stroke="none"/></>, p),
  doc: (p) => Ic(<><path d="M6 2.5h8l4 4V21a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z"/><path d="M13.5 2.5V7h4.5"/></>, p),
  branch: (p) => Ic(<><circle cx="7" cy="5" r="2.2"/><circle cx="7" cy="19" r="2.2"/><circle cx="17" cy="8" r="2.2"/><path d="M7 7.2v9.6M17 10.2c0 4-3 4.8-10 4.8"/></>, p),
  commit: (p) => Ic(<><circle cx="12" cy="12" r="3.2"/><path d="M2 12h6.8M15.2 12H22"/></>, p),
  bell: (p) => Ic(<><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6z"/><path d="M10.5 20a2 2 0 0 0 3 0"/></>, p),
  key: (p) => Ic(<><circle cx="8" cy="8" r="4"/><path d="M11 11l8 8M16 16l2-2M14 18l1.5 1.5"/></>, p),
  drift: (p) => Ic(<><path d="M4 7h9M4 12h6M4 17h11"/><path d="M16 5l4 4-4 4"/></>, p),
  terminal: (p) => Ic(<><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M13 15h4"/></>, p),
  dot: (p) => Ic(<circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>, p),
  bolt: (p) => Ic(<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" fill="currentColor" stroke="none"/>, p),
  link: (p) => Ic(<><path d="M9.5 14.5l5-5"/><path d="M8 11l-2 2a3.5 3.5 0 0 0 5 5l2-2M16 13l2-2a3.5 3.5 0 0 0-5-5l-2 2"/></>, p),
  copy: (p) => Ic(<><rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M4.5 15.5h-1a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></>, p),
  sun: (p) => Ic(<><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/></>, p),
  moon: (p) => Ic(<path d="M20 14.5A8 8 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z"/>, p),
  history: (p) => Ic(<><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3 9"/><path d="M3 4v5h5"/><path d="M12 8v4.5l3 1.8"/></>, p),
  host: (p) => Ic(<><rect x="4" y="4" width="16" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></>, p),
  github: (p) => Ic(<path d="M12 2C6.5 2 2 6.6 2 12.2c0 4.5 2.9 8.3 6.8 9.6.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.7.4-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.3 9.3 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5A10 10 0 0 0 22 12.2C22 6.6 17.5 2 12 2z" fill="currentColor" stroke="none"/>, p),
  azure: (p) => Ic(<path d="M12 2.5 4 18l4.5 3.5 9-3-2.4-2.6-4.7 1 4.3-9.8L12 2.5z" fill="currentColor" stroke="none"/>, p),
};
