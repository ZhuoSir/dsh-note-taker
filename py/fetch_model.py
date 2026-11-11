"""把 faster-whisper 模型下到本地目录，绕开 huggingface_hub 的下载器。

为什么不用 hf_hub 自带的下载：在本机实测它会卡在 0 字节（lessons L-08）；
而同一个镜像的直连下载是可用的（只是慢）。模型落到本地目录后，转写侧直接按目录加载，
不再依赖运行时的 Hub 访问。

用法：python py/fetch_model.py --model tiny --out-dir <dir>
"""

import argparse
import json
import os
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _common import emit, emit_error, log, setup_streams  # noqa: E402

MODULE = 'note-taker/fetch-model'
BASE = os.environ.get('NOTE_TAKER_HF_ENDPOINT') or 'https://hf-mirror.com'
REPO = 'Systran/faster-whisper-{model}'
FILES = ('model.bin', 'config.json', 'tokenizer.json', 'vocabulary.txt')

# 各档位 model.bin 的预期大小（字节），用于判断下载是否完整；只做下限校验
MIN_BYTES = {'tiny': 60_000_000, 'base': 120_000_000, 'small': 400_000_000, 'medium': 1_400_000_000}


def download(url, target, min_bytes=0):
    expected = os.path.getsize(target) if os.path.exists(target) else 0
    if expected and expected >= min_bytes:
        return expected

    tmp = f'{target}.part'
    request = urllib.request.Request(url, headers={'User-Agent': 'dsh-note-taker'})
    started = time.time()
    written = 0
    with urllib.request.urlopen(request, timeout=60) as response, open(tmp, 'wb') as handle:
        while True:
            chunk = response.read(1 << 20)
            if not chunk:
                break
            handle.write(chunk)
            written += len(chunk)
            if written // (5 << 20) != (written - len(chunk)) // (5 << 20):
                rate = written / max(time.time() - started, 0.001) / 1024
                log(MODULE, '下载进度', file=os.path.basename(target), mb=round(written / 1e6, 1), rateKBps=round(rate))
    os.replace(tmp, target)
    return written


def main():
    setup_streams()
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', default='tiny')
    parser.add_argument('--out-dir', required=True)
    args = parser.parse_args()

    target_dir = os.path.abspath(os.path.join(args.out_dir, f'faster-whisper-{args.model}'))
    os.makedirs(target_dir, exist_ok=True)
    repo = REPO.format(model=args.model)

    log(MODULE, '开始下载模型', model=args.model, dir=target_dir, endpoint=BASE)
    try:
        for name in FILES:
            url = f'{BASE}/{repo}/resolve/main/{name}'
            size = download(url, os.path.join(target_dir, name), MIN_BYTES.get(args.model, 0) if name == 'model.bin' else 1)
            log(MODULE, '文件就绪', file=name, bytes=size)
    except Exception as error:
        emit_error('E_MODEL', '模型下载失败', model=args.model, error=str(error), endpoint=BASE)

    emit({'ok': True, 'model': args.model, 'dir': target_dir, 'files': list(FILES)})


if __name__ == '__main__':
    main()
