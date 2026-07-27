#!/usr/bin/env python3
"""Generate torL TUI preview images."""
from PIL import Image, ImageDraw, ImageFont
import os

ASSETS = os.path.dirname(os.path.abspath(__file__))

# Palette
BG = (22, 22, 30)
PANEL_BG = (30, 30, 42)
PURPLE = (125, 86, 244)
GREEN = (4, 181, 117)
PINK = (255, 95, 135)
WHITE = (250, 250, 250)
GRAY = (163, 163, 163)
DARK_GRAY = (107, 114, 128)
BORDER = (135, 75, 253)

FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
BOLD_FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"


def font(size, bold=False):
    path = BOLD_FONT_PATH if bold else FONT_PATH
    return ImageFont.truetype(path, size)


def text_width(draw, text, fnt):
    return draw.textlength(text, font=fnt)


def draw_rounded_rect(draw, xy, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)


def render_tui_content(draw, panel_x, panel_y, panel_w, label_fnt, body_fnt, title_fnt, compact=False):
    """Render the shared torL TUI content into a panel."""
    line = label_fnt.size + 8
    margin = 24
    x = panel_x + margin
    y = panel_y + 18

    draw.text((x, y), "torl", font=title_fnt, fill=PURPLE)
    y += title_fnt.size + 20

    # File
    draw.text((x, y), "File: ", font=label_fnt, fill=WHITE)
    draw.text((x + text_width(draw, "File: ", label_fnt), y),
              "debian-13.6.0-amd64-netinst.iso", font=body_fnt, fill=WHITE)
    y += line

    # Status
    draw.text((x, y), "Status: ", font=label_fnt, fill=WHITE)
    draw.text((x + text_width(draw, "Status: ", label_fnt), y), "Downloading", font=body_fnt, fill=GREEN)
    y += line + 8

    # Progress bar
    bar_w = 440
    bar_h = max(16, label_fnt.size - 2)
    draw_rounded_rect(draw, [x, y, x + bar_w, y + bar_h], bar_h // 2, (45, 45, 60))
    progress = 0.62
    draw_rounded_rect(draw, [x, y, x + int(bar_w * progress), y + bar_h], bar_h // 2, PURPLE)
    y += bar_h + 8

    stats = "62.0%    194.52 MiB / 313.74 MiB    1248 / 2013 pieces"
    draw.text((x, y), stats, font=body_fnt, fill=GRAY)
    y += line + 14

    # Peers
    draw.text((x, y), "Peers", font=label_fnt, fill=WHITE)
    y += line

    active_label = "  Active: "
    avail_label = "  Available: "
    active_x = x
    draw.text((active_x, y), active_label, font=body_fnt, fill=WHITE)
    active_val_x = active_x + text_width(draw, active_label, body_fnt)
    draw.text((active_val_x, y), "7", font=body_fnt, fill=GREEN)

    avail_x = active_val_x + text_width(draw, "7", body_fnt) + 48
    draw.text((avail_x, y), avail_label, font=body_fnt, fill=WHITE)
    avail_val_x = avail_x + text_width(draw, avail_label, body_fnt)
    draw.text((avail_val_x, y), "23", font=body_fnt, fill=GRAY)
    y += line + 6

    peers = [
        ("+", GREEN, "192.168.1.42:6881"),
        ("+", GREEN, "203.0.113.9:51413"),
        ("-", GRAY, "198.51.100.4:6881"),
    ]
    if not compact:
        peers.extend([
            ("+", GREEN, "10.0.0.5:53123"),
            ("-", GRAY, "172.16.0.1:6882"),
        ])

    for icon, color, text in peers:
        draw.text((x + 16, y), icon, font=body_fnt, fill=color)
        draw.text((x + 34, y), text, font=body_fnt, fill=DARK_GRAY)
        y += line

    y += 10

    # Messages
    draw.text((x, y), "Messages", font=label_fnt, fill=WHITE)
    y += line
    messages = [
        "connected to DHT bootstrap",
        "announcing to tracker...",
    ]
    if not compact:
        messages.insert(0, "peer 203.0.113.9 error: connect ECONNREFUSED")
    for msg in messages:
        draw.text((x + 16, y), msg, font=body_fnt, fill=GRAY)
        y += line

    return y


def make_tui_preview():
    w, h = 720, 540
    img = Image.new("RGB", (w, h), BG)
    draw = ImageDraw.Draw(img)

    # Terminal window chrome
    chrome_height = 32
    draw.rectangle([0, 0, w, chrome_height], fill=(40, 40, 52))
    for i, color in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        bx = 16 + i * 20
        draw.ellipse([bx, 10, bx + 12, 22], fill=color)
    draw.text((w - 80, 8), "ttyd", font=font(14), fill=GRAY)

    panel_x, panel_y = 40, 56
    panel_w, panel_h = 640, 460
    draw_rounded_rect(draw, [panel_x, panel_y, panel_x + panel_w, panel_y + panel_h], 16, PANEL_BG, BORDER, 2)

    label_fnt = font(15, bold=True)
    body_fnt = font(15)
    title_fnt = font(28, bold=True)
    content_bottom = render_tui_content(draw, panel_x, panel_y, panel_w, label_fnt, body_fnt, title_fnt, compact=True)

    # Footer
    footer_text = "Press 'q' or Ctrl+C to quit"
    footer_y = panel_y + panel_h - 36
    draw.text((panel_x + 24, footer_y), footer_text, font=body_fnt, fill=DARK_GRAY)

    img.save(os.path.join(ASSETS, "tui-preview.png"))
    print("Created tui-preview.png")


def make_ttyd_browser_preview():
    w, h = 900, 620
    img = Image.new("RGB", (w, h), (18, 18, 26))
    draw = ImageDraw.Draw(img)

    # Browser chrome
    draw.rectangle([0, 0, w, 44], fill=(35, 35, 45))
    draw.rectangle([12, 8, 220, 40], fill=(25, 25, 35))
    draw.text((26, 14), "torl TUI — ttyd", font=font(13), fill=WHITE)
    draw.rounded_rectangle([240, 10, w - 20, 36], radius=8, fill=(50, 50, 60))
    draw.text((260, 14), "http://localhost:7681", font=font(13), fill=(180, 180, 190))

    inset = 12
    draw.rectangle([inset, 52, w - inset, h - inset], fill=(10, 10, 14))

    panel_x, panel_y = 90, 90
    panel_w, panel_h = 640, 420
    draw_rounded_rect(draw, [panel_x, panel_y, panel_x + panel_w, panel_y + panel_h], 16, PANEL_BG, BORDER, 2)

    label_fnt = font(14, bold=True)
    body_fnt = font(14)
    title_fnt = font(24, bold=True)
    content_bottom = render_tui_content(draw, panel_x, panel_y, panel_w, label_fnt, body_fnt, title_fnt, compact=True)

    footer_y = panel_y + panel_h - 32
    draw.text((panel_x + 24, footer_y), "Press 'q' or Ctrl+C to quit", font=body_fnt, fill=DARK_GRAY)

    img.save(os.path.join(ASSETS, "tui-ttyd-preview.png"))
    print("Created tui-ttyd-preview.png")


if __name__ == "__main__":
    make_tui_preview()
    make_ttyd_browser_preview()
