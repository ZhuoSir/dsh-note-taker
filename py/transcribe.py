"""转写 sidecar：faster-whisper 本机转写 → transcripts/<stem>.md + .json。

由宿主侧（lib/py.js）spawn。约定：
- stdout 一行 JSON 结果；过程日志走 stderr
- md 的格式必须能被 lib/parse.js 解析：`[HH:MM:SS] 正文`
- 失败不覆盖既有产物：先写临时文件再原子替换

错误码：E_DEP 缺 faster_whisper / E_AUDIO 音频不可读 / E_MODEL 模型不可用 / E_STATE 参数非法
"""

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from _common import emit, emit_error, ensure_pylibs, log, setup_streams  # noqa: E402

MODULE = 'note-taker/transcribe'
SUPPORTED_MODELS = ('tiny', 'base', 'small', 'medium')
DEFAULT_HF_ENDPOINT = 'https://hf-mirror.com'


def apply_hf_endpoint():
    """hf.co 在国内常连不上（lessons L-08）：默认走镜像，可用 NOTE_TAKER_HF_ENDPOINT 覆盖。"""
    if os.environ.get('HF_ENDPOINT'):
        return os.environ['HF_ENDPOINT']
    endpoint = os.environ.get('NOTE_TAKER_HF_ENDPOINT') or DEFAULT_HF_ENDPOINT
    os.environ['HF_ENDPOINT'] = endpoint
    return endpoint


def format_timestamp(seconds):
    total = int(seconds)
    return f'{total // 3600:02d}:{total % 3600 // 60:02d}:{total % 60:02d}'


def write_atomic(path, text):
    tmp = f'{path}.tmp'
    with open(tmp, 'w', encoding='utf-8') as handle:
        handle.write(text)
    os.replace(tmp, path)


def main():
    setup_streams()
    ensure_pylibs()

    parser = argparse.ArgumentParser()
    parser.add_argument('--audio', required=True)
    parser.add_argument('--out-dir', required=True)
    parser.add_argument('--stem', default=None, help='产物文件名（不含扩展名），缺省取音频文件名')
    parser.add_argument('--model', default='small')
    parser.add_argument('--language', default='zh')
    parser.add_argument('--prompt', default=None, help='术语/参会人提示，提升专有名词准确率')
    parser.add_argument('--threads', type=int, default=6)
    parser.add_argument('--model-dir', default=None, help='本地模型根目录（其下 faster-whisper-<model>/ 存在则优先使用）')
    args = parser.parse_args()

    if args.model not in SUPPORTED_MODELS:
        emit_error('E_STATE', f'不支持的模型档位: {args.model}', supported=list(SUPPORTED_MODELS))
    if not os.path.exists(args.audio):
        emit_error('E_AUDIO', '找不到音频文件', audio=args.audio)

    try:
        from faster_whisper import WhisperModel
    except Exception as error:
        emit_error('E_DEP', '缺少转写依赖 faster-whisper', error=str(error))

    stem = args.stem or os.path.splitext(os.path.basename(args.audio))[0]
    os.makedirs(args.out_dir, exist_ok=True)
    md_path = os.path.join(args.out_dir, f'{stem}.md')
    json_path = os.path.join(args.out_dir, f'{stem}.json')

    log(MODULE, '转写开始', model=args.model, audio=os.path.basename(args.audio), threads=args.threads, hfEndpoint=apply_hf_endpoint())
    started = time.time()

    # 优先用本地模型目录：绕开运行时 Hub 下载（lessons L-08）
    local_model = os.path.join(args.model_dir, f'faster-whisper-{args.model}') if args.model_dir else None
    model_ref = local_model if local_model and os.path.exists(os.path.join(local_model, 'model.bin')) else args.model
    if local_model and model_ref != args.model:
        log(MODULE, '使用本地模型目录', dir=local_model)

    try:
        model = WhisperModel(model_ref, device='cpu', compute_type='int8', cpu_threads=args.threads)
    except Exception as error:
        emit_error('E_MODEL', '转写模型加载失败（首次使用需要能下载模型）', model=args.model, error=str(error))

    try:
        segments_iter, info = model.transcribe(
            args.audio,
            language=None if args.language == 'auto' else args.language,
            vad_filter=True,
            vad_parameters={'min_silence_duration_ms': 500},
            initial_prompt=args.prompt,
            beam_size=5,
        )
        segments = [
            {'start': round(segment.start, 2), 'end': round(segment.end, 2), 'text': (segment.text or '').strip()}
            for segment in segments_iter
        ]
    except Exception as error:
        emit_error('E_AUDIO', '音频解码或转写失败', audio=args.audio, error=str(error))

    elapsed = round(time.time() - started, 1)
    duration = round(segments[-1]['end'], 2) if segments else 0.0
    chars = sum(len(segment['text']) for segment in segments)
    rtf = round(elapsed / duration, 3) if duration > 0 else None

    lines = [f'# 转写：{stem}', '']
    lines += [f"[{format_timestamp(segment['start'])}] {segment['text']}" for segment in segments]
    write_atomic(md_path, '\n'.join(lines) + '\n')

    payload = {
        'ok': True,
        'stem': stem,
        'model': args.model,
        'language': info.language,
        'durationSec': duration,
        'segments': len(segments),
        'chars': chars,
        'rtf': rtf,
        'elapsedSec': elapsed,
        'mdPath': md_path,
        'jsonPath': json_path,
        'detail': segments,
    }
    write_atomic(json_path, json.dumps(payload, ensure_ascii=False, indent=2) + '\n')

    log(MODULE, '转写结束', segments=len(segments), chars=chars, rtf=rtf, elapsed=elapsed)
    emit({key: value for key, value in payload.items() if key != 'detail'})


if __name__ == '__main__':
    main()
