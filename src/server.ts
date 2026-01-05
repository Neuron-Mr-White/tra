import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { html } from 'hono/html';
import { config } from './config.js';
import { CommandManager } from './commands.js';
import { getQR } from './wa.js';

const app = new Hono();

// Auth Middleware
app.use('*', async (c, next) => {
    const path = c.req.path;
    if (path === '/' || path === '/login' || path === '/api/login') {
        return next();
    }

    const apiKey = c.req.header('x-api-key') || c.req.query('key');
    // Check cookie too? For dashboard simple access.
    // We'll trust API KEY in query param for simplicity or header.
    // For dashboard, we might want a cookie logic or just pass ?key=... everywhere (ugly).
    // Let's implement a simple cookie session or just ask user to input key which sets a cookie.

    const cookieKey = c.req.header('cookie')?.match(/tra_key=([^;]+)/)?.[1];

    if (apiKey === config.TRA_API_KEY || cookieKey === config.TRA_API_KEY) {
        return next();
    }

    if (path.startsWith('/api')) {
        return c.json({ error: 'Unauthorized' }, 401);
    }

    return c.redirect('/');
});

// Login Page
app.get('/', (c) => {
    return c.html(html`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>TRA Login</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-gray-900 text-white h-screen flex items-center justify-center">
      <div class="bg-gray-800 p-8 rounded shadow-lg w-96">
        <h1 class="text-2xl mb-4 font-bold text-center">TRA Verification</h1>
        <form action="/login" method="post" class="space-y-4">
           <input type="password" name="key" placeholder="Enter TRA_API_KEY" class="w-full p-2 rounded bg-gray-700 border border-gray-600 focus:border-green-500 outline-none text-white">
           <button type="submit" class="w-full p-2 bg-green-600 rounded hover:bg-green-500 font-bold">Login</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

app.post('/login', async (c) => {
    const body = await c.req.parseBody();
    const key = body['key'];
    if (key === config.TRA_API_KEY) {
        c.header('Set-Cookie', `tra_key=${key}; Path=/; HttpOnly; Max-Age=86400`);
        return c.redirect('/dashboard');
    }
    return c.redirect('/?error=invalid');
});

// Helper to render command list
function renderCommandList(commands: any[]) {
    return html`
         <div id="command-list" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            ${commands.map(cmd => html`
               <div class="bg-gray-800 p-6 rounded border border-gray-700 hover:border-green-500 transition relative group">
                  <div class="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition">
                      <button @click='openEdit(${JSON.stringify(cmd)})' class="text-blue-400 hover:text-blue-300 p-1">✏️</button>
                      <button 
                          hx-delete="/api/commands/${encodeURIComponent(cmd.key)}" 
                          hx-confirm="Delete ${cmd.key}?" 
                          hx-target="#command-list" 
                          hx-swap="outerHTML"
                          class="text-red-400 hover:text-red-300 p-1">
                          🗑️
                      </button>
                  </div>

                  <div class="mb-2">
                     <h3 class="text-lg font-bold text-green-400">/${cmd.key}</h3>
                     <p class="text-sm text-gray-400">${cmd.description || 'No description'}</p>
                  </div>
                  <div class="text-xs text-gray-500 bg-gray-900 p-2 rounded mb-4 break-all font-mono">
                     POST ${cmd.urlCall}
                  </div>
                  
                  <div>
                     <p class="text-xs font-semibold text-gray-300 uppercase mb-1">Arguments (${cmd.args.length})</p>
                     <ul class="text-xs space-y-1 max-h-32 overflow-y-auto">
                        ${cmd.args.map((a: any) => html`
                           <li class="flex gap-2 items-center">
                              <span class="text-blue-300 font-mono">--${a.argKey}</span>
                              ${a.argKeyAlias ? html`<span class="text-gray-500">(-${a.argKeyAlias})</span>` : ''}
                              ${a.required ? html`<span class="text-red-500 font-bold" title="Required">*</span>` : ''}
                              ${a.defaultValue ? html`<span class="text-gray-600 text-[10px] ml-auto">Def: ${a.defaultValue}</span>` : ''}
                           </li>
                        `)}
                     </ul>
                  </div>
               </div>
            `)}
         </div>
  `;
}

// Dashboard
app.get('/dashboard', (c) => {
    const commands = CommandManager.list();

    // Return only partial if requested
    if (c.req.query('fragment') === 'list') {
        return c.html(renderCommandList(commands));
    }

    return c.html(html`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>TRA Dashboard</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <script src="https://unpkg.com/alpinejs" defer></script>
      <script src="https://unpkg.com/htmx.org@1.9.10"></script>
      <script>
        document.addEventListener('alpine:init', () => {
            Alpine.data('commandForm', () => ({
                showModal: false,
                isEdit: false,
                oldKey: null,
                form: {
                    key: '',
                    description: '',
                    urlCall: '',
                    args: []
                },
                
                initModal() {
                    this.showModal = false;
                    this.resetForm();
                },

                openAdd() {
                    this.resetForm();
                    this.isEdit = false;
                    this.showModal = true;
                },

                openEdit(cmd) {
                    this.form = JSON.parse(JSON.stringify(cmd));
                    this.oldKey = cmd.key;
                    this.isEdit = true;
                    this.showModal = true;
                },

                resetForm() {
                    this.oldKey = null;
                    this.form = {
                        key: '',
                        description: '',
                        urlCall: '',
                        args: []
                    };
                },

                addArg() {
                    this.form.args.push({
                        argKey: '',
                        argKeyAlias: '',
                        required: false,
                        defaultValue: '',
                        description: ''
                    });
                },

                removeArg(index) {
                    this.form.args.splice(index, 1);
                },

                async save() {
                    try {
                        const res = await fetch('/api/commands/save', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                oldKey: this.oldKey,
                                command: this.form
                            })
                        });
                        
                        if (res.ok) {
                            this.showModal = false;
                            // Trigger HTMX refresh of list
                            htmx.ajax('GET', '/dashboard?fragment=list', '#command-list');
                        } else {
                            const text = await res.text();
                            alert('Error saving: ' + text);
                        }
                    } catch (e) {
                         alert('Error: ' + e.message);
                    }
                }
            }))
        });
      </script>
    </head>
    <body class="bg-gray-900 text-white min-h-screen" x-data="commandForm">
      
      <!-- Navbar -->
      <nav class="bg-gray-800 p-4 shadow mb-8">
         <div class="container mx-auto flex justify-between items-center">
            <h1 class="text-2xl font-bold text-green-500">TRA Admin</h1>
            <div class="flex gap-4 items-center">
                <div hx-get="/api/qr-status" hx-trigger="load, every 5s" hx-swap="innerHTML">
                    <span class="text-xs text-gray-400">Checking status...</span>
                </div>
                <a href="/" class="text-sm bg-red-600 px-3 py-1 rounded">Logout</a>
            </div>
         </div>
      </nav>

      <div class="container mx-auto px-4">
         
         <div class="flex justify-between items-center mb-6">
            <h2 class="text-xl font-semibold">Registered Commands</h2>
            <button @click="openAdd()" class="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded shadow flex items-center gap-2">
               <span>+ Add Command</span>
            </button>
         </div>

         <!-- Command List Container -->
         ${renderCommandList(commands)}

      </div>

      <!-- Add/Edit Modal -->
      <div x-show="showModal" class="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" style="display: none;" x-transition>
         <div class="bg-gray-800 rounded w-full max-w-2xl max-h-[90vh] overflow-y-auto" @click.outside="showModal = false">
            <div class="p-6 border-b border-gray-700 flex justify-between items-center sticky top-0 bg-gray-800 z-10">
                <h3 class="text-lg font-bold" x-text="isEdit ? 'Edit Command' : 'Register New Command'"></h3>
                <button @click="showModal = false" class="text-gray-400 hover:text-white">✕</button>
            </div>
            
            <div class="p-6 space-y-6">
                <!-- Core Info -->
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div class="col-span-1">
                        <label class="block text-xs font-bold text-gray-400 uppercase mb-1">Command Key (/)</label>
                        <input type="text" x-model="form.key" class="w-full bg-gray-900 border border-gray-700 p-2 rounded text-sm text-white focus:border-green-500 outline-none" placeholder="e.g. trigger deploy">
                    </div>
                    <div class="col-span-1">
                        <label class="block text-xs font-bold text-gray-400 uppercase mb-1">Webhook URL (POST)</label>
                        <input type="url" x-model="form.urlCall" class="w-full bg-gray-900 border border-gray-700 p-2 rounded text-sm text-white focus:border-green-500 outline-none" placeholder="https://api.example.com/...">
                    </div>
                    <div class="col-span-1 md:col-span-2">
                        <label class="block text-xs font-bold text-gray-400 uppercase mb-1">Description</label>
                        <input type="text" x-model="form.description" class="w-full bg-gray-900 border border-gray-700 p-2 rounded text-sm text-white focus:border-green-500 outline-none" placeholder="Brief description of what this does">
                    </div>
                </div>

                <!-- Arguments -->
                <div class="border-t border-gray-700 pt-4">
                    <div class="flex justify-between items-center mb-4">
                        <label class="block text-sm font-bold text-gray-300">Arguments</label>
                        <button type="button" @click="addArg()" class="text-xs bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded text-white flex items-center gap-1">
                            <span>+ Add Arg</span>
                        </button>
                    </div>

                    <div class="space-y-3">
                        <template x-for="(arg, index) in form.args" :key="index">
                            <div class="bg-gray-900 p-3 rounded border border-gray-700 relative">
                                <button type="button" @click="removeArg(index)" class="absolute top-2 right-2 text-red-500 hover:text-red-400 text-xs">✕</button>
                                
                                <div class="grid grid-cols-6 gap-2 mb-2">
                                    <div class="col-span-2">
                                        <label class="block text-[10px] text-gray-500 uppercase">Key</label>
                                        <input type="text" x-model="arg.argKey" class="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs" placeholder="id">
                                    </div>
                                    <div class="col-span-1">
                                        <label class="block text-[10px] text-gray-500 uppercase">Alias</label>
                                        <input type="text" x-model="arg.argKeyAlias" class="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs" placeholder="i">
                                    </div>
                                    <div class="col-span-3">
                                        <label class="block text-[10px] text-gray-500 uppercase">Description</label>
                                        <input type="text" x-model="arg.description" class="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs" placeholder="What is this?">
                                    </div>
                                </div>
                                <div class="grid grid-cols-6 gap-2 items-center">
                                    <div class="col-span-3">
                                        <label class="block text-[10px] text-gray-500 uppercase">Default Value</label>
                                        <input type="text" x-model="arg.defaultValue" class="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs" placeholder="Optional default">
                                    </div>
                                    <div class="col-span-3 flex items-center gap-2 pt-4">
                                        <input type="checkbox" x-model="arg.required" class="w-4 h-4 rounded bg-gray-800 border-gray-600 text-green-500 focus:ring-offset-gray-900">
                                        <span class="text-xs text-gray-400">Required</span>
                                    </div>
                                </div>
                            </div>
                        </template>
                        <div x-show="form.args.length === 0" class="text-center py-4 text-gray-600 text-xs italic">
                            No arguments defined.
                        </div>
                    </div>
                </div>
            </div>

            <div class="p-4 border-t border-gray-700 bg-gray-800 flex justify-end gap-2 sticky bottom-0">
               <button type="button" @click="showModal = false" class="px-4 py-2 rounded border border-gray-600 hover:bg-gray-700 text-sm">Cancel</button>
               <button type="button" @click="save()" class="px-4 py-2 rounded bg-green-600 hover:bg-green-500 font-bold text-sm">Save Command</button>
            </div>
         </div>
      </div>

    </body>
    </html>
  `);
});

// APIs
app.get('/api/qr-status', async (c) => {
    const { toDataURL } = await import('qrcode');
    const qr = getQR();
    if (qr) {
        try {
            const url = await toDataURL(qr);
            return c.html(`
               <div class="flex flex-col items-center">
                   <img src="${url}" alt="Scan QR Code" class="w-48 h-48 border-4 border-white rounded mb-2" />
                   <span class="text-yellow-500 font-mono text-xs">Scan with WhatsApp</span>
               </div>
           `);
        } catch (err) {
            return c.html(`<span class="text-red-500 font-mono text-xs">Error generating QR</span>`);
        }
    }
    // Check if connected
    const { getSocket } = await import('./wa.js'); // Lazy import to avoid circular dep issues if any, though usually fine
    const sock = getSocket();
    if (sock && sock.user) {
        return c.html(`<span class="text-green-500 font-mono text-xs">● Connected as ${sock.user.id.split(':')[0]}</span>`);
    }

    return c.html(`<span class="text-gray-400 font-mono text-xs">Waiting for QR...</span>`);
});

app.post('/api/commands/register-text', async (c) => {
    const body = await c.req.parseBody();
    const text = body['commandText'] as string;

    try {
        // Strip "/command register" if present, or just try to parse if user pasted only args
        let input = text.trim();
        if (input.startsWith('/command register ')) {
            input = input.replace('/command register ', '');
        } else if (input.startsWith('register ')) {
            input = input.replace('register ', '');
        }

        const { parseRegistrationInput } = await import('./commands.js');
        const cmdDef = parseRegistrationInput(input);
        CommandManager.register(cmdDef);

        return c.redirect('/dashboard');
    } catch (e: any) {
        return c.text(`Error: ${e.message}`, 400);
    }
});

app.post('/api/commands/save', async (c) => {
    try {
        const body = await c.req.json();
        const { oldKey, command } = body;

        const { RegisterCommandSchema } = await import('./commands.js');
        // RegisterCommandSchema doesn't allow parsing 'command' object directly if it has extra props?
        // Actually Zod .parse strips unknown keys if configured, or just ignores them if strict not set.
        // We need to make sure args match schema.

        const validCmd = RegisterCommandSchema.parse(command);

        if (oldKey && oldKey !== validCmd.key) {
            CommandManager.delete(oldKey);
        }

        CommandManager.register(validCmd);
        return c.json({ success: true });
    } catch (e: any) {
        return c.text(e.message, 400);
    }
});

app.delete('/api/commands/:key', (c) => {
    const key = c.req.param('key');
    CommandManager.delete(key);
    return c.redirect('/dashboard');
});


app.post('/api/send-message', async (c) => {
    try {
        const body = await c.req.json();
        const { jid, text } = body;

        if (!jid || !text) {
            return c.json({ error: 'Missing jid or text' }, 400);
        }

        const { sendMessage } = await import('./wa.js');
        await sendMessage(jid, text);

        return c.json({ success: true });
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

export { app };
