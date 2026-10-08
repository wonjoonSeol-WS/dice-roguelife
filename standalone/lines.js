// A streamed body read line by line (\r\n or \n), shared by the relay (SSE from providers) and the page (the
// relay's own event lines).
export async function readLines(body, onLine, maxLine = 2000000) {
  const reader = body.getReader(),
    decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      if (buffer.length > maxLine)
        throw Object.assign(new Error('A stream line is too large.'), { code: 'output_limit' });
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        onLine(buffer.slice(0, end).replace(/\r$/, ''));
        buffer = buffer.slice(end + 1);
      }
      if (chunk.done) break;
    }
    if (buffer) onLine(buffer.replace(/\r$/, ''));
  } finally {
    await reader.cancel().catch(() => {});
  }
}
