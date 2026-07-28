interface Window {
  electronAPI: any;
  providerModule: unknown;
  shortcutDraftModule: unknown;
  templateModule: {
    parseTemplate(text: string): Array<{ type: string; value: string }>;
    serializeTemplate(nodes: Array<{ type: string; value: string }>): string;
    replaceVariables(text: string, values: Record<string, string>): string;
    validateTemplate(text: string): boolean;
    VARIABLES: Array<{ name: string; description: string }>;
  };
}

declare const providerModule: any;
declare const shortcutDraftModule: any;
declare const templateModule: Window['templateModule'];

// renderer.js obtains typed controls by stable DOM ids at runtime.
interface HTMLElement {
  disabled: boolean;
  placeholder: string;
  value: any;
}

interface Element {
  dataset: DOMStringMap;
}

interface EventTarget {
  getAttribute(name: string): string | null;
}
