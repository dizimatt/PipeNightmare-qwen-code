#!/usr/bin/env python3
"""Authoring-time fetch of material swatches for a sprite skin (R-008).

    python3 tools/fetch_skin.py copper
    python3 tools/fetch_skin.py brass --material "brushed brass"

Writes `assets/skins/<name>/metal.png` and `panel.png` plus `skin.json`, then
regenerate the artwork with `python3 tools/generate_assets.py --skin <name>`.

Why the bytes land in the repo: the image API returns a signed URL that
expires in about a day, and a fresh call is never pixel-identical. Caching the
swatches as committed source keeps `generate_assets.py` deterministic and
offline, so deleting `assets/` and re-running still restores identical files.
This script is the only place in the repo that touches the network, and the
game never runs it.

Needs the key in the environment; it is never written to a file:

    export QWENCLOUD_TOKEN_PLAN_API_KEY=...
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
import urllib.error
import urllib.request
import zlib
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BASE = "https://token-plan.maas.qwencloudapi.com"
ENDPOINT = BASE + "/api/v1/services/aigc/multimodal-generation/generation"
MODEL = "qwen-image-3.0-pro"
KEY_ENV = "QWENCLOUD_TOKEN_PLAN_API_KEY"
SIZE = "1024*1024"      # what the model draws at
STORE = 512             # what we commit: a full-bleed texture needs no more

# A swatch is a material, not a picture: the generator borrows only its hue
# and grain and keeps its own shading, so anything that reads as an object, a
# background or a vignette would show up as a smudge on every tile.
GROUPS = {
    "metal": "Extreme close-up of {material} filling the entire frame edge to "
             "edge. Fine parallel brushed grain and micro-detail, flat frontal "
             "view, soft even studio lighting. No objects, no pipes, no tools, "
             "no background scenery, no vignette, no border, no text.",
    "panel": "Extreme close-up of a dark matte composite panel filling the "
             "entire frame edge to edge, with a faint woven micro-texture and "
             "a very subtle cool sheen. Flat frontal view, soft even lighting, "
             "dark enough for light text on top. No objects, no vignette, no "
             "border, no text.",
}
NEGATIVE = ("object, pipe, tool, hand, scenery, landscape, vignette, border, "
            "frame, text, watermark, logo, shadow, blur, gradient falloff")


def prompt_for(group, material):
    return GROUPS[group].format(material=material) if group == "metal" else GROUPS[group]


def generate(group, material, seed):
    """One synchronous generation call. Returns the raw PNG bytes."""
    key = os.environ.get(KEY_ENV)
    if not key:
        raise SystemExit(f"{KEY_ENV} is not set — export it first")
    body = {
        "model": MODEL,
        "input": {"messages": [{"role": "user", "content": [{"text": prompt_for(group, material)}]}]},
        "parameters": {
            "size": SIZE, "n": 1, "seed": seed, "watermark": False,
            "prompt_extend": False, "negative_prompt": NEGATIVE,
        },
    }
    req = urllib.request.Request(ENDPOINT, data=json.dumps(body).encode(), method="POST",
                                 headers={"Authorization": f"Bearer {key}",
                                          "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            payload = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:400]
        raise SystemExit(f"HTTP {e.code} from {MODEL}: {detail}")

    content = payload["output"]["choices"][0]["message"]["content"]
    url = next(item["image"] for item in content if "image" in item)
    # The URL is signed and short-lived, so the bytes are fetched right here.
    with urllib.request.urlopen(url, timeout=120) as resp:
        return resp.read()


def store(raw, dest):
    """Commit a deterministic, downscaled copy so the repo stays small."""
    img = Image.open(io.BytesIO(raw)).convert("RGB").resize((STORE, STORE), Image.LANCZOS)
    img.save(dest, optimize=True)


def main():
    ap = argparse.ArgumentParser(description="fetch material swatches for a sprite skin")
    ap.add_argument("name", help="skin directory name under assets/skins/")
    ap.add_argument("--material", help="what the metal swatch should be (default: the name)")
    ap.add_argument("--only", choices=sorted(GROUPS), action="append",
                    help="fetch just this group (repeatable)")
    ap.add_argument("--force", action="store_true", help="re-fetch swatches that already exist")
    args = ap.parse_args()

    out = ROOT / "assets" / "skins" / args.name
    out.mkdir(parents=True, exist_ok=True)
    material = args.material or args.name.replace("-", " ").replace("_", " ")
    groups = args.only or sorted(GROUPS)
    provenance = {"model": MODEL, "size": SIZE, "stored_at": STORE, "material": material,
                  "swatches": {}}

    for group in groups:
        dest = out / f"{group}.png"
        # Seed from the skin and group, so a --force run asks for the same
        # variation again. Reproducibility of the model itself is not
        # guaranteed; the committed PNG is what the build depends on.
        seed = zlib.crc32(f"{args.name}:{group}".encode()) % 1_000_000
        if dest.exists() and not args.force:
            print(f"{group}: cached at {dest.relative_to(ROOT)}")
        else:
            print(f"{group}: generating with seed {seed} ...", flush=True)
            store(generate(group, material, seed), dest)
            print(f"{group}: wrote {dest.relative_to(ROOT)}")
        provenance["swatches"][group] = {"seed": seed, "prompt": prompt_for(group, material)}

    (out / "skin.json").write_text(json.dumps(provenance, indent=2, sort_keys=True) + "\n",
                                   encoding="utf-8")
    print(f"\nnow: python3 tools/generate_assets.py --skin {args.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
