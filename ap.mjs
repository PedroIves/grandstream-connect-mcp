import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import ssh2 from 'ssh2';

const deviceFile = new URL('./device.local.json', import.meta.url);
const prompt = 'Select by pressing the [number] or [letter] and then ENTER';
const menu = {
  status: ['1', 'GWN7672 Status'],
  access_points: ['2', 'Access Points'],
  ssids: ['3', 'SSIDs'],
  clients: ['4', 'Clients'],
  radios: ['10', 'Radio Configuration'],
  dhcp: ['6', 'VLAN'],
  mesh: ['7', 'Mesh'],
};

export function screenText(raw) {
  return raw.replace(/\x1b\[\d+(?:;\d+)?[Hf]/g, '\n')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r/g, '')
    .split('\n').map(line => line.trimEnd()).filter(line => line.trim()).join('\n');
}

function readScreen(channel, title, key) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => finish(new Error('Tempo limite aguardando a tela ' + title)), 4500);
    function finish(error, result) {
      clearTimeout(timer);
      channel.off('data', onData).off('close', onClose).off('error', finish);
      if (error) reject(error);
      else resolve(result);
    }
    function onClose() {
      finish(new Error('Sessão SSH encerrada antes de receber ' + title));
    }
    function onData(chunk) {
      buffer += chunk.toString('utf8');
      if (buffer.length > 128 * 1024) return finish(new Error('Tela excedeu o limite de leitura'));
      const screen = screenText(buffer);
      const lines = screen.split('\n');
      if (lines.at(-1) !== prompt) return;
      const titleIndex = lines.findIndex(line => line === title ||
        line.startsWith(title + ' (') || line.startsWith(title + '  '));
      if (titleIndex < 0 || !/^GWN7672\([^)]*\) - /m.test(screen)) {
        return finish(new Error('Tela inesperada durante a navegação para ' + title));
      }
      finish(null, lines.slice(titleIndex, -1).join('\n'));
    }
    channel.on('data', onData).once('close', onClose).once('error', finish);
    if (key !== undefined) channel.write(key + '\r', error => {
      if (error) finish(error);
    });
  });
}

let queue = Promise.resolve();
export function query(section) {
  const result = queue.then(() => readSection(section));
  queue = result.catch(() => {});
  return result;
}

async function readSection(section) {
  if (!Object.hasOwn(menu, section)) throw new Error('Consulta desconhecida');
  const privateKey = process.env.GWN_SSH_KEY
    ? await readFile(process.env.GWN_SSH_KEY) : undefined;
  const password = process.env.GWN_SSH_PASSWORD || undefined;
  if (!privateKey && !password) {
    throw new Error('Configure GWN_SSH_KEY ou forneça GWN_SSH_PASSWORD no ambiente do processo');
  }
  const { host, port, username, fingerprint } = await readDevice();
  const connection = new ssh2.Client();
  const deadline = setTimeout(() => connection.destroy(), 20000);
  let mismatchedKey = false;
  let channel;
  try {
    await new Promise((resolve, reject) => {
      connection.on('error', reject).once('ready', resolve);
      connection.connect({
        host, port, username, readyTimeout: 7000,
        privateKey, password, passphrase: process.env.GWN_SSH_KEY_PASSPHRASE,
        hostVerifier(rawKey) {
          const actual = createHash('sha256').update(rawKey).digest();
          mismatchedKey = !timingSafeEqual(actual, fingerprint);
          return !mismatchedKey;
        },
      });
    });
    channel = await new Promise((resolve, reject) => {
      connection.shell({ term: 'xterm', cols: 180, rows: 60 }, (error, stream) => {
        if (error) reject(error);
        else resolve(stream);
      });
    });
    channel.on('error', () => {});
    await readScreen(channel, 'Main Menu');
    const [key, title] = menu[section];
    let screen = await readScreen(channel, title, key);
    if (section === 'access_points') {
      const inventory = await readScreen(channel, 'Paired Devices', '1');
      screen += '\n\n' + inventory;
    }
    if (section === 'access_points' || section === 'clients' ||
        section === 'ssids' || section === 'dhcp') {
      const listTitle = section === 'access_points' ? 'Paired Devices' : title;
      screen = await paginate(channel, listTitle, screen);
    }
    return { section, collectedAt: new Date().toISOString(), summary: summarize(section, screen), screen };
  } catch (error) {
    if (mismatchedKey) throw new Error('A chave SSH do AP não coincide com a fingerprint fixada');
    throw error;
  } finally {
    clearTimeout(deadline);
    channel?.close();
    connection.end();
  }
}

async function readDevice() {
  let device;
  try {
    device = JSON.parse(await readFile(deviceFile, 'utf8'));
  } catch {
    throw new Error('Crie device.local.json com o endereço e a fingerprint SSH verificada do AP');
  }
  const { host, port = 22, username = 'admin', fingerprint } = device ?? {};
  if (typeof host !== 'string' || !host || host !== host.trim() ||
      typeof username !== 'string' || !username || username !== username.trim() ||
      !Number.isInteger(port) || port < 1 || port > 65535 ||
      typeof fingerprint !== 'string' || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(fingerprint)) {
    throw new Error('Configuração inválida em device.local.json');
  }
  const digest = Buffer.from(fingerprint.slice(7), 'base64');
  if (digest.toString('base64').replace(/=+$/, '') !== fingerprint.slice(7)) {
    throw new Error('Fingerprint SHA-256 inválida em device.local.json');
  }
  return { host, port, username, fingerprint: digest };
}

async function paginate(channel, title, screen) {
  let tail = screen;
  for (let page = 1; /^\[x\]\s*Back[^\n]*\[n\]\s*Next Page/im.test(tail); page++) {
    if (page >= 20) throw new Error('A lista excedeu o limite de 20 páginas');
    const next = await readScreen(channel, title, 'n');
    if (next === tail) throw new Error('A CLI repetiu a página');
    screen += '\n\n' + next;
    tail = next;
  }
  return screen;
}

function summarize(section, screen) {
  if (section === 'status') {
    const field = name => screen.match(new RegExp('^\\s*' + name + ':\\s*(\\S+)', 'm'))?.[1];
    return {
      model: field('Model'),
      firmware: field('Firmware Version'),
      role: field('Role'),
      uptime: field('Uptime'),
      ethernet: [...screen.matchAll(/^(NET\d+)[^\n]*? - (disconnected|connected)\s+Uptime:\s*(\S+)/gm)]
        .map(([, port, state, uptime]) => ({ port, connected: state === 'connected', uptime })),
    };
  }
  if (section === 'clients') {
    const counts = screen.match(/^Clients[^\n]*Total:\s*(\d+)\s+Online:\s*(\d+)/m);
    if (counts) return { total: Number(counts[1]), online: Number(counts[2]) };
  }
  if (section === 'access_points') {
    const counts = screen.match(/^ *Online:\s*(\d+)\n *Offline:\s*(\d+)/m);
    if (counts) return { online: Number(counts[1]), offline: Number(counts[2]) };
  }
  return {};
}
