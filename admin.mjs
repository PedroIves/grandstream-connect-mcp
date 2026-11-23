import { randomUUID } from 'node:crypto';
import { openCli, screenText } from './ap.mjs';

const idleMs = 120000;
const lifetimeMs = 20 * 60 * 1000;
const captureLimit = 128 * 1024;

export function createAdmin(approve, connect = openCli) {
  let session;
  let busy = false;

  function close(current = session) {
    if (!current || current !== session) return;
    session = undefined;
    clearTimeout(current.idle);
    clearTimeout(current.expiry);
    current.channel.off('data', current.receive);
    current.close();
  }

  function touch(current) {
    clearTimeout(current.idle);
    current.idle = setTimeout(() => close(current), idleMs);
    current.idle.unref();
  }

  async function exclusive(action) {
    if (busy) throw new Error('An administration request is already in progress');
    busy = true;
    try {
      return await action();
    } finally {
      busy = false;
    }
  }

  function get(id) {
    if (!session || session.id !== id) throw new Error('The administration session is closed or expired');
    return session;
  }

  function view(current) {
    return {
      sessionId: current.id,
      revision: current.revision,
      screen: visibleScreen(current.buffer),
    };
  }

  return {
    open: () => exclusive(async () => {
      if (session) throw new Error('Close the existing administration session first');
      const connection = await connect();
      const current = { ...connection, id: randomUUID(), revision: 0, buffer: '', receivedAt: 0 };
      session = current;
      current.receive = chunk => {
        current.buffer += chunk.toString('utf8');
        current.revision++;
        current.receivedAt = Date.now();
        if (current.buffer.length > captureLimit) close(current);
      };
      current.channel.on('data', current.receive);
      current.channel.once('close', () => close(current));
      current.channel.once('error', () => close(current));
      current.expiry = setTimeout(() => close(current), lifetimeMs);
      current.expiry.unref();
      touch(current);
      try {
        await settle(current, 0);
        const result = view(get(current.id));
        if (!/^GWN7672\([^)]*\) - /m.test(result.screen) ||
            !/^Main Menu$/m.test(result.screen) ||
            !/^Select by pressing the \[number\] or \[letter\] and then ENTER$/m.test(result.screen)) {
          throw new Error('Expected the Grandstream GWN7672 main menu');
        }
        return result;
      } catch (error) {
        close(current);
        throw error;
      }
    }),
    screen: id => exclusive(() => {
      const current = get(id);
      touch(current);
      return view(current);
    }),
    input: ({ sessionId, revision, line, purpose }, signal) => exclusive(async () => {
      const current = get(sessionId);
      validateInput(line);
      if (current.revision !== revision) throw new Error('The screen changed. Read it again before continuing');
      touch(current);
      const approved = await approve({
        target: current.target, screen: view(current).screen, line, purpose,
      }, signal);
      if (!approved || signal?.aborted) throw new Error('The operator did not approve this input');
      if (get(sessionId).revision !== revision) throw new Error('The screen changed during approval. Read it again');
      current.buffer = '';
      try {
        current.channel.write(line + '\r');
        await settle(current, revision);
        const result = view(get(sessionId));
        touch(current);
        return result;
      } catch {
        const lastOutput = visibleScreen(current.buffer);
        close(current);
        return {
          sessionId, closed: true, screen: lastOutput,
          warning: 'Input may have reached the AP. Verify the result before repeating it.',
        };
      }
    }),
    close: id => exclusive(() => {
      close(get(id));
      return { closed: true };
    }),
  };
}

function validateInput(line) {
  if (typeof line !== 'string' || Buffer.byteLength(line) > 512 ||
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(line)) {
    throw new Error('Send one printable menu input, without newline or terminal control characters');
  }
}

async function settle(current, previousRevision) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if (current.channel.destroyed) throw new Error('The SSH channel closed');
    if (current.revision > previousRevision && Date.now() - current.receivedAt >= 400) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('No stable CLI response was received');
}

function visibleScreen(raw) {
  return screenText(raw)
    .replace(/[\p{Cc}\p{Cf}]/gu, value => value === '\n' || value === '\t' ? value : '')
    .split('\n')
    .map(line => line.replace(/((?:password|passphrase|pre-shared key|psk|secret|community string)\s*[:=]).*$/i, '$1 [redacted]'))
    .join('\n');
}
