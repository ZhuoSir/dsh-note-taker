/**
 * 对外工具定义（R-07）。
 *
 * 工具只做三件事：校验必要参数、调 service、把信封序列化成文本返回。
 * 真正的状态校验在 service 里，工具层不重复判断——避免两处规则不一致。
 *
 * @module dsh-note-taker/tools
 */

const asText = (envelope) => JSON.stringify(envelope)

export function buildTools({ service }) {
  return [
    {
      name: 'meeting_record_start',
      description: '开始本地录音（会记）。录的是默认输入设备，16kHz 单声道，落盘到数据目录的 recordings/ 下。停止前会一直录。',
      parameters: {
        label: { type: 'string', required: false, description: '可选标签，如「周会」「需求评审」，不超过 60 字' },
      },
      output: { type: 'text' },
      execute: (args = {}) => asText(service.recordStart({ label: args.label ?? '' })),
    },
    {
      name: 'meeting_record_stop',
      description: '停止当前录音，返回时长与音频路径。',
      parameters: {},
      output: { type: 'text' },
      execute: () => asText(service.recordStop()),
    },
    {
      name: 'meeting_transcribe',
      description: '转写某次会议的录音：engine=local 用本机 faster-whisper，engine=cloud 用阿里云百炼（音频会上传云端）。缺省对最近一次会议转写。',
      parameters: {
        meetingId: { type: 'string', required: false, description: '会议 id；缺省取最近一次' },
        model: { type: 'string', required: false, description: '本机模型档位 tiny/base/small/medium（仅 engine=local 时有意义）' },
        engine: { type: 'string', required: false, description: 'local | cloud；缺省取配置 NOTE_TAKER_ASR_ENGINE（默认 local）' },
      },
      output: { type: 'text' },
      execute: (args = {}) => asText(service.transcribe({ meetingId: args.meetingId, model: args.model, engine: args.engine })),
    },
    {
      name: 'meeting_minutes',
      description: '把某次会议的转写整理成会议纪要（调用你在 DSH 里已配置的模型）。结构不合格不会落盘。已生成过则直接返回既有纪要，force=true 可重生成。',
      parameters: {
        meetingId: { type: 'string', required: false, description: '会议 id；缺省取最近一次' },
        force: { type: 'boolean', required: false, description: '已有纪要时是否重新生成' },
      },
      output: { type: 'text' },
      execute: (args = {}) => asText(service.minutes({ meetingId: args.meetingId, force: args.force === true })),
    },
    {
      name: 'meeting_list',
      description: '列出最近的会议记录（时间、标签、时长、录音/转写/纪要状态）。',
      parameters: {
        limit: { type: 'number', required: false, description: '返回条数，1–100，默认 20' },
      },
      output: { type: 'text' },
      execute: (args = {}) => asText(service.list({ limit: args.limit ?? 20 })),
    },
    {
      name: 'meeting_status',
      description: '查某次会议的录音/转写/纪要状态与错误信息。',
      parameters: {
        meetingId: { type: 'string', required: true, description: '会议 id' },
      },
      output: { type: 'text' },
      execute: (args = {}) => asText(service.status({ meetingId: args.meetingId })),
    },
  ]
}
