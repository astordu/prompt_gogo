'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert');
const {
  buildRequestConfig,
  validateProviderConfig,
  migrateToProviders,
} = require('../src/provider');

// ---------------------------------------------------------------------------
// buildRequestConfig
// ---------------------------------------------------------------------------

describe('buildRequestConfig — DeepSeek', () => {
  test('returns correct url, headers, body', () => {
    const provider = { type: 'deepseek', apiKey: 'sk-test', model: 'deepseek-v4-flash' };
    const config = buildRequestConfig(provider);

    assert.strictEqual(config.url, 'https://api.deepseek.com/v1/chat/completions');
    assert.strictEqual(config.headers['Authorization'], 'Bearer sk-test');
    assert.strictEqual(config.headers['Content-Type'], 'application/json');
    assert.deepStrictEqual(config.body, { model: 'deepseek-v4-flash' });
  });

  test('works with deepseek-v4-pro model', () => {
    const provider = { type: 'deepseek', apiKey: 'sk-abc', model: 'deepseek-v4-pro' };
    const config = buildRequestConfig(provider);

    assert.deepStrictEqual(config.body, { model: 'deepseek-v4-pro' });
  });
});

describe('buildRequestConfig — Ollama', () => {
  test('uses default baseUrl when not specified', () => {
    const provider = { type: 'ollama', model: 'llama3.2' };
    const config = buildRequestConfig(provider);

    assert.strictEqual(config.url, 'http://localhost:11434/v1/chat/completions');
    assert.strictEqual(config.headers['Authorization'], undefined);
    assert.deepStrictEqual(config.body, { model: 'llama3.2' });
  });

  test('uses custom baseUrl', () => {
    const provider = { type: 'ollama', baseUrl: 'http://192.168.1.100:11434', model: 'mistral' };
    const config = buildRequestConfig(provider);

    assert.strictEqual(config.url, 'http://192.168.1.100:11434/v1/chat/completions');
  });

  test('strips trailing slash from baseUrl', () => {
    const provider = { type: 'ollama', baseUrl: 'http://localhost:11434/', model: 'llama3.2' };
    const config = buildRequestConfig(provider);

    assert.strictEqual(config.url, 'http://localhost:11434/v1/chat/completions');
  });
});

describe('buildRequestConfig — Custom', () => {
  test('uses user baseUrl with apiKey', () => {
    const provider = { type: 'custom', baseUrl: 'https://api.example.com', apiKey: 'my-key', model: 'gpt-4' };
    const config = buildRequestConfig(provider);

    assert.strictEqual(config.url, 'https://api.example.com/v1/chat/completions');
    assert.strictEqual(config.headers['Authorization'], 'Bearer my-key');
    assert.deepStrictEqual(config.body, { model: 'gpt-4' });
  });

  test('works without apiKey', () => {
    const provider = { type: 'custom', baseUrl: 'https://api.example.com', model: 'gpt-4' };
    const config = buildRequestConfig(provider);

    assert.strictEqual(config.headers['Authorization'], undefined);
  });

  test('strips trailing slash from baseUrl', () => {
    const provider = { type: 'custom', baseUrl: 'https://api.example.com/', apiKey: 'k', model: 'm' };
    const config = buildRequestConfig(provider);

    assert.strictEqual(config.url, 'https://api.example.com/v1/chat/completions');
  });
});

describe('buildRequestConfig — unknown type', () => {
  test('throws for unknown provider type', () => {
    assert.throws(
      () => buildRequestConfig({ type: 'unknown', model: 'x' }),
      /Unknown provider type/
    );
  });
});

// ---------------------------------------------------------------------------
// validateProviderConfig
// ---------------------------------------------------------------------------

describe('validateProviderConfig — DeepSeek', () => {
  test('valid config returns no errors', () => {
    const result = validateProviderConfig({ type: 'deepseek', apiKey: 'sk-test', model: 'deepseek-v4-flash' });
    assert.strictEqual(result.valid, true);
    assert.deepStrictEqual(result.errors, []);
  });

  test('missing apiKey returns error', () => {
    const result = validateProviderConfig({ type: 'deepseek', model: 'deepseek-v4-flash' });
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('API Key')));
  });

  test('missing model returns error', () => {
    const result = validateProviderConfig({ type: 'deepseek', apiKey: 'sk-test' });
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Model')));
  });

  test('missing both apiKey and model returns two errors', () => {
    const result = validateProviderConfig({ type: 'deepseek' });
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.errors.length, 2);
  });
});

describe('validateProviderConfig — Ollama', () => {
  test('valid config with only model', () => {
    const result = validateProviderConfig({ type: 'ollama', model: 'llama3.2' });
    assert.strictEqual(result.valid, true);
    assert.deepStrictEqual(result.errors, []);
  });

  test('missing model returns error', () => {
    const result = validateProviderConfig({ type: 'ollama' });
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Model')));
  });
});

describe('validateProviderConfig — Custom', () => {
  test('valid config with baseUrl and model (apiKey optional)', () => {
    const result = validateProviderConfig({ type: 'custom', baseUrl: 'https://api.example.com', model: 'gpt-4' });
    assert.strictEqual(result.valid, true);
  });

  test('missing baseUrl returns error', () => {
    const result = validateProviderConfig({ type: 'custom', model: 'gpt-4' });
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Base URL')));
  });

  test('missing model returns error', () => {
    const result = validateProviderConfig({ type: 'custom', baseUrl: 'https://api.example.com' });
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Model')));
  });
});

describe('validateProviderConfig — invalid type', () => {
  test('missing type returns error', () => {
    const result = validateProviderConfig({ model: 'x' });
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('type')));
  });

  test('unknown type returns error', () => {
    const result = validateProviderConfig({ type: 'bogus', model: 'x' });
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('type')));
  });
});

// ---------------------------------------------------------------------------
// migrateToProviders
// ---------------------------------------------------------------------------

describe('migrateToProviders — old format with apiKey', () => {
  test('creates DeepSeek provider and assigns providerId to shortcuts', () => {
    const oldData = {
      apiKey: 'sk-old-key',
      shortcuts: [
        { id: '1', name: 'Test', shortcut: 'Ctrl+1', template: 'hello @select_content' },
        { id: '2', name: 'Test2', shortcut: 'Ctrl+2', template: 'bye @select_content' }
      ]
    };

    const result = migrateToProviders(oldData, 'provider-1');

    assert.strictEqual(result.providers.length, 1);
    assert.strictEqual(result.providers[0].id, 'provider-1');
    assert.strictEqual(result.providers[0].type, 'deepseek');
    assert.strictEqual(result.providers[0].apiKey, 'sk-old-key');
    assert.strictEqual(result.providers[0].model, 'deepseek-v4-flash');
    assert.strictEqual(result.providers[0].name, 'DeepSeek');

    assert.strictEqual(result.shortcuts.length, 2);
    assert.strictEqual(result.shortcuts[0].providerId, 'provider-1');
    assert.strictEqual(result.shortcuts[1].providerId, 'provider-1');
  });

  test('preserves shortcut fields', () => {
    const oldData = {
      apiKey: 'sk-key',
      shortcuts: [{ id: '1', name: 'X', shortcut: 'Ctrl+X', template: 't @select_content' }]
    };
    const result = migrateToProviders(oldData, 'p1');
    assert.strictEqual(result.shortcuts[0].name, 'X');
    assert.strictEqual(result.shortcuts[0].template, 't @select_content');
  });
});

describe('migrateToProviders — empty apiKey', () => {
  test('no providers created when apiKey is empty', () => {
    const oldData = {
      apiKey: '',
      shortcuts: [{ id: '1', name: 'T', shortcut: 'Ctrl+1', template: 't' }]
    };
    const result = migrateToProviders(oldData, 'p1');

    assert.strictEqual(result.providers.length, 0);
    assert.strictEqual(result.shortcuts.length, 1);
    assert.strictEqual(result.shortcuts[0].providerId, undefined);
  });
});

describe('migrateToProviders — new format passthrough', () => {
  test('returns data unchanged when already migrated', () => {
    const newData = {
      providers: [{ id: 'p1', type: 'deepseek', apiKey: 'k', model: 'm' }],
      shortcuts: [{ id: '1', providerId: 'p1', name: 'T' }]
    };
    const result = migrateToProviders(newData, 'ignored');

    assert.deepStrictEqual(result.providers, newData.providers);
    assert.deepStrictEqual(result.shortcuts, newData.shortcuts);
  });

  test('does not re-migrate even with old apiKey present', () => {
    const newData = {
      apiKey: 'leftover',
      providers: [{ id: 'p1', type: 'ollama', model: 'llama3' }],
      shortcuts: [{ id: '1', providerId: 'p1' }]
    };
    const result = migrateToProviders(newData, 'ignored');

    assert.strictEqual(result.providers.length, 1);
    assert.strictEqual(result.providers[0].type, 'ollama');
  });
});

describe('migrateToProviders — edge cases', () => {
  test('handles missing shortcuts array', () => {
    const oldData = { apiKey: 'sk-key' };
    const result = migrateToProviders(oldData, 'p1');

    assert.strictEqual(result.providers.length, 1);
    assert.strictEqual(result.shortcuts.length, 0);
  });

  test('handles empty shortcuts array', () => {
    const oldData = { apiKey: 'sk-key', shortcuts: [] };
    const result = migrateToProviders(oldData, 'p1');

    assert.strictEqual(result.providers.length, 1);
    assert.strictEqual(result.shortcuts.length, 0);
  });

  test('does not mutate input data', () => {
    const oldData = {
      apiKey: 'sk-key',
      shortcuts: [{ id: '1', name: 'T' }]
    };
    const originalShortcuts = JSON.parse(JSON.stringify(oldData.shortcuts));
    migrateToProviders(oldData, 'p1');

    assert.deepStrictEqual(oldData.shortcuts, originalShortcuts);
  });
});
