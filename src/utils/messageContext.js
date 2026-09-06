// codes by: @LouisPy
export function isGroupId(chatId) {
  return Boolean(chatId && chatId.endsWith('@g.us'));
}

export function createMessageContextResolver({ logger } = {}) {
  function basic(message) {
    const chatId = typeof message?.from === 'string' ? message.from : null;
    const senderId = message?.author ?? chatId;
    return {
      message,
      chat: null,
      chatId,
      isGroup: isGroupId(chatId),
      senderId,
      body: typeof message?.body === 'string' ? message.body : '',
    };
  }

  async function getChat(message) {
    if (!message || typeof message.getChat !== 'function') return null;
    try {
      const chat = await message.getChat();
      return chat || null;
    } catch (err) {
      logger?.warn(
        { err, from: message.from },
        'chat metadata lookup failed; continuing without chat info'
      );
      return null;
    }
  }

  return { basic, getChat };
}