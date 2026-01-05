import { db } from './db.js';
import { z } from 'zod';

// Schema for Command Arguments
const CommandArgSchema = z.object({
    argKey: z.string(),
    argKeyAlias: z.string().optional(),
    required: z.boolean().default(false),
    defaultValue: z.string().optional(),
    description: z.string().optional(),
});

type CommandArg = z.infer<typeof CommandArgSchema>;

interface CommandDef {
    key: string;
    description?: string;
    urlCall: string;
    args: CommandArg[];
}

// Validation for registering a command
export const RegisterCommandSchema = z.object({
    key: z.string().min(1),
    description: z.string().optional(),
    urlCall: z.string().url(),
    args: z.array(CommandArgSchema).default([]),
});

export class CommandManager {
    static register(cmd: CommandDef) {
        // Check overlapping args within the command
        const keys = new Set<string>();
        for (const arg of cmd.args) {
            if (keys.has(arg.argKey)) throw new Error(`Duplicate arg key: ${arg.argKey}`);
            keys.add(arg.argKey);
            if (arg.argKeyAlias) {
                if (keys.has(arg.argKeyAlias)) throw new Error(`Duplicate arg alias: ${arg.argKeyAlias}`);
                keys.add(arg.argKeyAlias);
            }
        }

        const stmt = db.prepare(`
      INSERT OR REPLACE INTO commands (key, description, urlCall, args)
      VALUES (@key, @description, @urlCall, @args)
    `);
        stmt.run({
            key: cmd.key,
            description: cmd.description,
            urlCall: cmd.urlCall,
            args: JSON.stringify(cmd.args),
        });
    }

    static delete(key: string) {
        const stmt = db.prepare('DELETE FROM commands WHERE key = ?');
        stmt.run(key);
    }

    static list(): CommandDef[] {
        const stmt = db.prepare('SELECT * FROM commands');
        const rows = stmt.all() as any[];
        return rows.map(row => ({
            key: row.key,
            description: row.description,
            urlCall: row.urlCall,
            args: JSON.parse(row.args),
        }));
    }

    static findBestMatch(input: string): { command: CommandDef, argsString: string } | null {
        const commands = this.list();
        // Sort by key length descending to ensure greedy matching
        commands.sort((a, b) => b.key.length - a.key.length);

        for (const cmd of commands) {
            if (input.startsWith(cmd.key)) {
                // Ensure boundary: input is exactly key OR key followed by space
                const rest = input.slice(cmd.key.length);
                if (rest.length === 0 || rest.startsWith(' ')) {
                    return { command: cmd, argsString: rest.trim() };
                }
            }
        }
        return null;
    }
}

// Argument Parser
export function parseArgs(argsString: string, commandArgs: CommandArg[]): Record<string, string> {
    const parsedArgs: Record<string, string> = {};

    // 1. Tokenize (handling quotes)
    const tokens: string[] = [];
    let currentToken = '';
    let inQuote = false;

    for (let i = 0; i < argsString.length; i++) {
        const char = argsString[i];
        if (char === '"') {
            inQuote = !inQuote;
        } else if (char === ' ' && !inQuote) {
            if (currentToken) {
                tokens.push(currentToken);
                currentToken = '';
            }
        } else {
            currentToken += char;
        }
    }
    if (currentToken) tokens.push(currentToken);

    // 2. Parse tokens
    let i = 0;
    while (i < tokens.length) {
        const token = tokens[i];
        if (token.startsWith('-')) {
            const isLong = token.startsWith('--');
            const rawKey = token.replace(/^-+/, '');

            // Find matching arg definition
            const argDef = commandArgs.find(a =>
                (isLong && a.argKey === rawKey) ||
                (!isLong && a.argKeyAlias === rawKey) ||
                (a.argKey === rawKey) // Fallback if user mixes up - and -- but matches key
            );

            if (!argDef) {
                throw new Error(`Unknown argument: ${token}`);
            }

            i++; // Move to next token (potential value)
            let value = tokens[i];

            // Check if next token is a value or another flag
            let isValue = true;
            if (!value) {
                isValue = false;
            } else if (value.startsWith('-') && !value.match(/^".*"$/) && !value.match(/^'.*'$/)) {
                // It looks like a flag, BUT check if we need a value
                // If defaultValue is present, we can skip value
                // If defaultValue is NOT present, we MUST have a value (unless boolean? user didn't specify boolean type clearly, just "defaultValue: true" example)
                // "If defaultValue present ... else user have to pass ... true"

                if (argDef.defaultValue !== undefined) {
                    isValue = false; // Assume it's the next flag, use default for current
                } else {
                    // If no default, we treat it as value? No, user said "quote them" if value has dash.
                    // So if unquoted dash, it IS a flag.
                    // Thus, missing required value.
                    throw new Error(`Argument ${token} requires a value.`);
                }
            }

            if (isValue) {
                parsedArgs[argDef.argKey] = value;
                i++; // Consume value
            } else {
                if (argDef.defaultValue !== undefined) {
                    parsedArgs[argDef.argKey] = argDef.defaultValue;
                } else {
                    throw new Error(`Argument ${token} requires a value.`);
                }
            }

        } else {
            // Positional args not explicitly supported by prompt format, but maybe? 
            // "User can use: /trigger deployment -dk 8cg6 -r"
            // Everything seems named.
            throw new Error(`Unexpected positional argument: ${token}`);
        }
    }

    // 3. Fill defaults and check required
    for (const arg of commandArgs) {
        if (!(arg.argKey in parsedArgs)) {
            if (arg.defaultValue !== undefined) {
                parsedArgs[arg.argKey] = arg.defaultValue;
            } else if (arg.required) {
                throw new Error(`Missing required argument: --${arg.argKey}`);
            }
        }
    }

    return parsedArgs;
}

export function parseRegistrationInput(input: string): CommandDef {
    // Input: "trigger deployment --description ... --urlCall ... [--argKey: ...]"

    // 1. Extract Command Key
    // Find index of first "--" or "["
    const firstFlagIndex = input.search(/--|\[/);
    if (firstFlagIndex === -1) {
        throw new Error("Missing description, urlCall or args definition.");
    }

    const keyRaw = input.slice(0, firstFlagIndex).trim();
    if (!keyRaw) throw new Error("Missing command key.");
    const key = keyRaw; // Space sensitive? "trigger deployment". Yes.

    const rest = input.slice(firstFlagIndex);

    // 2. Extract top-level flags (description, urlCall)
    // We can't use the standard parser easily because of the [] blocks.
    // Converting "description: foo" to std args?
    // Let's use regex to extract description and urlCall

    const descMatch = rest.match(/--description:?\s+([^\[\-\-]+)/) || rest.match(/--description\s+([^\[\-\-]+)/);
    // Note: user used colon in example "--description: Trigger..." but not always consistent?
    // Prompt: "--description <One line description>" AND "--description: <string>"
    // Regex should handle optional colon.
    // Also, user might not quote description, so we grab until next flag or [.

    // Refined regex:
    // Look for --description(:?) (value) until we see --urlCall or [ or end

    const extractFlag = (name: string, source: string): string | undefined => {
        const regex = new RegExp(`--${name}[:\\s]+(.*?)(?=\\s+--|\\s*\\[|$)`, 'i');
        const match = source.match(regex);
        return match ? match[1].trim() : undefined;
    };

    const description = extractFlag('description', rest);
    const urlCall = extractFlag('urlCall', rest);

    if (!urlCall) throw new Error("Missing --urlCall");

    // 3. Extract Arg Definitions [...]
    const args: CommandArg[] = [];
    const bracketRegex = /\[(.*?)\]/g;
    let match;
    while ((match = bracketRegex.exec(rest)) !== null) {
        const content = match[1];
        // Content: "--argKey: dockerId --argKeyAlias: dk ..."
        // Parse this content. It looks like flags.
        // We can reuse a simplified parser or regex.

        const parseInner = (text: string) => {
            const obj: any = {};
            // Split by --
            const parts = text.split('--').filter(p => p.trim());
            for (const part of parts) {
                const [k, ...vParts] = part.split(/[:\s]+/); // split by colon or space
                // k is key, vParts join is value
                let v = vParts.join(' ').trim();
                if (v.endsWith(',')) v = v.slice(0, -1); // Handle trailing comma if present

                if (k === 'argKey') obj.argKey = v;
                if (k === 'argKeyAlias') obj.argKeyAlias = v;
                if (k === 'required') obj.required = (v === 'true');
                if (k === 'defaultValue') obj.defaultValue = v;
                if (k === 'description') obj.description = v;
            }
            return obj;
        };

        const parsed = parseInner(content);
        // Validate schema
        const valid = CommandArgSchema.parse(parsed);
        args.push(valid);
    }

    return {
        key,
        description,
        urlCall,
        args
    };
}
