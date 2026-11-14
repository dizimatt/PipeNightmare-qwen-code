#!/usr/bin/env python3
"""The one place in this repo that talks to the image model.

Authoring time only — nothing here runs in the game, and the key is read from
the environment, never stored in a file.

Established by probing the gateway rather than guessing it: the OpenAI-style
`/compatible-mode/v1/images/generations` route 404s here, while the native
`multimodal-generation` route works. `size` is `'<width>*<height>'` with an area
between 512x512 and 2560x2560 pixels, `n` is 1..6, the answer is RGB with no
alpha, and it comes back as a signed URL that expires in about a day — so the
bytes are fetched immediately by this module.
"""

from __future__ import annotations

import base64
import io
import json
import os
import urllib.error
import urllib.request

from PIL import Image

ENDPOINT = "https://token-plan.maas.qwencloudapi.com/api/v1/services/aigc/multimodal-generation/generation"
MODEL = "qwen-image-3.0-pro"
KEY_ENV = "QWENCLOUD_TOKEN_PLAN_API_KEY"
MIN_AREA, MAX_AREA = 512 * 512, 2560 * 2560
NEGATIVE = ("text, watermark, logo, border, frame, drop shadow, extra objects, "
            "scenery, collage, gradient background")


def data_uri(img):
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def size_for(w, h, max_side=1024):
    """A size string for an image of this aspect, on a multiple of 8 and inside
    the API's area bounds."""
    scale = max_side / max(w, h)
    out_w = max(8, round(w * scale / 8) * 8)
    out_h = max(8, round(h * scale / 8) * 8)
    while out_w * out_h < MIN_AREA:          # the gateway refuses small areas
        out_w, out_h = out_w + 8, out_h + 8
    return f"{out_w}*{out_h}"


def generate(prompt, seed, size, image=None, negative=NEGATIVE, timeout=300):
    """One generation, one credit. Returns the PIL image it produced.

    Pass `image` to edit an existing picture instead of drawing from words; the
    model accepts up to three, which is how a reference keeps a set consistent.
    """
    key = os.environ.get(KEY_ENV)
    if not key:
        raise SystemExit(f"{KEY_ENV} is not set — export it first")

    content = [{"image": d if isinstance(d, str) else data_uri(d)}
               for d in ([] if image is None else
                         (image if isinstance(image, list) else [image]))]
    content.append({"text": prompt})
    body = {
        "model": MODEL,
        "input": {"messages": [{"role": "user", "content": content}]},
        "parameters": {"size": size, "n": 1, "seed": seed, "watermark": False,
                       "prompt_extend": False, "negative_prompt": negative},
    }
    req = urllib.request.Request(ENDPOINT, data=json.dumps(body).encode(), method="POST",
                                 headers={"Authorization": f"Bearer {key}",
                                          "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        raise SystemExit(f"HTTP {e.code} from {MODEL}: "
                         f"{e.read().decode('utf-8', 'replace')[:400]}")

    items = payload["output"]["choices"][0]["message"]["content"]
    url = next(item["image"] for item in items if "image" in item)
    with urllib.request.urlopen(url, timeout=120) as resp:
        return Image.open(io.BytesIO(resp.read()))
