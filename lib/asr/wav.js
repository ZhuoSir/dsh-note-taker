/**
 * PCM → WAV 容器（44 字节头）。云端 HTTP 接口要 wav/mp3 这类容器格式，
 * 而分片是在裸 PCM 上做的，所以每片发送前要重新封装。
 *
 * @module dsh-note-taker/asr/wav
 */

const HEADER_SIZE = 44

export function pcmToWav(pcm, { sampleRate = 16000, channels = 1 } = {}) {
  if (!Buffer.isBuffer(pcm)) throw new TypeError('pcmToWav 需要 Buffer')

  const header = Buffer.alloc(HEADER_SIZE)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * channels * 2, 28)
  header.writeUInt16LE(channels * 2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)

  return Buffer.concat([header, pcm])
}

export { HEADER_SIZE }
