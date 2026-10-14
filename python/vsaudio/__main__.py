"""CLI: python -m vsaudio <tts|mix|qa> <in.json> <out.json>"""
from __future__ import annotations

import json
import sys
import time


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 3 or argv[0] not in ("tts", "mix", "qa"):
        print(__doc__, file=sys.stderr)
        return 2
    cmd, src, dst = argv
    with open(src, encoding="utf-8") as f:
        job = json.load(f)
    t0 = time.time()
    if cmd == "tts":
        from .tts import run_tts as run
    elif cmd == "mix":
        from .mix import run_mix as run
    else:
        from .qa import run_qa as run
    out = run(job)
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"vsaudio {cmd}: done in {time.time() - t0:.1f}s", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
