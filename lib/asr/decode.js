/**
 * 音频解码（Python 侧） —— 复用既有 py/decode_pcm.py。
 *
 * 说明：本文件保留最小面，供服务层在云端路径上取 16kHz 单声道 PCM。
 * 解码实现仍在 Python（PyAV），Node 侧只做进程边界与错误归一。
 *
 * @module dsh-note-taker/asr/decode
 */
export { decodeToPcm } from './pcm.js'
