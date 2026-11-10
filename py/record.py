"""录音 sidecar：默认输入设备 → 16kHz 单声道 16bit WAV。

由宿主侧（lib/py.js）spawn，本脚本：
- 边录边写（不缓存全量，长会议内存不涨——plan 决策 1 与风险节）
- 读 stdin，收到 stop/q/EOF 即收尾（Windows 下子进程收不到可靠 SIGINT）
- stdout 只打一行 JSON；过程日志走 stderr

错误码：E_DEP 缺 sounddevice / E_DEVICE 无设备或设备被占用 / E_STATE 参数非法
"""

import argparse
import ctypes
import os
import threading
import time
import wave

sys_path_bootstrap = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
import sys

sys.path.insert(0, sys_path_bootstrap)

from _common import emit, emit_error, ensure_pylibs, log, setup_streams  # noqa: E402

MODULE = 'note-taker/record'
DEFAULT_SAMPLERATE = 16000
DEFAULT_CHANNELS = 1
CHUNK_SECONDS = 0.1


def list_devices(sd):
    devices = []
    for index, device in enumerate(sd.query_devices()):
        if device.get('max_input_channels', 0) > 0:
            devices.append({'index': index, 'name': device.get('name', '?')})
    return devices


def main():
    setup_streams()
    ensure_pylibs()

    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True)
    parser.add_argument('--device', default=None, help='设备索引或名称；缺省用默认输入设备')
    parser.add_argument('--samplerate', type=int, default=DEFAULT_SAMPLERATE)
    parser.add_argument('--channels', type=int, default=DEFAULT_CHANNELS)
    args = parser.parse_args()

    if args.samplerate <= 0 or args.channels <= 0:
        emit_error('E_STATE', '采样率与声道数必须为正数', samplerate=args.samplerate, channels=args.channels)

    try:
        import sounddevice as sd
    except Exception as error:  # ImportError 或 DLL 载入失败都算依赖问题
        emit_error('E_DEP', '缺少录音依赖 sounddevice，请先执行 node scripts/install-py.mjs', error=str(error))

    try:
        inputs = list_devices(sd)
    except Exception as error:
        emit_error('E_DEVICE', '枚举输入设备失败', error=str(error))
    if not inputs:
        emit_error('E_DEVICE', '没有可用的输入设备', hint='接一个麦克风或在系统设置里启用录音设备')

    out_path = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    device = args.device
    if device is not None and device.isdigit():
        device = int(device)

    stop_event = threading.Event()

    def watch_stdin():
        for line in sys.stdin:
            if line.strip().lower() in ('stop', 'q', 'quit'):
                break
        stop_event.set()

    threading.Thread(target=watch_stdin, daemon=True).start()

    block_frames = int(args.samplerate * CHUNK_SECONDS)
    written = 0

    try:
        with wave.open(out_path, 'wb') as wav:
            wav.setnchannels(args.channels)
            wav.setsampwidth(2)
            wav.setframerate(args.samplerate)

            with sd.RawInputStream(
                samplerate=args.samplerate,
                channels=args.channels,
                dtype='int16',
                blocksize=block_frames,
                device=device,
            ) as stream:
                device_name = str(sd.query_devices(device)['name']) if device is not None else 'default'
                log(MODULE, '录音开始', device=device_name, sampleRate=args.samplerate, path=out_path)
                started = time.time()

                while not stop_event.is_set():
                    chunk, overflowed = stream.read(block_frames)
                    data = bytes(chunk)
                    if overflowed:
                        log(MODULE, '录音缓冲溢出（不影响写入，可能丢帧）')
                    wav.writeframes(data)
                    written += len(data)
    except Exception as error:
        # PortAudioError 的典型来源：设备被占用、不支持该采样率
        if os.path.exists(out_path) and os.path.getsize(out_path) <= 44:
            try:
                os.remove(out_path)
            except OSError:
                pass
        emit_error('E_DEVICE', '录音失败：设备不可用或参数不被支持', error=str(error))

    elapsed = round(time.time() - started, 2)
    frames = written // (2 * args.channels)
    duration = round(frames / args.samplerate, 2)

    log(MODULE, '录音结束', duration=duration, bytes=written, elapsed=elapsed)
    emit({
        'ok': True,
        'path': out_path,
        'durationSec': duration,
        'bytes': written,
        'sampleRate': args.samplerate,
        'channels': args.channels,
        'deviceCandidates': [item['name'] for item in inputs],
    })


if __name__ == '__main__':
    main()
