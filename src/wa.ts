import makeWASocket, {
    DisconnectReason,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    type WASocket,
    type ConnectionState,
    type WAMessage
} from '@whiskeysockets/baileys';
import { pino } from 'pino';
import { CommandManager, parseArgs, parseRegistrationInput } from './commands.js';

const logger = pino({ level: 'info' });

let sock: WASocket;
let currentQR: string | undefined;

export const getQR = () => currentQR;
export const getSocket = () => sock;

export async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        logger,
    });

    sock.ev.on('connection.update', (update: Partial<ConnectionState>) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            currentQR = qr;
            logger.info('QR Code updated');
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
            logger.info({ err: lastDisconnect?.error, shouldReconnect }, 'connection closed');
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            logger.info('opened connection');
            currentQR = undefined;
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        if (m.type === 'notify') {
            for (const msg of m.messages) {
                if (!msg.key.fromMe) {
                    await handleMessage(msg);
                }
            }
        }
    });
}

// Helper to reply
const reply = async (jid: string, text: string, quoted?: WAMessage) => {
    await sock.sendMessage(jid, { text }, { quoted });
};

export async function sendMessage(jid: string, text: string) {
    if (!sock) throw new Error('WhatsApp not connected');
    await sock.sendMessage(jid, { text });
}

async function handleMessage(msg: WAMessage) {
    const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
    if (!text) return;
    const jid = msg.key.remoteJid;
    if (!jid) return;

    console.log('Received:', text);

    if (!text.startsWith('/')) return;

    const content = text.slice(1).trim(); // Remove '/'

    try {
        // 1. Built-in: /command ...
        if (content.startsWith('command ')) {
            const sub = content.slice('command '.length).trim();
            if (sub.startsWith('register ')) {
                const regInput = sub.slice('register '.length);
                const cmdDef = parseRegistrationInput(regInput);
                CommandManager.register(cmdDef);
                await reply(jid, `✅ Command "${cmdDef.key}" registered successfully!`);
            } else if (sub.startsWith('delete ')) {
                const key = sub.slice('delete '.length).trim();
                CommandManager.delete(key);
                await reply(jid, `🗑️ Command "${key}" deleted.`);
            } else if (sub === 'list') {
                const cmds = CommandManager.list();
                let resp = '📋 *Registered Commands:*\n\n';
                for (const c of cmds) {
                    resp += `*${c.key}*`;
                    if (c.description) resp += ` - ${c.description}`;
                    resp += '\n';
                    if (c.args.length > 0) {
                        resp += '  Args: ' + c.args.map(a => `--${a.argKey}${a.argKeyAlias ? ` (-${a.argKeyAlias})` : ''}`).join(', ') + '\n';
                    }
                    resp += '\n';
                }
                await reply(jid, resp);
            } else {
                await reply(jid, 'Usage: /command <register|delete|list> ...');
            }
            return;
        }

        if (content === 'help') {
            await reply(jid, `*TRA WhatsApp Bot*\n\nUsage:\n/command list\n/command register <key> ...\n/command delete <key>\n/qr (Get QR code - only if not connected?)\n\nCustom commands supported.`);
            return;
        }

        if (content === 'qr') {
            if (currentQR) {
                await reply(jid, currentQR);
            } else {
                await reply(jid, 'Already connected (no QR available).');
            }
            return;
        }

        // 2. Custom Commands
        const match = CommandManager.findBestMatch(content);
        if (match) {
            const { command, argsString } = match;
            const args = parseArgs(argsString, command.args);

            // Execute
            await reply(jid, `🔄 Executing "${command.key}"...`);

            try {
                const response = await fetch(command.urlCall, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(args)
                });

                const resText = await response.text();
                const statusEmoji = response.ok ? '✅' : '❌';

                await reply(jid, `${statusEmoji} Status: ${response.status}\nResponse: ${resText.slice(0, 500)}`); // Truncate long responses

            } catch (err: any) {
                await reply(jid, `❌ Network Error: ${err.message}`);
            }

        } else {
            // No match found
            await reply(jid, '❓ Unknown command.');
        }

    } catch (err: any) {
        console.error(err);
        await reply(jid, `⚠️ Error: ${err.message}`);
    }
}
