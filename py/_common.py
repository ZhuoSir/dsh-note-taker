"""会记 sidecar 公共设施：UTF-8、pylibs 注入、统一 JSON 输出与错误码。

sidecar 的约定（plan 模块与数据流）：
- stdout 只输出**一行 JSON**（结果或错误信封），宿主侧 lib/py.js 解析
- stderr 打人类可读的过程日志，由宿主侧转进结构化日志
- 编码强制 UTF-8：Windows 控制台默认 GBK 会把中文打崩（lessons L-07）
"""

import json
import os
import sys

ERROR_CODES = ('E_DEP', 'E_DEVICE', 'E_MODEL', 'E_AUDIO', 'E_STATE', 'E_LLM')


def setup_streams():
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8', errors='replace')
        except Exception:
            pass


def repo_root():
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def ensure_pylibs():
    """把仓库内 pylibs/ 加进 sys.path：离线安装的库放在这里（lessons L-02）。"""
    libs = os.path.join(repo_root(), 'pylibs')
    if os.path.isdir(libs) and libs not in sys.path:
        sys.path.insert(0, libs)
    return libs


def log(module, message, **fields):
    kv = ', '.join(f'{key}={value}' for key, value in fields.items() if value is not None)
    print(f'{module} - {message}' + (f', {kv}' if kv else ''), file=sys.stderr, flush=True)


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def emit_error(code, message, **detail):
    if code not in ERROR_CODES:
        raise SystemExit(f'未知错误码 {code}')
    emit({'ok': False, 'code': code, 'message': message, 'detail': detail})
    sys.exit(1)
