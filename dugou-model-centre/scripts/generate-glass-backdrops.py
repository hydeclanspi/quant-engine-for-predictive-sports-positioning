#!/usr/bin/env python3
"""Bake the quiet backgrounds used by the smooth glass rendering mode.

Run from any directory: python3 scripts/generate-glass-backdrops.py
Requires only the existing numpy and Pillow installation; no browser, GPU,
network, or runtime image/noise filters are involved.

These are lightweight, deliberately static approximations, NOT screenshots of
the full-quality WebGL scene. The flagship palette, glow positions, falloffs,
vignette and ring spacing mirror FLAGSHIP_PARAMS / MAIN_FRAG_SRC_FLAGSHIP in
LiquidGlassBackdrop.jsx (2026-09-23). Broad smooth fields replace the shader's
simplex modulation; mouse response, parallax and scintillation are omitted.
Light themes retain the same palette and large color-field composition without
turbulent detail. Portraits are separately composed, not center crops.

Spectra's upper-right white light and chromatic edges are kept OUT of its base
image. spectra-beams.webp contains the entire two-streak composition, so use
ONE copy with transform/opacity animation; do not add a duplicated bright layer.
Suggested desktop placement: width:64vw; aspect-ratio:8/3; right:0; top:-8vh.
The image is designed for screen blending over spectra; no CSS blur is needed.
Suggested narrow placement: width:130vw; right:-12vw; top:-3vh.

Output is deterministic for a fixed numpy/Pillow encoder version. The fixed
seed controls subpixel dither and the sparse starfield. No assets are fetched.
"""

from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "glass-backdrops"
SEED = 20260923
SIZES = (("", 1600, 1000), ("-portrait", 800, 1200))


def rgb(value):
    return np.array([int(value[i:i + 2], 16) / 255 for i in (1, 3, 5)], dtype=np.float32)


# Keep these together so a future palette change is inexpensive to rebake.
FLAGSHIP = {
    "spectra": {
        "base": "#0a1122", "base_b": "#04070f",
        "a": ("#16336b", (0.22, 0.8), 2.2, 0.55),
        "b": ("#2a1e5c", (0.9, 0.06), 2.6, 0.5), "vignette": 0.3,
    },
    "xuanji": {
        "base": "#0d1713", "base_b": "#060d0a",
        "a": ("#e8dfc8", (0.78, 0.86), 2.4, 0.16),
        "b": ("#3f6b58", (0.14, 0.08), 2.0, 0.5), "vignette": 0.32,
    },
    "starward": {
        "base": "#040b1c", "base_b": "#0c2148",
        "a": ("#123a6e", (0.5, 0.02), 1.5, 0.42),
        "b": ("#0a1b3a", (0.82, 0.32), 2.4, 0.4), "vignette": 0.3,
    },
}


def smoothstep(lo, hi, values):
    t = np.clip((values - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)


def coordinates(width, height):
    # Shader coordinates have y pointing up; images are stored top to bottom.
    x = (np.arange(width, dtype=np.float32) + 0.5) / width
    y = 1 - (np.arange(height, dtype=np.float32) + 0.5) / height
    u, v = np.meshgrid(x, y)
    return u, v, (u - 0.5) * (width / height), v - 0.5


def mix(color, target, amount):
    return color * (1 - amount[..., None]) + target * amount[..., None]


def broad_modulation(x, y, phase=0):
    # Low spatial frequencies only: the background must remain visually quiet.
    return 0.5 + 0.19 * np.sin(x * 2.1 + y * 1.3 + phase) + 0.12 * np.cos(y * 3.0 - x * 0.7 + phase)


def flagship(name, width, height):
    params = FLAGSHIP[name]
    u, v, x, y = coordinates(width, height)
    aspect = width / height
    amount = smoothstep(-0.08, 1.06, v)
    color = mix(np.broadcast_to(rgb(params["base_b"]), (*v.shape, 3)), rgb(params["base"]), amount)
    # A single reduced-motion-like moment; broad glows never wander at runtime.
    drift = np.array([np.sin(12 * 0.021), np.cos(12 * 0.017)]) * 0.05
    for key, movement, phase, weight in (("a", drift, 0.6, 0.28), ("b", -drift * 1.3, 2.2, 0.32)):
        tint, position, falloff, amp = params[key]
        px = (position[0] - 0.5) * aspect + movement[0]
        py = position[1] - 0.5 + movement[1]
        distance = np.hypot(x - px, y - py)
        modulation = (1 - weight) + weight * broad_modulation(x, y, phase)
        color += rgb(tint) * (np.exp(-distance * falloff) * modulation * amp)[..., None]

    if name == "xuanji":
        # The full renderer uses a 0.84 / 0.88 center and seven rings per height.
        # On portrait move the center slightly inward so the dial is still legible.
        ring_x = 0.84 if width >= height else 0.79
        rx, ry = x - (ring_x - 0.5) * aspect, y - 0.38
        radius = np.hypot(rx, ry)
        fraction = np.mod(radius * 7, 1)
        ring = 1 - smoothstep(0, 0.045, np.minimum(fraction, 1 - fraction))
        fade = np.exp(-radius * 2.05) * smoothstep(0.08, 0.26, radius)
        color += rgb("#c9a96a") * (ring * fade * 0.42)[..., None]
        # Restrained calibration marks make the fixed dial feel intentional;
        # these small ticks are a smooth-mode approximation, not shader output.
        angle = np.arctan2(ry, rx)
        ticks = np.mod(angle / (2 * np.pi) * 96, 1)
        tick_line = 1 - smoothstep(0.022, 0.08, np.minimum(ticks, 1 - ticks))
        tick_radial = np.exp(-((radius - 3 / 7) / 0.009) ** 8)
        color += rgb("#c9a96a") * (tick_line * tick_radial * fade * 0.18)[..., None]

    if name == "starward":
        # Stable sparse distribution at the shader's 13 cells per unit height.
        rng = np.random.default_rng(SEED + 37)
        columns = int(np.ceil(aspect * 13))
        for row in range(13):
            for column in range(columns):
                if rng.random() < 0.80:
                    continue
                cx = (column + rng.uniform(0.1, 0.9)) * height / 13
                cy = (row + rng.uniform(0.1, 0.9)) * height / 13
                strength = rng.uniform(0.14, 0.63)
                radius_px = height / 13 * rng.uniform(0.022, 0.044)
                x0, x1 = max(0, int(cx - 8)), min(width, int(cx + 9))
                y0, y1 = max(0, int(cy - 8)), min(height, int(cy + 9))
                if x0 >= x1 or y0 >= y1:
                    continue
                yy, xx = np.mgrid[y0:y1, x0:x1]
                spot = np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (radius_px * radius_px))
                color[y0:y1, x0:x1] += rgb("#dbeaff") * (spot * strength)[..., None]

    vignette = 1 - params["vignette"] * smoothstep(0.35, 0.78, np.hypot(u - 0.5, v - 0.5))
    return np.clip(color * vignette[..., None], 0, 1)


def light_theme(name, width, height):
    u, v, x, y = coordinates(width, height)
    aspect = width / height
    if name == "hongguo":
        color = np.broadcast_to(rgb("#f4f7f8"), (*v.shape, 3)).copy()
        # Faithful t=0 macro placement: teal lower left, orange lower right,
        # champagne upper left and pale jade upper right, quiet at the center.
        fields = (
            ("#38bdb4", (-0.42, -0.28), 0.34, 0.86, 0.80),
            ("#f28a4b", (0.46, -0.32), 0.30, 0.76, 0.78),
            ("#e9c98f", (-0.44, 0.32), 0.24, 0.64, 0.62),
            ("#a6ded8", (0.36, 0.36), 0.26, 0.68, 0.46),
        )
        for tint, (px, py), inner, outer, amp in fields:
            if width < height:
                px *= 0.58
            distance = np.hypot(x - px, y - py)
            # Mild coherent deformation replaces the dynamic noise warp.
            distance += 0.025 * np.sin(x * 4 + y * 2.5)
            color = mix(color, rgb(tint), (1 - smoothstep(inner, outer, distance)) * amp)
        luminance = color @ np.array([0.299, 0.587, 0.114])
        color = luminance[..., None] * 0.04 + color * 0.96
        calm = 1 - smoothstep(0.34, 0.76, np.hypot(x, y))
        color = mix(color, rgb("#f2f4f7"), calm * 0.132)
        light_distance = np.hypot(x - 0.28 * aspect, y - 0.32)
        color += rgb("#fff7e6") * (np.exp(-light_distance ** 2 * 4.5) * 0.05)[..., None]
        color += rgb("#b8ccff") * (np.exp(-light_distance * 1.8) * 0.035)[..., None]
    else:
        color = np.broadcast_to(rgb("#dde6f3"), (*v.shape, 3)).copy()
        # The vivid shader continuously changes its composition. This fixed
        # layout keeps its blue/amber/violet/jade palette and broad fluid arcs.
        fields = (
            ("#5ea8f5", (0.13, 0.76), (0.63, 0.66), 0.84),
            ("#f5a94f", (0.77, 0.36), (0.62, 0.49), 0.78),
            ("#9d86f2", (0.83, 0.88), (0.49, 0.37), 0.64),
            ("#46cda6", (0.12, 0.02), (0.58, 0.36), 0.52),
        )
        warp = 0.035 * np.sin(u * 5.5 + v * 3.0)
        for tint, (px, py), (sx, sy), amp in fields:
            distance = ((u + warp - px) / sx) ** 2 + ((v - py) / sy) ** 2
            color = mix(color, rgb(tint), np.exp(-distance * 1.65) * amp)
        light_distance = np.hypot((u - 0.75) * aspect, v - 0.8)
        color += rgb("#fff7e6") * (np.exp(-light_distance ** 2 * 4.5) * 0.06)[..., None]
        color += rgb("#b8ccff") * (np.exp(-light_distance * 1.8) * 0.035)[..., None]
    color *= (1 - 0.10 * smoothstep(0.5, 0.95, np.hypot(u - 0.5, v - 0.5)))[..., None]
    return np.clip(color, 0, 1)


def beams():
    width, height = 1024, 384
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    # With a 1024px image at (576px,-80px), the brighter streak follows the
    # original shader: it enters the viewport near x=1160 and exits y=126.
    distance = (yy - (0.287 * (xx - 584) + 80)) * 0.961
    color = np.zeros((height, width, 3), dtype=np.float32)
    for center, amp, spread in ((0, 0.88, 30), (75, 0.25, 20)):
        d = distance - center
        light = np.exp(-(d / spread) ** 2)
        warm = np.exp(-((d - 14) / 6.3) ** 2)
        cool = np.exp(-((d + 14) / 6.3) ** 2)
        color += rgb("#a8c4ff") * (light * 0.70 * amp)[..., None]
        color += rgb("#a87162") * (warm * 0.66 * amp)[..., None]
        color += rgb("#5ba2ff") * (cool * 0.76 * amp)[..., None]
        color += rgb("#a8c4ff") * (np.exp(-np.abs(d) / 85) * 0.022 * amp)[..., None]
    # Pad every image boundary to zero to avoid revealing rectangular edges
    # during the CSS translate/scale breathing cycle.
    fade = smoothstep(0, 48, xx) * smoothstep(0, 32, width - xx)
    fade *= smoothstep(0, 18, yy) * smoothstep(0, 34, height - yy)
    color *= fade[..., None]
    alpha = np.max(color, axis=-1)
    straight = np.divide(color, alpha[..., None], out=np.zeros_like(color), where=alpha[..., None] > 1e-6)
    rgba = np.concatenate((straight, alpha[..., None]), axis=-1)
    image = Image.fromarray(np.round(np.clip(rgba, 0, 1) * 255).astype(np.uint8))
    image.save(OUTPUT / "spectra-beams.webp", "WEBP", quality=94, method=6, exact=True)


def save_background(name, suffix, width, height):
    color = flagship(name, width, height) if name in FLAGSHIP else light_theme(name, width, height)
    # Less than one 8-bit level of fixed dither prevents visible quantization;
    # unlike the flagship shader grain it never changes or redraws at runtime.
    rng = np.random.default_rng(SEED + sum(map(ord, name)))
    color += rng.uniform(-0.32 / 255, 0.32 / 255, (height, width, 1)).astype(np.float32)
    image = Image.fromarray(np.round(np.clip(color, 0, 1) * 255).astype(np.uint8))
    image.save(OUTPUT / f"{name}{suffix}.webp", "WEBP", quality=92, method=6)


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for name in ("spectra", "xuanji", "starward", "vivid", "hongguo"):
        for suffix, width, height in SIZES:
            save_background(name, suffix, width, height)
    beams()
    total = 0
    for path in sorted(OUTPUT.glob("*.webp")):
        with Image.open(path) as image:
            size = path.stat().st_size
            total += size
            print(f"{path.name:26} {image.width:4}x{image.height:<4} {image.mode:4} {size / 1024:7.1f} KiB")
    print(f"Total: {total:,} bytes ({total / 1024:.1f} KiB)")
    if total > 700_000:
        raise SystemExit("Background assets exceed the 700 kB budget; lower encoder quality before committing.")


if __name__ == "__main__":
    main()
