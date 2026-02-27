import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov'],
            include: ['src/**/*.ts'],
            exclude: ['src/cli/index.ts', 'src/types/**'],
        },
        testTimeout: 10_000,
    },
    resolve: {
        alias: {
            '@core': path.resolve(__dirname, 'src/core'),
            '@providers': path.resolve(__dirname, 'src/providers'),
            '@agents': path.resolve(__dirname, 'src/agents'),
            '@utils': path.resolve(__dirname, 'src/utils'),
            '@cli': path.resolve(__dirname, 'src/cli'),
            '@types': path.resolve(__dirname, 'src/types'),
        },
    },
});
