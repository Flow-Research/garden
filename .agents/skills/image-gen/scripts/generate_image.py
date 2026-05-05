#!/usr/bin/env python3
"""Generate an image via Gemini 3 Pro Image (Nano Banana Pro) or OpenAI GPT Image 2.

Switchable via --provider {gemini,openai}. Defaults to $IMAGE_PROVIDER, then "gemini".
Auth: GEMINI_API_KEY / OPENAI_API_KEY env vars (set in shell).
"""

import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.request

GEMINI_MODEL = "gemini-3-pro-image-preview"  # Nano Banana Pro (Pro, not Lite/Flash)
GEMINI_ENDPOINT = (
    f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
)
OPENAI_MODEL = "gpt-image-2"  # GPT Image 2, released 2026-04-21
OPENAI_ENDPOINT = "https://api.openai.com/v1/images/generations"

EXT_BY_MIME = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


def fail(msg: str, code: int = 1) -> None:
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(code)


def post_json(url: str, headers: dict, body: dict, timeout: int = 180) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body_text = e.read().decode("utf-8", errors="replace")
        fail(f"HTTP {e.code} from {url}: {body_text}")
    except urllib.error.URLError as e:
        fail(f"network error: {e.reason}")
    return {}  # unreachable


def write_output(out_path: str, raw: bytes, mime_hint: str | None = None) -> str:
    if mime_hint:
        expected = EXT_BY_MIME.get(mime_hint)
        root, ext = os.path.splitext(out_path)
        if expected and ext.lower() != expected:
            new_path = root + expected
            print(
                f"note: response mime is {mime_hint}; renaming output to {new_path}.",
                file=sys.stderr,
            )
            out_path = new_path
    out_dir = os.path.dirname(os.path.abspath(out_path))
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(raw)
    return out_path


def gen_gemini(prompt: str, out_path: str, image_config: dict) -> None:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        fail("GEMINI_API_KEY not set in env.")

    body = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"],
            "imageConfig": image_config or {"aspectRatio": "1:1"},
        },
    }
    payload = post_json(GEMINI_ENDPOINT, {"x-goog-api-key": api_key}, body)

    candidates = payload.get("candidates") or []
    if not candidates:
        fail(f"no candidates: {json.dumps(payload)[:500]}")
    parts = candidates[0].get("content", {}).get("parts") or []
    image_part = next(
        (p for p in parts if "inlineData" in p or "inline_data" in p), None
    )
    if image_part is None:
        text_parts = [p.get("text", "") for p in parts if "text" in p]
        fail(f"no image in response. text: {' '.join(text_parts)[:500]}")
    inline = image_part.get("inlineData") or image_part.get("inline_data")
    mime = inline.get("mimeType") or inline.get("mime_type") or "image/png"
    data_b64 = inline.get("data")
    if not data_b64:
        fail("inline data missing 'data' field.")
    final_path = write_output(out_path, base64.b64decode(data_b64), mime_hint=mime)
    print(final_path)


def gen_openai(
    prompt: str,
    out_path: str,
    size: str | None,
    quality: str | None,
    background: str | None,
) -> None:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        fail("OPENAI_API_KEY not set in env.")

    body: dict = {
        "model": OPENAI_MODEL,
        "prompt": prompt,
        "n": 1,
    }
    if size:
        body["size"] = size
    if quality:
        body["quality"] = quality
    if background:
        body["background"] = background

    payload = post_json(
        OPENAI_ENDPOINT, {"Authorization": f"Bearer {api_key}"}, body
    )
    data_arr = payload.get("data") or []
    if not data_arr:
        fail(f"no data in response: {json.dumps(payload)[:500]}")
    item = data_arr[0]
    if "b64_json" in item and item["b64_json"]:
        final_path = write_output(out_path, base64.b64decode(item["b64_json"]))
    elif "url" in item and item["url"]:
        with urllib.request.urlopen(item["url"], timeout=60) as r:
            final_path = write_output(out_path, r.read())
    else:
        fail(f"no image data in item: {json.dumps(item)[:500]}")
    print(final_path)


def main() -> None:
    default_provider = os.environ.get("IMAGE_PROVIDER", "openai").lower()
    ap = argparse.ArgumentParser(description="Generate an image (Gemini Pro or OpenAI).")
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument(
        "--provider",
        choices=["gemini", "openai"],
        default=default_provider,
        help=f"Provider (default: {default_provider}; or set IMAGE_PROVIDER).",
    )
    # Gemini options
    ap.add_argument(
        "--config",
        default=None,
        help='Gemini imageConfig JSON, e.g. \'{"aspectRatio":"16:9","imageSize":"2K"}\'.',
    )
    # OpenAI options
    ap.add_argument("--size", default=None, help="OpenAI size, e.g. 1024x1024, 1536x1024, auto.")
    ap.add_argument(
        "--quality",
        default=None,
        choices=["low", "medium", "high", "auto"],
        help="OpenAI quality.",
    )
    ap.add_argument(
        "--background",
        default=None,
        choices=["transparent", "opaque", "auto"],
        help="OpenAI background.",
    )

    args = ap.parse_args()

    if args.provider == "gemini":
        cfg = json.loads(args.config) if args.config else None
        if cfg is not None and not isinstance(cfg, dict):
            fail("--config must be a JSON object.")
        gen_gemini(args.prompt, args.output, cfg or {})
    else:
        gen_openai(
            args.prompt, args.output, args.size, args.quality, args.background
        )


if __name__ == "__main__":
    main()
