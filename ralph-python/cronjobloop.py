#!/usr/bin/env python3
"""Ralph 循环脚本（Python 版本，对应 ralph/cronjobloop.sh）。

每隔 1800 秒（30 分钟）调用一次 afk.py（qodercli，20 次迭代），无限循环。
用法: python cronjobloop.py
"""

import subprocess
import sys
import time
from pathlib import Path

RALPH_DIR = Path(__file__).resolve().parent
PROJECT_DIR = RALPH_DIR.parent
AFK = RALPH_DIR / "afk.py"


def main() -> None:
    while True:
        subprocess.run([sys.executable, str(AFK), "qodercli", "20"], cwd=PROJECT_DIR)
        time.sleep(1800)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
