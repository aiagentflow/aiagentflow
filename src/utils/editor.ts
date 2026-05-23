/**
 * Editor launcher — open a string in the user's $EDITOR.
 *
 * If $EDITOR is not set, falls back to a prompts-based inline text field.
 *
 * Dependency direction: editor.ts → execa, node:fs, prompts
 * Used by: workflow/approval.ts
 */

import { execa } from 'execa';
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import prompts from 'prompts';

/**
 * Open content in $EDITOR and return the edited result.
 * Falls back to inline prompts input if no editor is configured.
 */
export async function openInEditor(content: string, fileExtension = '.md'): Promise<string> {
    const editor = process.env['EDITOR'] ?? process.env['VISUAL'];

    if (editor) {
        return openWithEditor(editor, content, fileExtension);
    }

    return openWithPrompts(content);
}

async function openWithEditor(editor: string, content: string, ext: string): Promise<string> {
    const tmpPath = join(tmpdir(), `aiagentflow-edit-${Date.now()}${ext}`);
    writeFileSync(tmpPath, content, 'utf-8');

    try {
        await execa(editor, [tmpPath], { stdio: 'inherit' });
        const edited = readFileSync(tmpPath, 'utf-8');
        return edited;
    } finally {
        try { unlinkSync(tmpPath); } catch { /* ignore */ }
    }
}

async function openWithPrompts(content: string): Promise<string> {
    console.log('\nCurrent plan (edit below — submit empty line to keep as-is):');
    console.log('─'.repeat(60));
    console.log(content);
    console.log('─'.repeat(60));

    const { edited } = await prompts({
        type: 'text',
        name: 'edited',
        message: 'Paste the edited plan (or leave blank to keep original):',
        initial: '',
    });

    return (edited as string | undefined)?.trim() || content;
}
