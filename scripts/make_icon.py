"""Generate assets/icon.ico for the packaged desktop app: a blue rounded
square (matching the in-app --brand color) with a white monitor glyph and
a blue checkmark on the screen, representing "equipment records" rather
than the earlier plain "EP" text monogram."""
import os
from PIL import Image, ImageDraw

BRAND_BLUE = (42, 120, 214, 255)  # --brand
WHITE = (255, 255, 255, 255)

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(os.path.dirname(HERE), "assets")
OUT_PATH = os.path.join(OUT_DIR, "icon.ico")

SIZE = 256
RADIUS = 56


def thick_line(draw, p1, p2, width, fill):
    draw.line([p1, p2], fill=fill, width=width)
    r = width / 2
    for (x, y) in (p1, p2):
        draw.ellipse([x - r, y - r, x + r, y + r], fill=fill)


def build_base_image():
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=RADIUS, fill=BRAND_BLUE)

    # monitor screen
    screen = [53, 56, 203, 164]
    draw.rounded_rectangle(screen, radius=16, fill=WHITE)
    # monitor stand
    draw.rectangle([111, 164, 145, 184], fill=WHITE)
    draw.rounded_rectangle([88, 184, 168, 198], radius=7, fill=WHITE)

    # checkmark on the screen
    thick_line(draw, (84, 114), (108, 138), 18, BRAND_BLUE)
    thick_line(draw, (108, 138), (170, 88), 18, BRAND_BLUE)
    return img


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    base = build_base_image()
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    base.save(OUT_PATH, format="ICO", sizes=sizes)
    print(f"Wrote {OUT_PATH}")


if __name__ == "__main__":
    main()
