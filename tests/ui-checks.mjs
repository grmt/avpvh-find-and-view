import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const profile = await mkdtemp(`${tmpdir()}/fav-ui-checks-`);
let browser;
let socket;
const server = await createServer({ configFile: false, root, server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
try {
  await server.listen();
  const address = server.httpServer.address();
  browser = spawn(process.env.CHROME_BIN ?? 'google-chrome', ['--headless', '--no-sandbox', '--disable-dev-shm-usage',
    '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const debuggerUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome did not start')), 15000);
    let stderr = '';
    browser.on('error', reject);
    browser.stderr.on('data', chunk => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    browser.on('exit', code => { clearTimeout(timer); reject(new Error(`Chrome exited ${code}: ${stderr.slice(-1500)}`)); });
  });
  socket = new WebSocket(debuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    if (message.error) item.reject(new Error(message.error.message)); else item.resolve(message.result);
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
    pending.set(requestId, { resolve: value => { clearTimeout(timer); resolve(value); }, reject });
    socket.send(JSON.stringify({ id: requestId, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  for (const [width, height, mobile] of [[1280, 900, false], [390, 844, true]]) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Emulation.setDeviceMetricsOverride', { width, height, mobile, deviceScaleFactor: 1 }, sessionId);
    await send('Page.navigate', { url: `http://127.0.0.1:${address.port}/tests/ui-checks.html` }, sessionId);
    const result = await send('Runtime.evaluate', { expression: `new Promise((resolve, reject) => {
      const started = Date.now(); const poll = () => {
        const state = window.__favChecks;
        if (state?.done) return resolve(state);
        if (Date.now() - started > 20000) return reject(new Error('Browser test timed out'));
        setTimeout(poll, 50);
      }; poll();
    })`, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails || result.result.value?.error) throw new Error(JSON.stringify(result.exceptionDetails ?? result.result.value));
    console.log(`PASS: ${result.result.value.checks} UI checks at ${width}x${height}`);
    await send('Target.closeTarget', { targetId });
  }
} finally {
  socket?.close();
  if (browser && browser.exitCode === null) {
    const exited = new Promise(resolve => browser.once('exit', resolve));
    browser.kill('SIGTERM');
    await exited;
  }
  await server.close();
  await rm(profile, { recursive: true, force: true });
}
