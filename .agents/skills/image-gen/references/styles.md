# Style cheat sheet

Reach for these named styles + their supporting vocabulary instead of vague adjectives. Mix at most two compatible styles per prompt.

## Photorealistic

**Key phrase:** `photorealistic` (use the word — it strongly engages the photo path of the model).

**Camera vocabulary:**
- Lens: `35mm`, `50mm`, `85mm portrait lens`, `macro lens`, `wide-angle 24mm`, `telephoto 200mm`.
- Body / film: `medium-format`, `Kodak Portra 400 film stock`, `Fujifilm Velvia`, `Cinestill 800T`.
- Aperture / DOF: `shallow depth of field`, `f/1.8 bokeh`, `everything in focus`, `tilt-shift`.
- Framing: `eye-level shot`, `low-angle`, `bird's-eye`, `over-the-shoulder`, `three-quarter`.

**Light:** `golden hour`, `blue hour`, `harsh midday sun`, `soft diffused window light`, `three-point softbox setup`, `single rim light`, `hard chiaroscuro`.

**Realism boosters:** `candid`, `unposed`, `subtle film grain`, `natural skin texture`, `imperfect framing`.

## Cinematic / film still

Sells "frame from a movie", not a real photograph.

**Vocabulary:** `cinematic still`, `35mm anamorphic`, `2.39:1 letterbox`, `teal-and-orange grade`, `Roger Deakins lighting`, `Wes Anderson symmetry`, `Blade Runner neon haze`, `David Fincher cool palette`.

**Pair with:** explicit aspect ratio. Use `--config '{"aspectRatio":"21:9"}'` (Gemini) or `--size 2048x1152` (OpenAI) for true widescreen.

## Editorial / magazine

**Vocabulary:** `magazine cover quality`, `Vogue editorial`, `National Geographic photojournalism`, `monochrome fashion editorial`, `Wallpaper magazine product shot`.

**Note:** Gemini will sometimes literally render a magazine masthead overlay. If you don't want the overlay, drop the word "cover" and say `magazine-quality editorial photo`.

## Illustration

| Sub-style | Vocabulary |
|---|---|
| Children's book | `watercolor children's book illustration`, `soft outlines`, `whimsical proportions`, `warm earthy palette` |
| Storybook gouache | `gouache painting`, `hand-painted`, `flat color blocks`, `Mary Blair palette` |
| Studio Ghibli vibe | `painterly watercolor animation style`, `soft natural lighting`, `hand-drawn backgrounds` (avoid the literal "Ghibli" or "Miyazaki" — often filtered) |
| Comic / graphic novel | `inked line art`, `cel-shaded`, `halftone shading`, `Mike Mignola high-contrast` |
| Vector / flat | `flat design`, `bold geometric shapes`, `minimal palette`, `Dribbble-style illustration` |

## Anime

**Important keywords:** `masterpiece`, `best quality`, `highly detailed` — these are near-mandatory tokens for the anime mode.

**Sub-genres:**
- Shonen action: `dynamic action pose`, `speed lines`, `bold ink outlines`.
- Shoujo: `soft pastel palette`, `sparkling highlights`, `dreamy bokeh`.
- Chibi: `chibi proportions`, `kawaii`, `oversized head`, `simplified features`.
- Seinen: `mature realistic anime`, `cinematic atmosphere`, `gritty lighting`.
- Mecha: `intricate mechanical detail`, `panel-lined armor`, `industrial palette`.
- Cyberpunk: `neon-soaked`, `rain-slick streets`, `holographic signage`, `Akira-inspired`.
- Retro 90s: `cel-animated`, `broadcast-quality 90s anime`, `analog film grain`.

## 3D render / CGI

**Vocabulary:** `Octane render`, `Cinema 4D`, `Blender Cycles`, `subsurface scattering`, `physically-based materials`, `studio HDRI lighting`, `clay render`, `isometric 3D`.

## Product / brand

**Vocabulary:** `premium`, `studio lighting`, `clean silhouette`, `high-end retail`, `seamless white background`, `45-degree shot`, `softbox three-point lighting`, `reflection on glossy floor`.

**Tip:** Always specify background: `seamless white`, `gradient grey`, `colored paper backdrop`, `lifestyle environment`.

## Infographic / diagram

**Vocabulary:** `clean classroom handout`, `minimal decoration`, `flat design`, `labeled diagram`, `technical illustration`, `exploded view`, `wireframe`, `cutaway`.

**Use Gemini Pro** for these — it nails text rendering far better than OpenAI for labels and callouts.

## Painterly / fine art

**Vocabulary:**
- Oil: `oil on canvas`, `thick impasto`, `chiaroscuro`, `Caravaggio lighting`.
- Watercolor: `wet-on-wet watercolor`, `pigment bloom`, `paper texture`.
- Ink: `sumi-e ink wash`, `dry brush`, `negative space composition`.
- Concept art: `concept art`, `matte painting`, `digital painting`, `ArtStation trending`.

## Vintage / retro

**Vocabulary:** `1970s polaroid`, `expired film stock`, `daguerreotype`, `Victorian engraving`, `Art Deco poster`, `mid-century modern illustration`, `vaporwave palette`.

## Texture / surface

Add to any of the above for tactile realism:
- `worn velvet`, `polished marble`, `brushed brass`, `frosted glass`, `cracked leather`, `hammered copper`, `rough hessian`, `iridescent oil-on-water`.

## Color / palette

- `monochrome`, `duotone teal-and-orange`, `pastel palette`, `earthy tones`, `high-contrast B&W`, `desaturated muted palette`, `acidic neon palette`.

## Mood / atmosphere

- `serene`, `melancholic`, `ominous`, `playful`, `nostalgic`, `dreamlike`, `oppressive`, `triumphant`.

## Style stacks that work

- **Editorial portrait:** `photorealistic + 85mm portrait + soft natural window light + Kodak Portra 400 + magazine-quality editorial photo`.
- **Cinematic landscape:** `cinematic still + 35mm anamorphic + golden hour + atmospheric haze + 21:9`.
- **Storybook character:** `watercolor children's book illustration + soft outlines + warm earthy palette + whimsical proportions`.
- **Brand product:** `studio lighting + 45-degree shot + softbox three-point setup + seamless white background + high-end retail`.
- **Cyberpunk poster:** `cinematic still + neon-soaked + rain-slick streets + teal-and-orange grade + 21:9 + Blade Runner inspired`.
