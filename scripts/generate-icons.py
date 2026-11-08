"""Render the Eiffel Tower example as the app's square PNG icons."""

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
BACKGROUND = "#17454b"
BEAMS = "#fff5df"
DETAIL = "#f6bf78"
SUPERSAMPLE = 4


def render(size: int, favicon: bool = False) -> Image.Image:
    """Draw in a 512-unit design space, then downsample for smooth small icons."""
    canvas = 512 * SUPERSAMPLE
    image = Image.new("RGB", (canvas, canvas), BACKGROUND)
    draw = ImageDraw.Draw(image)

    def point(x: float, y: float) -> tuple[int, int]:
        return round(x * SUPERSAMPLE), round(y * SUPERSAMPLE)

    def beam(a: tuple[float, float], b: tuple[float, float], width: float, color: str = BEAMS) -> None:
        # Rounded joints keep adjacent beam segments visually connected after downsampling.
        radius = width * SUPERSAMPLE / 2
        start, end = point(*a), point(*b)
        draw.line((start, end), fill=color, width=round(width * SUPERSAMPLE))
        for x, y in (start, end):
            draw.ellipse((round(x - radius), round(y - radius), round(x + radius), round(y + radius)), fill=color)

    # The wide feet, narrowing legs, stacked decks, and short spire follow the
    # proportions of the application's Eiffel Tower example. The complete mark
    # fits inside the central maskable safe area of the square background.
    left = [(145, 386), (174, 325), (200, 266), (225, 209), (246, 157)]
    right = [(512 - x, y) for x, y in left]
    for side in (left, right):
        for start, end in zip(side, side[1:]):
            beam(start, end, 14)
    beam((256, 158), (256, 124), 12)
    beam((240, 157), (272, 157), 11)

    # Decks and the open arch make the structure legible even at favicon size.
    for y, start, end in [(209, 218, 294), (266, 195, 317), (325, 168, 344)]:
        beam((start, y), (end, y), 11, DETAIL)
    beam((132, 395), (380, 395), 13)
    beam((191, 325), (218, 365), 10)
    beam((321, 325), (294, 365), 10)
    beam((218, 365), (294, 365), 10)

    if not favicon:
        # Larger icons retain a hint of the example's inner braces. They are
        # omitted from the favicon because subpixel strokes would blur there.
        for lower_y, lower_half, upper_y, upper_half in [
            (325, 82, 266, 56),
            (266, 56, 209, 32),
            (209, 32, 157, 10),
        ]:
            beam((256 - lower_half, lower_y), (256 + upper_half, upper_y), 5)
            beam((256 + lower_half, lower_y), (256 - upper_half, upper_y), 5)

    if favicon:
        # Browser tabs do not apply a mask, so fill more of their tiny square.
        inset = 64 * SUPERSAMPLE
        image = image.crop((inset, inset, canvas - inset, canvas - inset))
    return image.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    icons = ROOT / "public" / "icons"
    render(192).save(icons / "icon-192.png", format="PNG", optimize=True)
    render(512).save(icons / "icon-512.png", format="PNG", optimize=True)
    render(32, favicon=True).save(ROOT / "public" / "favicon.png", format="PNG", optimize=True)


if __name__ == "__main__":
    main()
