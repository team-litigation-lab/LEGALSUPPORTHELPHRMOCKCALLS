// Run by tests/run.sh. A stand-in for Google's Gemini API: auth_tokens (the agent caller's setup is logged,
// so the test can check the persona HR typed reached it), generateContent (typed calls), and a Live WebSocket.
const http = require('http');
const { WebSocketServer } = require('ws');
const log = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const j = (() => { try { return JSON.parse(body); } catch (e) { return {}; } })();
    if (req.url === '/log') { res.end(JSON.stringify(log)); return; }
    if (req.url.startsWith('/v1beta/auth_tokens')) {
      const setup = j.bidiGenerateContentSetup || {};
      log.push({ token: true, system: JSON.stringify(setup.systemInstruction || {}), voice: JSON.stringify(setup.generationConfig || {}) });
      res.end(JSON.stringify({ name: 'auth_tokens/fake' }));
      return;
    }
    if (/models\/([^:]+):generateContent/.test(req.url)) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Hi, this is Maria. When is my next appointment?' }] }, finishReason: 'STOP' }] }));
      return;
    }
    res.statusCode = 404; res.end('{}');
  });
});
const wss = new WebSocketServer({ server, path: '/live' });
wss.on('connection', (ws) => {
  let audioIn = 0;
  const tone = (secs) => { const n = 24000 * secs, b = Buffer.alloc(n * 2); for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 24000 * 2 * Math.PI * 330) * 8000), i * 2); return b.toString('base64'); };
  const speak = (text) => {
    ws.send(JSON.stringify({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: tone(0.6) } }] }, outputTranscription: { text } } }));
    ws.send(JSON.stringify({ serverContent: { turnComplete: true } }));
  };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.setup) { ws.send(JSON.stringify({ setupComplete: {} })); return; }
    if (m.realtimeInput && m.realtimeInput.audio) {
      audioIn++;
      if (audioIn === 15) { ws.send(JSON.stringify({ serverContent: { inputTranscription: { text: 'Thank you for calling Legal Support Help, this is Jamie.' } } })); speak('Hi, this is Maria. When is my next appointment?'); }
    }
    if (m.realtimeInput && m.realtimeInput.text) log.push({ live: 'text', text: m.realtimeInput.text });
  });
});
server.listen(9911, '127.0.0.1', () => console.log('mock gemini on 9911'));
