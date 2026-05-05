# Prompting

Good prompts are concrete narratives, not bag-of-keywords lists. Both OpenAI and Gemini reward sentences that describe a scene the way a director or photographer would brief a crew.

## The order that works

OpenAI's official guide recommends this sequence:

1. **Scene / background** — where we are, what surrounds the subject.
2. **Subject** — the primary focus.
3. **Key details** — materials, textures, proportions, distinguishing features.
4. **Constraints** — what to preserve, exclude, or hold consistent across edits.
5. **Intended use** — "for an ad", "for a UI mock", "for a children's book". This sets the model's "mode" and level of polish.

Then layer in:

- **Composition / framing** — wide shot, macro, low-angle, over-the-shoulder, three-quarter portrait.
- **Lighting / mood** — golden hour, soft diffused, hard noir, rim light, three-point softbox.
- **Visual medium** — photograph, watercolor, 3D render, gouache, oil painting.
- **Style cues** — palette, grain, brushwork, sharpness, era.
- **Typography** — exact text in quotes, font style, placement.

## A reusable template

```
A [SCENE] with [SUBJECT] [doing ACTION].
[KEY DETAILS — 2–4 specific noun phrases].
Composition: [FRAMING + CAMERA].
Lighting: [LIGHT TYPE + MOOD].
Style: [MEDIUM + AESTHETIC + ERA/REFERENCE].
[INTENDED USE — e.g. "for a magazine cover", "as a hero image"].
```

Drop sections you don't need, but keep the order.

## Provider-specific notes

### OpenAI gpt-image-2

- Strong at text rendering — use straight quotes for any literal text, e.g. `labeled "Relax & Unwind"`.
- Honors size + quality directly: `--size 1536x1024 --quality high` for finals; `--quality low` for thumbnails and iteration.
- Accepts the `revised_prompt` field via the Responses API — read it back if you want to learn how the model interprets your prompt.
- Cannot do transparent backgrounds (`background: "transparent"` is rejected).
- Complex prompts can take up to ~2 minutes at high quality.

### Gemini 3 Pro Image (Nano Banana Pro)

- "Describe the scene, don't list keywords." Narrative paragraphs outperform comma-strings.
- Built-in thinking step refines composition before render — give it room with full sentences.
- Best in class for text rendering inside images: logos, infographics, menus, marketing posters, product mockups.
- Up to 6 character/object reference images; great consistency across multi-shot sequences.
- Prefer cinematic photography vocabulary: "wide-angle shot", "macro shot", "softbox setup", "shallow depth of field".

## Iteration loop

1. Start at low quality / 1K to converge on composition cheaply (`--quality low` or 1K).
2. Once the layout is right, regenerate at high quality / 2K for the final.
3. Keep the prompt in a file alongside the output (this skill writes prompts to `prompt.txt` next to images by convention) so you can A/B fairly when you swap providers.

## Anti-patterns

- Bag of adjectives with no subject (`"cinematic, moody, atmospheric, beautiful"`) — model has nothing to anchor on.
- Conflicting style cues (`"photorealistic anime watercolor 3D render"`) — the model averages them and you get mush.
- Negative-only prompts (`"no people, no text"`) — gpt-image and Gemini do not have a true negative-prompt channel; describe what *should* be there instead.
- Over-stuffed single sentences with 30 commas. Break into the template above.
