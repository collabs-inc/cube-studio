// The Cube mark: its exact outline (from www public/favicon.svg, units, y down, outer loop then inner
// rhombus), the construction geometry the brand reel drafts it from, and an SVG builder.
// Shared so pieces stop copying the path around.
import { h } from '/engine/lib.js';

export const MARK_D = 'M0.0000 -0.7311L0.0291 -0.7292L0.0581 -0.7236L0.0870 -0.7146L0.1186 -0.7018L0.1527 -0.6853L0.1919 -0.6643L0.3536 -0.5715L0.5147 -0.4779L0.5518 -0.4548L0.5798 -0.4355L0.6018 -0.4173L0.6170 -0.4008L0.6222 -0.3931L0.6264 -0.3847L0.6290 -0.3764L0.6300 -0.3674L0.6300 0.3674L0.6290 0.3764L0.6264 0.3847L0.6222 0.3931L0.6170 0.4008L0.6018 0.4173L0.5798 0.4355L0.5518 0.4548L0.5147 0.4779L0.3536 0.5715L0.1919 0.6643L0.1527 0.6853L0.1186 0.7018L0.0870 0.7146L0.0581 0.7236L0.0291 0.7292L0.0000 0.7311L-0.0291 0.7292L-0.0581 0.7236L-0.0870 0.7146L-0.1186 0.7018L-0.1527 0.6853L-0.1919 0.6643L-0.3536 0.5715L-0.5147 0.4779L-0.5518 0.4548L-0.5798 0.4355L-0.6018 0.4173L-0.6170 0.4008L-0.6222 0.3931L-0.6264 0.3847L-0.6290 0.3764L-0.6300 0.3674L-0.6300 -0.3674L-0.6290 -0.3764L-0.6264 -0.3847L-0.6222 -0.3931L-0.6170 -0.4008L-0.6018 -0.4173L-0.5798 -0.4355L-0.5518 -0.4548L-0.5147 -0.4779L-0.3536 -0.5715L-0.1919 -0.6643L-0.1527 -0.6853L-0.1186 -0.7018L-0.0870 -0.7146L-0.0581 -0.7236L-0.0291 -0.7292Z M0.0000 0.0842L0.0227 0.0858L0.0453 0.0901L0.0678 0.0971L0.0924 0.1071L0.1189 0.1199L0.1494 0.1363L0.2753 0.2085L0.4008 0.2814L0.4296 0.2994L0.4514 0.3144L0.4685 0.3286L0.4804 0.3415L0.4845 0.3474L0.4877 0.3539L0.4897 0.3604L0.4905 0.3674L0.4897 0.3744L0.4877 0.3809L0.4845 0.3874L0.4804 0.3934L0.4685 0.4063L0.4514 0.4204L0.4296 0.4355L0.4008 0.4534L0.2753 0.5263L0.1494 0.5985L0.1189 0.6149L0.0924 0.6278L0.0678 0.6378L0.0453 0.6447L0.0227 0.6491L0.0000 0.6506L-0.0227 0.6491L-0.0453 0.6447L-0.0678 0.6378L-0.0924 0.6278L-0.1189 0.6149L-0.1494 0.5985L-0.2753 0.5263L-0.4008 0.4534L-0.4296 0.4355L-0.4514 0.4204L-0.4685 0.4063L-0.4804 0.3934L-0.4845 0.3874L-0.4877 0.3809L-0.4897 0.3744L-0.4905 0.3674L-0.4897 0.3604L-0.4877 0.3539L-0.4845 0.3474L-0.4804 0.3415L-0.4685 0.3286L-0.4514 0.3144L-0.4296 0.2994L-0.4008 0.2814L-0.2753 0.2085L-0.1494 0.1363L-0.1189 0.1199L-0.0924 0.1071L-0.0678 0.0971L-0.0453 0.0901L-0.0227 0.0858Z';

// Construction geometry (units of MARK_D): the rounded outline and its sharp hexagon, the inner rhombus.
export const MARK = {
  top: 0.7311, side: 0.63, shoulder: 0.3674,
  sharpTop: 0.7757, sharpShoulder: 0.4119,
  rho: { top: 0.0842, mid: 0.3674, bot: 0.6506, half: 0.4905 },
  rhoSharp: { top: 0.0495, bot: 0.6853, half: 0.5505 },
};
// Prism elevation at which the 3D cube's silhouette matches the flat mark.
export const ISO_EL = -35.2644;
// The mark's SVG viewBox half-extent: an <svg> of 2 × MARK_HALF × size px centres the mark at size px per unit.
export const MARK_HALF = 0.9066;

// The outer and inner loops as point arrays, for drafting, tracing and morphing.
export const MARK_LOOPS = MARK_D.split('M').filter(Boolean)
  .map(s => s.replace('Z', '').trim().split('L').map(p => p.trim().split(/\s+/).map(Number)));

// <svg> of the mark in one fill. Size it with width/height = 2 × MARK_HALF × px-per-unit.
export const markSVG = (fill, attrs = {}) =>
  h('svg', { viewBox: `${-MARK_HALF} ${-MARK_HALF} ${2 * MARK_HALF} ${2 * MARK_HALF}`, ...attrs },
    h('path', { d: MARK_D, fill, 'fill-rule': 'evenodd' }));
