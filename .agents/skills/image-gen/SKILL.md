---
name: image-gen
description: Generate images via OpenAI GPT Image 2 (default) or Gemini 3 Pro Image (Nano Banana Pro). Use when the user asks to create, generate, or make an image. Switchable provider so outputs can be A/B'd. Read references/prompting.md and references/styles.md before writing the prompt.
---

# Image generation (OpenAI / Gemini)

Default provider: **OpenAI GPT Image 2** (`gpt-image-2`). Gemini Pro is on tap for text-rendering, infographics, and higher-resolution work.

## Workflow

1. Confirm the relevant key is set:
   - OpenAI: `OPENAI_API_KEY`
   - Gemini: `GEMINI_API_KEY`
2. Before writing the prompt, read **`references/prompting.md`** for the structural template and **`references/styles.md`** for the right vocabulary. Pick a style stack instead of stacking adjectives.
3. Generate:
   ```bash
   python scripts/generate_image.py \
     --prompt "your prompt" \
     --output ./out.png \
     --size 1536x1024 --quality high
   ```
4. To switch providers: `--provider gemini` (or set `IMAGE_PROVIDER=gemini` once for the session). See `references/examples.md` for tested A/B blocks.
5. The script auto-renames the output extension to match the response mime (Gemini often returns JPEG even when you asked for `.png`).

## When to pick which provider

| Need | Provider | Why |
|---|---|---|
| General photo, portrait, lifestyle | OpenAI | Cleaner foreground bokeh, faster at low quality, cheap iteration |
| Text inside the image (logos, labels, infographics, posters) | Gemini | Best-in-class typography rendering |
| 2K / 4K hero assets | Gemini | Flat $0.134 (1K/2K) or $0.24 (4K); OpenAI bills per output token so big sizes get expensive |
| Reference-image consistency (character sheets, multi-shot) | Gemini | Up to 6 reference images, built-in thinking step |
| Transparent background | OpenAI | …but note: gpt-image-2 does **not** support transparent yet. Use Imagen-class models if you need it |
| Drafts at $0.01 each | OpenAI low quality 1024² | Cheapest path for composition iteration |

## Args

**Common**
- `--prompt` (required): image description.
- `--output` (required): file path; parent dirs auto-created; extension auto-corrected to mime.
- `--provider {openai,gemini}`: defaults to `$IMAGE_PROVIDER` then `openai`.

**OpenAI**
- `--size`: `1024x1024`, `1536x1024`, `1024x1536`, `2048x1152`, `2160x3840`, `3840x2160`, `auto`. Edges multiple of 16; max long-to-short 3:1.
- `--quality`: `low | medium | high | auto`.
- `--background`: `opaque | auto` (transparent unsupported on gpt-image-2).

**Gemini**
- `--config '{"aspectRatio":"16:9","imageSize":"2K"}'`
- Aspect ratios: `1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9`
- Image sizes: `1K, 2K, 4K`

## Cost reference

- OpenAI gpt-image-2: token-based ($30/M output tokens). Empirically: low 1024² ≈ $0.01, high 1536×1024 ≈ $0.06–0.17.
- Gemini Pro: flat $0.134 for 1K/2K, $0.24 for 4K. Half-price on Batch/Flex if not time-sensitive.

## A/B compare

```bash
PROMPT="…"
python scripts/generate_image.py --provider openai --prompt "$PROMPT" --output ./out/openai.png --size 1536x1024 --quality high
python scripts/generate_image.py --provider gemini --prompt "$PROMPT" --output ./out/gemini.jpg --config '{"aspectRatio":"16:9","imageSize":"2K"}'
```

## References

- `references/prompting.md` — prompt construction template, provider-specific notes, anti-patterns.
- `references/styles.md` — named styles and their vocabulary (photoreal, cinematic, illustration, anime, 3D, product, infographic, painterly, vintage).
- `references/examples.md` — copy-paste-ready prompts per use case, with the `generate_image.py` invocation.
- `references/api.md` — endpoint, request shape, response handling.
