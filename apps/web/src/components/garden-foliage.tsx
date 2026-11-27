/**
 * Decorative foliage bed behind every Garden screen: a hand-drawn bed of
 * moss-ink stems rising from the viewport bottom. Several stems carry small
 * 8-pointed star flowers — an echo of Garden's original asterisk mark (the brand mark itself is now the leaf in
 * packages/ui/components/common/brand-icon.tsx).
 *
 * Composition note: the auth panel is ~24rem wide and centered, covering
 * roughly x 400–800 in this 1200-unit viewBox. The vellum surface is nearly
 * opaque, so nothing tall lives in that band — two tall "gatepost" stems
 * (x≈362 / x≈828) flank the panel with their blooms in open parchment, and
 * only short growth tucks under the panel's bottom edge.
 *
 * Weight: pure inline SVG (~2KB), no images or extra fonts. Stems draw
 * themselves in once on load via pathLength/stroke-dashoffset (classes
 * `.foliage-stem`, `.foliage-leaf`, `.foliage-bloom` in custom.css, with a
 * prefers-reduced-motion guard that renders everything statically).
 *
 * Color rides `currentColor` — the wrapper sets `text-brand` (moss in light
 * mode, sage in dark), so theming is automatic.
 */
function GardenFoliage({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 1200 340"
      preserveAspectRatio="xMidYMax meet"
      fill="none"
    >
      {/* Tall stem, far left */}
      <g style={{ '--d': '0s' } as React.CSSProperties}>
        <path
          className="foliage-stem"
          pathLength={1}
          d="M70 340 C62 282 85 232 72 178 C66 154 76 140 72 126"
          strokeOpacity="0.42"
        />
        <path
          className="foliage-leaf"
          d="M72 248 c15 -3 25 -13 27 -26 c-15 3 -25 13 -27 26 Z"
        />
        <path
          className="foliage-leaf"
          d="M70 206 c-15 -3 -25 -13 -27 -26 c15 3 25 13 27 26 Z"
        />
      </g>

      {/* Short arc with bloom */}
      <g style={{ '--d': '0.18s' } as React.CSSProperties}>
        <path
          className="foliage-stem"
          pathLength={1}
          d="M158 340 C150 310 166 282 160 254"
          strokeOpacity="0.34"
        />
        <g className="foliage-bloom" strokeOpacity="0.5">
          <path d="M160 234 v20 M150 244 h20 M153 237 l14 14 M167 237 l-14 14" />
        </g>
      </g>

      {/* Medium stem, leaf pair */}
      <g style={{ '--d': '0.3s' } as React.CSSProperties}>
        <path
          className="foliage-stem"
          pathLength={1}
          d="M290 340 C282 300 300 264 289 222 C285 208 292 199 289 190"
          strokeOpacity="0.38"
        />
        <path
          className="foliage-leaf"
          d="M290 266 c13 -2 22 -11 24 -23 c-13 2 -22 11 -24 23 Z"
        />
        <path
          className="foliage-leaf"
          d="M289 234 c-13 -2 -22 -11 -24 -23 c13 2 22 11 24 23 Z"
        />
      </g>

      {/* Left gatepost — tall stem with bloom, just left of the panel */}
      <g style={{ '--d': '0.24s' } as React.CSSProperties}>
        <path
          className="foliage-stem"
          pathLength={1}
          d="M362 340 C354 288 374 234 360 180 C354 156 364 140 361 124"
          strokeOpacity="0.42"
        />
        <path
          className="foliage-leaf"
          d="M360 240 c-14 -3 -24 -12 -26 -25 c14 3 24 12 26 25 Z"
        />
        <g className="foliage-bloom" strokeOpacity="0.52">
          <path d="M361 96 v24 M349 108 h24 M353 100 l17 17 M370 100 l-17 17" />
        </g>
      </g>

      {/* Short growth tucking under the panel's left corner */}
      <g style={{ '--d': '0.1s' } as React.CSSProperties}>
        <path
          className="foliage-stem"
          pathLength={1}
          d="M470 340 C464 318 478 298 472 278"
          strokeOpacity="0.28"
        />
      </g>

      {/* Short growth under the panel center */}
      <g style={{ '--d': '0.46s' } as React.CSSProperties}>
        <path
          className="foliage-stem"
          pathLength={1}
          d="M604 340 C598 320 610 304 605 288"
          strokeOpacity="0.26"
        />
      </g>

      {/* Short stem tucking under the panel's right corner */}
      <g style={{ '--d': '0.38s' } as React.CSSProperties}>
        <path
          className="foliage-stem"
          pathLength={1}
          d="M742 340 C736 316 750 296 744 274"
          strokeOpacity="0.28"
        />
        <path
          className="foliage-leaf"
          d="M744 298 c11 -2 19 -9 21 -20 c-11 2 -19 9 -21 20 Z"
        />
      </g>

      {/* Right gatepost — tall stem with bloom, just right of the panel */}
      <g style={{ '--d': '0.28s' } as React.CSSProperties}>
        <path
          className="foliage-stem"
          pathLength={1}
          d="M828 340 C818 282 840 218 824 158 C817 130 830 108 826 88"
          strokeOpacity="0.44"
        />
        <path
          className="foliage-leaf"
          d="M826 235 c14 -3 24 -12 26 -25 c-14 3 -24 12 -26 25 Z"
        />
        <path
          className="foliage-leaf"
          d="M825 190 c-14 -3 -24 -12 -26 -25 c14 3 24 12 26 25 Z"
        />
        <g className="foliage-bloom" strokeOpacity="0.52">
          <path d="M826 56 v28 M812 70 h28 M816 60 l20 20 M836 60 l-20 20" />
        </g>
      </g>

      {/* Medium stem, leaf pair */}
      <g style={{ '--d': '0.2s' } as React.CSSProperties}>
        <path
          className="foliage-stem"
          pathLength={1}
          d="M934 340 C925 302 945 268 932 228 C927 214 936 205 933 196"
          strokeOpacity="0.38"
        />
        <path
          className="foliage-leaf"
          d="M934 272 c13 -2 22 -11 24 -23 c-13 2 -22 11 -24 23 Z"
        />
        <path
          className="foliage-leaf"
          d="M933 240 c-13 -2 -22 -11 -24 -23 c13 2 22 11 24 23 Z"
        />
      </g>

      {/* Tall stem with bloom, far right */}
      <g style={{ '--d': '0.36s' } as React.CSSProperties}>
        <path
          className="foliage-stem"
          pathLength={1}
          d="M1082 340 C1074 288 1096 240 1082 190 C1075 168 1087 154 1084 142"
          strokeOpacity="0.42"
        />
        <path
          className="foliage-leaf"
          d="M1083 252 c-14 -3 -24 -12 -26 -25 c14 3 24 12 26 25 Z"
        />
        <g className="foliage-bloom" strokeOpacity="0.5">
          <path d="M1084 116 v24 M1072 128 h24 M1076 119 l17 17 M1093 119 l-17 17" />
        </g>
      </g>

      {/* Small grass arc, right edge */}
      <g style={{ '--d': '0.5s' } as React.CSSProperties}>
        <path
          className="foliage-stem"
          pathLength={1}
          d="M1162 340 C1156 320 1168 302 1162 284"
          strokeOpacity="0.26"
        />
      </g>
    </svg>
  )
}

/**
 * App-wide backdrop layer for the foliage bed. Mounted once in the root layout
 * (`routes/__root.tsx`), which stays mounted across client navigation, so the
 * growth plays once per full page load and then stays still while the user
 * moves between screens. `-z-10` keeps it behind all page content, above only
 * the body ground; surfaces with their own fill cover it, so text never sits
 * on top of stems. `pointer-events-none` keeps it out of hit testing.
 */
export function GardenBackdrop() {
  return (
    <div
      aria-hidden="true"
      data-testid="garden-backdrop"
      className="pointer-events-none fixed inset-x-0 bottom-0 -z-10 text-brand"
    >
      <GardenFoliage className="mx-auto block h-[clamp(180px,34vh,330px)] w-full max-w-6xl" />
    </div>
  )
}
