from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import cv2
import numpy as np

spec = importlib.util.spec_from_file_location("cleanup_base", ".tmp-video-cleanup.py")
base = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(base)

original_manual_mask = base.manual_mask


def scaled_box(box, width: int, height: int):
    return (
        box[0] * width / 478.0,
        box[1] * height / 850.0,
        box[2] * width / 478.0,
        box[3] * height / 850.0,
    )


def enhanced_manual_mask(index: int, width: int, height: int) -> np.ndarray:
    mask = original_manual_mask(index, width, height)

    desk = {
        1: (270, 372, 120, 220), 25: (262, 378, 122, 222), 50: (240, 383, 126, 226),
        75: (210, 388, 132, 230), 101: (170, 392, 140, 235), 126: (125, 395, 148, 240),
        151: (85, 398, 155, 245), 176: (42, 400, 158, 250), 195: (8, 402, 160, 255),
    }
    standing = {
        112: (468, 232, 75, 275), 126: (430, 238, 82, 275), 140: (350, 240, 96, 280),
        151: (272, 242, 105, 285), 166: (200, 242, 112, 290), 181: (125, 242, 120, 295),
        196: (45, 242, 128, 300), 212: (-45, 242, 135, 305),
    }
    seated_group = {
        120: (468, 275, 125, 340), 140: (430, 278, 135, 345), 151: (380, 280, 145, 350),
        176: (270, 280, 225, 365), 201: (160, 282, 235, 380), 226: (52, 284, 245, 395),
        251: (-55, 286, 255, 410), 275: (-160, 288, 270, 425),
    }
    foreground_woman = {
        132: (468, 500, 55, 350), 142: (430, 455, 95, 395), 151: (340, 385, 170, 465),
        166: (245, 340, 220, 510), 181: (160, 305, 255, 545), 201: (90, 260, 315, 590),
        226: (42, 220, 350, 640), 251: (18, 140, 385, 720), 263: (-5, 80, 445, 780),
        275: (-25, -10, 500, 870),
    }
    right_person = {
        135: (468, 285, 70, 565), 151: (440, 292, 85, 555), 166: (405, 300, 100, 540),
        181: (382, 312, 110, 520), 196: (395, 325, 98, 500), 215: (452, 350, 60, 470),
    }

    for track, seated, woman in (
        (desk, False, False),
        (standing, False, False),
        (foreground_woman, False, True),
        (right_person, False, False),
    ):
        box = base.interp(track, index)
        if box is not None:
            base.draw_human(mask, scaled_box(box, width, height), seated=seated, woman=woman)

    group_box = base.interp(seated_group, index)
    if group_box is not None:
        x, y, w, h = scaled_box(group_box, width, height)
        x1, y1 = max(0, int(round(x))), max(0, int(round(y)))
        x2, y2 = min(width, int(round(x + w))), min(height, int(round(y + h)))
        if x2 > x1 and y2 > y1:
            cv2.rectangle(mask, (x1, y1), (x2, y2), 255, -1)

    # Extra safety for partial bodies entering or leaving the frame edges.
    if 130 <= index <= 220:
        edge_width = int(round((35 + 25 * np.sin((index - 130) / 90 * np.pi)) * width / 478.0))
        cv2.rectangle(mask, (max(0, width - edge_width), int(260 * height / 850)), (width - 1, height - 1), 255, -1)
    if index >= 248:
        late_left = int(round(np.interp(index, [248, 275], [55, 175]) * width / 478.0))
        cv2.rectangle(mask, (0, int(260 * height / 850)), (min(width - 1, late_left), height - 1), 255, -1)

    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((13, 13), np.uint8), iterations=1)
    return cv2.dilate(mask, np.ones((13, 13), np.uint8), iterations=1)


base.manual_mask = enhanced_manual_mask

config_path = Path(".tmp-video-cleanup-config.json")
config = json.loads(config_path.read_text())
# The last generated plate introduced ghosting. The clean frame at 251 is propagated through the final 24 frames instead.
config["keyframes"] = [item for item in config["keyframes"] if int(item["frame"]) != 275]
config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2))

base.main()

source = Path("video_sem_pessoas_v2.mp4")
target = Path("video_sem_pessoas_v3.mp4")
if target.exists():
    target.unlink()
source.rename(target)
