'use strict';

/**
 * Run Executor — the single high-level orchestration seam for a Run.
 *
 * A Run is the complete lifecycle triggered by a Shortcut: reading the
 * selected text, replacing Template variables, resolving and validating
 * the Provider, sending the model request with SSE streaming, writing
 * model content to the Output Target via the clipboard sink, managing
 * the Run Indicator lifecycle (S → content → E), handling cancellation,
 * and mapping errors to user-visible notifications.
 *
 * All system dependencies (text reader, provider lookup, model request,
 * clipboard sink, notifications, window management) are injected at
 * construction time. The only per-call argument is the Shortcut
 * configuration: `execute(shortcut)`.
 */

const { replaceVariables } = require('../template');
const { validateProviderConfig, buildRequestConfig } = require('../provider');
const { pipeToCursor } = require('./stream-output');

/**
 * @typedef {Object} RunExecutorOptions
 * @property {InstanceType<typeof import('./run-coordinator').RunCoordinator>} coordinator
 * @property {() => Promise<string>} readSelectedText
 * @property {(providerId: string) => Object|null} findProvider
 * @property {(requestConfig: Object, prompt: string, signal: AbortSignal|null) => Promise<AsyncIterable<string>>} sendModelRequest
 *   Returns an async iterable of content chunks.
 * @property {Function} [createSink] - Factory for clipboard sinks (defaults to createClipboardSink)
 * @property {(title: string, body: string) => void} onNotify
 * @property {() => void} [onShowWindow] - Called when the settings window should be shown
 */

class RunExecutor {
  /**
   * @param {RunExecutorOptions} opts
   */
  constructor(opts) {
    this._coordinator = opts.coordinator;
    this._readSelectedText = opts.readSelectedText;
    this._findProvider = opts.findProvider;
    this._sendModelRequest = opts.sendModelRequest;
    this._createSink = opts.createSink || (() => {
      const { createClipboardSink } = require('./clipboard-sink');
      return createClipboardSink();
    });
    this._onNotify = opts.onNotify || (() => {});
    this._onShowWindow = opts.onShowWindow || (() => {});
  }

  /**
   * Execute a complete Run for the given Shortcut.
   *
   * @param {{ name: string, shortcut: string, template: string, providerId: string }} shortcutConfig
   */
  async execute(shortcutConfig) {
    if (process.platform !== 'darwin') {
      this._onNotify('平台错误', '此功能仅支持 macOS 系统');
      return;
    }

    if (!this._coordinator.beginRun()) {
      return;
    }

    try {
      const selectedText = await this._coordinator.readText();

      if (selectedText === null) {
        if (!this._coordinator.isTargetInvalid()) {
          this._onNotify('已取消', '运行任务已取消');
        }
        return;
      }

      if (!selectedText || selectedText.trim() === '') {
        this._onNotify('未能获取文本', '请确保文本已选中\n或先 Cmd+C 复制后再试');
        return;
      }

      const prompt = replaceVariables(shortcutConfig.template, { select_content: selectedText });

      if (!this._coordinator.isViable()) {
        if (this._coordinator.isCancelled()) {
          this._onNotify('已取消', '运行任务已取消');
        }
        return;
      }

      await this._processWithAI(prompt, shortcutConfig, selectedText);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('\n❌ 处理失败:', error.message);
    } finally {
      this._coordinator.endRun();
    }
  }

  /**
   * Resolve the Provider, show Loading, send the model request, stream
   * the response to the Output Target, and manage the Run Indicator
   * lifecycle.
   *
   * @private
   */
  async _processWithAI(prompt, shortcutConfig, originalSelectedText) {
    const provider = this._findProvider(shortcutConfig.providerId);
    const actionName = shortcutConfig.name;

    if (!provider) {
      this._onNotify('Provider 缺失', `快捷键「${actionName}」未绑定模型提供方，请在设置中配置`);
      this._onShowWindow();
      return;
    }

    const validation = validateProviderConfig(provider);
    if (!validation.valid) {
      this._onNotify('Provider 配置不完整', validation.errors.join('\n'));
      this._onShowWindow();
      return;
    }

    const requestConfig = buildRequestConfig(provider);

    const loadingShown = await this._coordinator.showLoading(originalSelectedText || '');
    if (!loadingShown) {
      if (this._coordinator.isCancelled()) {
        this._onNotify('已取消', '运行任务已取消');
      }
      return;
    }

    let firstContentHandled = false;

    try {
      const abortSignal = this._coordinator.getAbortSignal();

      const chunkIterable = await this._sendModelRequest(requestConfig, prompt, abortSignal);

      if (this._coordinator.isCancelled()) {
        if (this._coordinator.isShowingLoading()) {
          await this._coordinator.abortLoading();
        }
        this._onNotify('已取消', '运行任务已取消');
        return;
      }

      const coordinator = this._coordinator;
      const collected = [];

      async function* trackedChunks() {
        for await (const chunk of chunkIterable) {
          if (coordinator.isCancelled()) {
            return;
          }

          if (!firstContentHandled && chunk) {
            const cleared = await coordinator.onModelContent(chunk);
            if (!cleared) {
              if (coordinator.isCancelled()) {
                await coordinator.abortLoading();
              }
              return;
            }
            firstContentHandled = cleared;
          }

          if (coordinator.isCancelled()) {
            return;
          }

          collected.push(chunk);
          yield chunk;
        }
      }

      const baseSink = this._createSink();
      const validatingSink = {
        async write(text) {
          if (!coordinator.validateTarget()) {
            throw new Error('Output Target invalid');
          }
          await baseSink.write(text);
        },
        async close() {
          await baseSink.close();
        },
      };

      await pipeToCursor(trackedChunks(), validatingSink, abortSignal);

      if (coordinator.isCancelled()) {
        if (firstContentHandled) {
          this._onNotify('已取消', '运行任务已取消');
        }
        return;
      }

      if (coordinator.isTargetInvalid()) {
        return;
      }

      if (coordinator.hasModelContent()) {
        const endingResult = await coordinator.showEnding();
        if (!endingResult && coordinator.isTargetInvalid()) {
          return;
        }
      } else {
        if (coordinator.isShowingLoading()) {
          await coordinator.abortLoading();
        }
        this._onNotify('错误', '未收到任何模型内容');
        return;
      }
    } catch (error) {
      if (error && error.name === 'CanceledError') {
        if (this._coordinator.isShowingLoading()) {
          await this._coordinator.abortLoading();
        }
        this._onNotify('已取消', '运行任务已取消');
        return;
      }

      if (error.message === 'Output Target invalid') {
        if (this._coordinator.isShowingLoading()) {
          await this._coordinator.abortLoading();
        }
        return;
      }

      if (this._coordinator.isShowingLoading()) {
        await this._coordinator.abortLoading();
      }

      if (this._coordinator.isCancelled()) {
        return;
      }

      this._notifyError(error);
    }
  }

  /**
   * Map an HTTP/transport error to a user-visible notification.
   *
   * @private
   * @param {Error & { response?: Object, code?: string }} error
   */
  _notifyError(error) {
    let errorMessage = '处理文本失败';
    if (error.response) {
      const status = error.response.status;
      if (status === 401) {
        errorMessage = 'API Key 无效，请检查您的配置';
      } else if (status === 429) {
        errorMessage = 'API 请求次数超限，请稍后重试';
      } else if (status >= 500) {
        errorMessage = 'API 服务暂时不可用，请稍后重试';
      }
    } else if (error.code === 'ECONNABORTED') {
      errorMessage = '请求超时，请检查网络连接';
    } else if (error.message) {
      errorMessage = `错误: ${error.message}`;
    }
    this._onNotify('错误', errorMessage);
  }
}

module.exports = { RunExecutor };
