// Small line drawings, all on the same 20-unit grid and drawn with the current
// text colour. Channel glyphs are generic on purpose: no brand marks.

import type { ComponentChildren } from 'preact';
import type { ChannelType } from '../shared/channels';

function Glyph({ children, class: className }: { children: ComponentChildren; class?: string }) {
  return (
    <svg
      class={className ? `icon ${className}` : 'icon'}
      viewBox="0 0 20 20"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const CHANNEL_PATHS: Record<ChannelType, ComponentChildren> = {
  // An envelope.
  smtp: (
    <>
      <rect x="2.5" y="4.5" width="15" height="11" rx="1.5" />
      <path d="m3 6 7 5.5L17 6" />
    </>
  ),
  // An envelope in flight.
  resend: (
    <>
      <path d="M7.5 5.5h8.5a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H7.5" />
      <path d="m8 7 4.75 3.75L17 7.5M2.5 8h3M3.5 11h3M2.5 14h3" />
    </>
  ),
  // A paper plane.
  telegram: <path d="M17.5 3 2.5 9l5 2 1.5 5.5 3-3.5 3.5 2.5L17.5 3ZM7.5 11l6-4.5" />,
  // A speech bubble with someone typing.
  discord: (
    <>
      <path d="M4 4.5h12A1.5 1.5 0 0 1 17.5 6v7a1.5 1.5 0 0 1-1.5 1.5H9l-4 3v-3H4A1.5 1.5 0 0 1 2.5 13V6A1.5 1.5 0 0 1 4 4.5Z" />
      <path d="M7 9.5h.01M10 9.5h.01M13 9.5h.01" />
    </>
  ),
  // A channel hash.
  slack: <path d="M8 3 6.5 17M13.5 3 12 17M3.5 7.5h14M2.5 12.5h14" />,
  // Two links of a chain.
  webhook: (
    <>
      <path d="M8.5 11.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1" />
      <path d="M11.5 8.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1" />
    </>
  ),
};

export function ChannelIcon({ type, class: className }: { type: ChannelType; class?: string }) {
  return <Glyph class={className}>{CHANNEL_PATHS[type]}</Glyph>;
}

export const RepeatIcon = () => (
  <Glyph class="icon-small">
    <path d="M4 9a6 6 0 0 1 10.5-3.5L16 7M16 3.5V7h-3.5M16 11a6 6 0 0 1-10.5 3.5L4 13M4 16.5V13h3.5" />
  </Glyph>
);

export const SearchIcon = () => (
  <Glyph>
    <circle cx="9" cy="9" r="5.5" />
    <path d="m13 13 4 4" />
  </Glyph>
);

export const ChevronIcon = () => (
  <Glyph>
    <path d="m8 5 5 5-5 5" />
  </Glyph>
);

/** A person with a plus: making a new account. */
export const NewAccountIcon = () => (
  <Glyph>
    <circle cx="8" cy="6.5" r="3" />
    <path d="M2.5 16.5a5.5 5.5 0 0 1 9.6-3.6M15 11.5v5M12.5 14h5" />
  </Glyph>
);

export const InfoIcon = () => (
  <Glyph>
    <circle cx="10" cy="10" r="7.5" />
    <path d="M10 9.25v4.5M10 6.4v.2" />
  </Glyph>
);

export const CheckIcon = () => (
  <Glyph>
    <path d="m4.5 10.5 3.5 3.5 7.5-8" />
  </Glyph>
);

/** The mark next to the name: a clock face and three lines of a postmark. */
export const Postmark = () => (
  <svg class="postmark" viewBox="0 0 32 20" width="32" height="20" fill="none" aria-hidden="true" focusable="false">
    <circle class="postmark-ring" cx="10" cy="10" r="8" />
    <path class="postmark-ring" d="M10 5.5V10l3 2" />
    <path class="postmark-waves" d="M22 5.5h8M22 10h8M22 14.5h8" />
  </svg>
);

/**
 * The picture on the sign-in page: a postage stamp with a clock on it, and the
 * wavy lines of a cancellation running off its edge.
 */
export const StampArt = () => (
  <svg class="stamp" viewBox="0 0 220 170" fill="none" aria-hidden="true" focusable="false">
    <g class="stamp-waves">
      <path d="M118 44c9-7 18 7 27 0s18 7 27 0 18 7 27 0 18 7 21 3" />
      <path d="M118 62c9-7 18 7 27 0s18 7 27 0 18 7 27 0 18 7 21 3" />
      <path d="M118 80c9-7 18 7 27 0s18 7 27 0 18 7 27 0 18 7 21 3" />
      <path d="M118 98c9-7 18 7 27 0s18 7 27 0 18 7 27 0 18 7 21 3" />
    </g>
    <g transform="rotate(-6 80 85)">
      <rect class="stamp-paper" x="22" y="20" width="116" height="134" rx="2" />
      <rect class="stamp-perforation" x="22" y="20" width="116" height="134" rx="2" />
      <rect class="stamp-frame" x="34" y="32" width="92" height="110" />
      <circle class="stamp-clock" cx="80" cy="80" r="29" />
      <path class="stamp-clock" d="M80 60v20l13 9" />
      <path class="stamp-ticks" d="M80 54v4M80 102v4M54 80h4M102 80h4" />
      <path class="stamp-ticks" d="M46 126h68M58 134h44" />
    </g>
    <circle class="stamp-cancel" cx="150" cy="71" r="34" />
    <circle class="stamp-cancel" cx="150" cy="71" r="25" />
  </svg>
);
