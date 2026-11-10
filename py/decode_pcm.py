"""把任意音频解码成 16kHz 单声道 s16le 裸 PCM，供云端 ASR 推流使用。

为什么要这一步：云端接口要求单声道 PCM 帧，而输入可能是 m4a/mp3/48k 立体声。
PyAV（faster-whisper 的依赖）已经在本机，用它解码 + 重采样，不新增任何 Python 依赖。

stdout 一行 JSON；过程日志走 stderr。
错误码：E_AUDIO 文件不可读/解码失败
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from _common import emit, emit_error, log, setup_streams  # noqa: E402

MODULE = 'note-taker/decode-pcm'


def decode_with_av(audio, out_path, sample_rate):
    import av

    container = av.open(audio)
    stream = container.streams.audio[0]
    resampler = av.AudioResampler(format='s16', layout='mono', rate=sample_rate)

    written = 0
    with open(out_path, 'wb') as handle:
        for frame in container.decode(stream):
            for out_frame in resampler.resample(frame):
                data = out_frame.to_ndarray().tobytes()
                handle.write(data)
                written += len(data)
        for out_frame in resampler.resample(None):
            data = out_frame.to_ndarray().tobytes()
            handle.write(data)
            written += len(data)
    container.close()
    return written


def decode_fallback(audio, out_path, sample_rate):
    """AudioResampler 不可用时的手工路径：逐帧取单声道 + 线性插值重采样。"""
    import av
    import numpy as np

    container = av.open(audio)
    stream = container.streams.audio[0]
    written = 0
    carry = np.zeros(0, dtype=np.float32)
    carry_pos = 0.0

    with open(out_path, 'wb') as handle:
        for frame in container.decode(stream):
            arr = frame.to_ndarray()
            if arr.ndim == 2 and arr.shape[0] > 1:
                mono = arr.mean(axis=0)
            elif arr.ndim == 2 and frame.channels and frame.channels > 1:
                mono = arr.reshape(-1, frame.channels).mean(axis=1)
            else:
                mono = arr.reshape(-1)

            src_rate = frame.sample_rate or stream.rate
            step = src_rate / sample_rate
            positions = np.arange(carry_pos, len(mono), step)
            if positions.size == 0:
                carry = np.concatenate([carry, mono])
                continue
            sampled = np.interp(positions, np.arange(len(mono)), mono)
            carry_pos = positions[-1] + step - len(mono)
            carry = mono[int(positions[-1]) + 1 :] if positions[-1] + 1 < len(mono) else np.zeros(0, dtype=np.float32)
            data = np.clip(sampled * 32767.0, -32768, 32767).astype(np.int16).tobytes()
            handle.write(data)
            written += len(data)
    container.close()
    return written


def main():
    setup_streams()
    parser = argparse.ArgumentParser()
    parser.add_argument('--audio', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--sample-rate', type=int, default=16000)
    args = parser.parse_args()

    if not os.path.exists(args.audio):
        emit_error('E_AUDIO', '找不到音频文件', audio=args.audio)

    log(MODULE, '开始解码', audio=os.path.basename(args.audio), sampleRate=args.sample_rate)
    try:
        written = decode_with_av(args.audio, args.out, args.sample_rate)
    except Exception as primary_error:
        log(MODULE, 'AudioResampler 不可用，改用手工重采样', error=str(primary_error)[:200])
        try:
            written = decode_fallback(args.audio, args.out, args.sample_rate)
        except Exception as fallback_error:
            emit_error('E_AUDIO', '音频解码失败', audio=args.audio, error=str(fallback_error)[:300])

    if written == 0:
        emit_error('E_AUDIO', '解码结果为空（可能不是有效音频）', audio=args.audio)

    duration = round(written / (args.sample_rate * 2), 2)
    log(MODULE, '解码完成', bytes=written, duration=duration)
    emit({'ok': True, 'out': os.path.abspath(args.out), 'bytes': written, 'sampleRate': args.sample_rate, 'durationSec': duration})


if __name__ == '__main__':
    main()
