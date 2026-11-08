"""Render matching Eiffel Tower icons and a GitHub social preview."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
BACKGROUND = "#17454b"
TOWER = "#fff5df"
SCALE = 4


def draw_tower(image: Image.Image, favicon: bool = False) -> None:
    """Draw a single-color tower in a 512-unit square design space."""
    draw = ImageDraw.Draw(image)

    def xy(x: float, y: float) -> tuple[int, int]:
        return round(x * SCALE), round(y * SCALE)

    def stroke(points: list[tuple[float, float]], width: float) -> None:
        # Rounded ends join the sloped ironwork cleanly at small output sizes.
        pixels = [xy(x, y) for x, y in points]
        draw.line(pixels, fill=TOWER, width=round(width * SCALE), joint="curve")
        radius = width * SCALE / 2
        for x, y in (pixels[0], pixels[-1]):
            draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=TOWER)

    def pair(points: list[tuple[float, float]], width: float) -> None:
        stroke(points, width)
        stroke([(512 - x, y) for x, y in points], width)

    # The tapered outline, three platforms, central opening, and antenna make
    # the Eiffel Tower example recognizable while staying inside the maskable
    # safe circle. All ironwork uses the same warm ivory color.
    pair([(137, 392), (171, 313), (205, 231), (232, 170), (249, 127)], 10)
    pair([(174, 392), (202, 313), (229, 231), (247, 170), (256, 127)], 7)
    stroke([(256, 127), (256, 101)], 8)
    for left, right, y, width in [
        (229, 283, 170, 8),
        (205, 307, 231, 9),
        (170, 342, 313, 11),
    ]:
        stroke([(left, y), (right, y)], width)
    pair([(137, 392), (174, 392)], 12)

    # A broad arch leaves the characteristic open space between the feet.
    stroke([(174, 392), (185, 370), (201, 354), (219, 342), (238, 337), (256, 336)], 8)
    stroke([(256, 336), (274, 337), (293, 342), (311, 354), (327, 370), (338, 392)], 8)

    if favicon:
        return

    # Narrow intermediate ties and crossed braces echo the example's lattice.
    # Their reduced width keeps the larger icons detailed without filling in
    # the open arch or turning the 192 px icon into a solid triangle.
    for y, left in [(194, 222), (258, 194), (285, 182)]:
        stroke([(left, y), (512 - left, y)], 4)
    for bottom_y, bottom_left, top_y, top_left in [
        (313, 171, 285, 182),
        (285, 182, 258, 194),
        (258, 194, 231, 205),
        (231, 205, 194, 222),
        (194, 222, 170, 232),
    ]:
        stroke([(bottom_left, bottom_y), (512 - top_left, top_y)], 3.5)
        stroke([(512 - bottom_left, bottom_y), (top_left, top_y)], 3.5)
    pair([(150, 362), (187, 342)], 3.5)
    pair([(159, 339), (201, 354)], 3.5)


def icon(size: int, favicon: bool = False) -> Image.Image:
    canvas = 512 * SCALE
    image = Image.new("RGB", (canvas, canvas), BACKGROUND)
    draw_tower(image, favicon)
    if favicon:
        # Browser tabs have no mask, so the mark fills more of their 32 px tile.
        inset = 59 * SCALE
        image = image.crop((inset, inset, canvas - inset, canvas - inset))
    return image.resize((size, size), Image.Resampling.LANCZOS)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    names = ["segoeuib.ttf" if bold else "segoeui.ttf", "arialbd.ttf" if bold else "arial.ttf"]
    for name in names:
        for path in (Path("C:/Windows/Fonts") / name, Path(name)):
            try:
                return ImageFont.truetype(str(path), size)
            except OSError:
                continue
    raise RuntimeError("A Segoe UI or Arial TrueType font is required for the social preview.")


def social_preview() -> Image.Image:
    """Compose a GitHub-sized banner around the same single-color tower."""
    preview = Image.new("RGB", (1280, 640), BACKGROUND)
    draw = ImageDraw.Draw(preview)

    # The faint construction grid supports the structural theme without
    # competing with the large tower silhouette or the text on the right.
    grid = "#28545a"
    for x in range(40, 1280, 40):
        draw.line((x, 0, x, 640), fill=grid, width=1)
    for y in range(40, 640, 40):
        draw.line((0, y, 1280, y), fill=grid, width=1)

    tower = Image.new("RGBA", (512 * SCALE, 512 * SCALE), (0, 0, 0, 0))
    draw_tower(tower)
    tower = tower.resize((590, 590), Image.Resampling.LANCZOS)
    preview.paste(tower, (24, 25), tower)

    draw.text((620, 194), "BAR LAB", font=font(32, bold=True), fill=TOWER)
    draw.text((614, 249), "Build. Test.\nTry again.", font=font(91, bold=True), fill=TOWER, spacing=2)
    draw.line((620, 500, 1170, 500), fill=TOWER, width=3)
    draw.text((620, 524), "A structural playground", font=font(31), fill=TOWER)
    return preview


def main() -> None:
    icons = ROOT / "public" / "icons"
    icon(192).save(icons / "icon-192.png", format="PNG", optimize=True)
    icon(512).save(icons / "icon-512.png", format="PNG", optimize=True)
    icon(32, favicon=True).save(ROOT / "public" / "favicon.png", format="PNG", optimize=True)
    social_preview().save(ROOT / "docs" / "images" / "social-preview.png", format="PNG", optimize=True)


if __name__ == "__main__":
    main()
