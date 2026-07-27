#!/usr/bin/env python3
"""Generate a minimalist Jobs-era Apple style app icon for Prompt Go.

Design: clean rounded square with a subtle blue gradient background and a
geometric white chevron (prompt symbol ">") centered on it.
"""
from PIL import Image, ImageDraw, ImageFilter


SIZE = 1024
CORNER_RADIUS = 228  # macOS squircle proportion (~22.3%)


def lerp(a, b, t):
    return a + (b - a) * t


def gradient_vertical(draw, size, top_color, bottom_color, mask):
    """Fill a vertical gradient clipped to mask."""
    top_r, top_g, top_b = top_color
    bot_r, bot_g, bot_b = bottom_color
    for y in range(size):
        t = y / max(size - 1, 1)
        r = int(lerp(top_r, bot_r, t))
        g = int(lerp(top_g, bot_g, t))
        b = int(lerp(top_b, bot_b, t))
        draw.line([(0, y), (size, y)], fill=(r, g, b))
    # Apply rounded-rect mask
    mask_bg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    mask_bg.paste(Image.new("RGBA", (size, size), (255, 255, 255, 0)),
                  (0, 0))
    return mask


def make_icon(path):
    # --- Base gradient on a full-square canvas ---
    base = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(base)

    # Apple-like blue gradient: lighter at top, deeper at bottom
    top = (74, 144, 226)   # #4A90E2
    bottom = (38, 86, 153)  # #265699
    for y in range(SIZE):
        t = y / (SIZE - 1)
        r = int(lerp(top[0], bottom[0], t))
        g = int(lerp(top[1], bottom[1], t))
        b = int(lerp(top[2], bottom[2], t))
        draw.line([(0, y), (SIZE, y)], fill=(r, g, b, 255))

    # --- Rounded-rect mask (squircle-ish) ---
    mask = Image.new("L", (SIZE, SIZE), 0)
    mdraw = ImageDraw.Draw(mask)
    mdraw.rounded_rectangle(
        [(0, 0), (SIZE - 1, SIZE - 1)],
        radius=CORNER_RADIUS,
        fill=255,
    )

    # Apply mask to base
    rounded = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    rounded.paste(base, (0, 0), mask)

    # --- Draw the prompt chevron ">" in white ---
    chevron = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    cd = ImageDraw.Draw(chevron)

    # Chevron geometry: centered ">"
    cx, cy = SIZE // 2, SIZE // 2
    arm_len = 200   # length of each arm from center
    thickness = 72  # line thickness

    # Outer points of chevron (pointing right)
    tip = (cx + 110, cy)                 # rightmost tip
    top_outer = (cx - 130, cy - arm_len)
    bot_outer = (cx - 130, cy + arm_len)
    top_inner = (cx - 60, cy - arm_len)
    bot_inner = (cx - 60, cy + arm_len)
    tip_back = (cx + 40, cy)             # back of the tip

    # Outer outline polygon (going clockwise)
    outer = [top_outer, tip, bot_outer, bot_inner, tip_back, top_inner]
    cd.polygon(outer, fill=(255, 255, 255, 255))

    # Soft shadow under chevron for depth (Jobs-era glassiness)
    shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    shifted = [(p[0] + 6, p[1] + 12) for p in outer]
    sd.polygon(shifted, fill=(0, 0, 0, 80))
    # Blur shadow
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=12))

    # Composite: rounded bg -> shadow -> chevron
    final = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    final = Image.alpha_composite(final, rounded)
    final = Image.alpha_composite(final, shadow)
    final = Image.alpha_composite(final, chevron)

    # Subtle top gloss highlight (very faint, Apple iOS-6 era touch)
    gloss = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    gd = ImageDraw.Draw(gloss)
    gd.pieslice(
        [(0, -SIZE // 2), (SIZE, SIZE // 2)],
        180, 360,
        fill=(255, 255, 255, 28),
    )
    # Clip gloss to rounded mask
    gloss_clipped = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    gloss_clipped.paste(gloss, (0, 0), mask)
    final = Image.alpha_composite(final, gloss_clipped)

    final.save(path, "PNG")
    print(f"Icon saved to {path} ({SIZE}x{SIZE})")


if __name__ == "__main__":
    import os
    here = os.path.dirname(os.path.abspath(__file__))
    make_icon(os.path.join(here, "icon.png"))
