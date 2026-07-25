'use strict';

const PROVIDER_TYPES = ['deepseek', 'ollama', 'custom'];

const DEEPSEEK_MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro'];

function buildRequestConfig(provider) {
  let url;
  const headers = { 'Content-Type': 'application/json' };

  switch (provider.type) {
    case 'deepseek':
      url = 'https://api.deepseek.com/v1/chat/completions';
      headers['Authorization'] = `Bearer ${provider.apiKey}`;
      break;
    case 'ollama': {
      const base = (provider.baseUrl || 'http://localhost:11434').replace(/\/$/, '');
      url = `${base}/v1/chat/completions`;
      break;
    }
    case 'custom': {
      const base = provider.baseUrl.replace(/\/$/, '');
      url = `${base}/v1/chat/completions`;
      if (provider.apiKey) {
        headers['Authorization'] = `Bearer ${provider.apiKey}`;
      }
      break;
    }
    default:
      throw new Error(`Unknown provider type: ${provider.type}`);
  }

  return { url, headers, body: { model: provider.model } };
}

function validateProviderConfig(provider) {
  const errors = [];

  if (!provider.type || !PROVIDER_TYPES.includes(provider.type)) {
    errors.push('Provider type is required (deepseek, ollama, or custom)');
    return { valid: false, errors };
  }

  if (!provider.model) {
    errors.push('Model is required');
  }

  switch (provider.type) {
    case 'deepseek':
      if (!provider.apiKey) errors.push('API Key is required for DeepSeek');
      break;
    case 'ollama':
      break;
    case 'custom':
      if (!provider.baseUrl) errors.push('Base URL is required for Custom provider');
      break;
  }

  return { valid: errors.length === 0, errors };
}

function migrateToProviders(oldData, providerId) {
  const result = { providers: [], shortcuts: [] };

  const hasProvidersArray = Array.isArray(oldData.providers);
  const hasOldApiKey = 'apiKey' in oldData;
  const allHaveProviderId = Array.isArray(oldData.shortcuts) &&
    oldData.shortcuts.every(s => s.providerId);

  if (hasProvidersArray && allHaveProviderId) {
    return {
      providers: oldData.providers,
      shortcuts: oldData.shortcuts
    };
  }

  const shortcuts = Array.isArray(oldData.shortcuts)
    ? oldData.shortcuts.map(s => ({ ...s }))
    : [];

  if (hasOldApiKey && oldData.apiKey) {
    const id = providerId || String(Date.now());
    result.providers = [{
      id,
      name: 'DeepSeek',
      type: 'deepseek',
      apiKey: oldData.apiKey,
      model: 'deepseek-v4-flash'
    }];
    for (const s of shortcuts) {
      s.providerId = id;
    }
  }

  result.shortcuts = shortcuts;
  return result;
}

// Support both CommonJS and browser <script> tag
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildRequestConfig,
    validateProviderConfig,
    migrateToProviders,
    PROVIDER_TYPES,
    DEEPSEEK_MODELS
  };
} else {
  // eslint-disable-next-line no-undef
  window.providerModule = {
    buildRequestConfig,
    validateProviderConfig,
    migrateToProviders,
    PROVIDER_TYPES,
    DEEPSEEK_MODELS
  };
}
