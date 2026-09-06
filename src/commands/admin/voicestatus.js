// codes by: @LouisPy
export default {
  name: 'voicestatus',
  aliases: [],
  description: 'Show voice call status.',
  usage: '!voicestatus',
  example: '!voicestatus',
  category: 'Music',
  adminOnly: true,
  groupOnly: false,
  minArgs: 0,
  async execute(ctx) {
    const voiceCall = ctx.services.voiceCall;
    if (!voiceCall || typeof voiceCall.getDiagnostics !== 'function') {
      await ctx.reply('Voice call: disconnected\nAudio pipeline: stopped\nCurrent song: none');
      return;
    }
    try {
      const diag = await voiceCall.getDiagnostics();
      await ctx.reply(formatVoiceDiagnostics(diag));
    } catch (err) {
      await ctx.reply('⚠️ Failed to get voice status.');
      ctx.services.logger?.error({ err }, 'voicestatus command failed');
    }
  },
};

export function formatVoiceDiagnostics(diag) {
  const serviceEntries = Array.isArray(diag?.service) ? diag.service : [];
  const entry = serviceEntries[0] ?? null;
  const bridge = diag?.bridge ?? null;
  const lines = [];
  if (entry?.state) {
    lines.push(`Voice call: ${entry.state}`);
  } else {
    lines.push('Voice call: disconnected');
  }
  const ctxState = bridge?.context?.ctxState ?? bridge?.ctxState ?? null;
  lines.push(`Audio pipeline: ${ctxState === 'running' ? 'running' : 'stopped'}`);
  lines.push(`Current song: ${entry?.song ?? 'none'}`);
  const bytesServed = Number(entry?.bytesSent ?? 0);
  lines.push(`PCM served: ${Number.isFinite(bytesServed) ? bytesServed : 0} bytes`);
  const call = bridge?.call ?? null;
  if (call?.state) {
    const connected = Boolean(call.isInConnectedCall ?? call.active);
    lines.push(`Call state: ${call.state} (${connected ? 'connected' : 'disconnected'})`);
  } else if (entry) {
    lines.push('Call state: unknown');
  }
  const senders = [];
  for (const pc of bridge?.rtp ?? []) {
    for (const sender of pc?.senders ?? []) {
      senders.push(`${sender.ours ? 'OURS' : 'OTHER'}:${sender.readyState ?? 'unknown'}`);
    }
  }
  if (senders.length > 0) lines.push(`Senders: ${senders.join(', ')}`);
  for (const pc of bridge?.rtp ?? []) {
    for (const out of pc?.outbound ?? []) {
      if (out?.type === 'outbound-rtp' && out.packetsSent != null) {
        lines.push(`RTP sent: ${out.packetsSent} packets, ${out.bytesSent ?? 0} bytes`);
      }
    }
  }
  const worklet = bridge?.worklet ?? null;
  if (worklet) {
    lines.push(
      `Worklet: in=${worklet.inputFrames ?? 0} out=${worklet.outputFrames ?? 0} samples=${worklet.samples ?? 0}`
    );
  }
  return lines.join('\n');
}
