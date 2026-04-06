import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

/**
 * Configure Monaco Editor globally for @skill: and @tool: syntax highlighting.
 * This runs before Angular bootstrap to ensure Monaco is configured before any editor renders.
 */
function configureMonacoGlobal(): void {
  const tryConfigure = () => {
    const w = window as unknown as { monaco?: typeof import('monaco-editor') };
    
    if (w.monaco) {
      // Register a custom language that extends markdown with @skill: and @tool: tokens
      w.monaco.languages.register({ id: 'yoizenclaw-prompt' });
      
      // Define Monarch tokenizer with @skill: and @tool: as custom tokens
      // Use string patterns with proper escaping for the regex
      w.monaco.languages.setMonarchTokensProvider('yoizenclaw-prompt', {
        tokenizer: {
          root: [
            // @skill: mentions - will be colored with custom theme rules
            [/@[\w]+:[\w-]+/, 'skill-mention'],
            // Markdown basics
            [/\*\*.*?\*\*/, 'strong'],
            [/\*.*?\*/, 'emphasis'],
            [/`[^`]+`/, 'code'],
            [/\[.*?\]\(.*?\)/, 'link'],
            [/^#.*$/, 'header'],
            [/\S+/, ''], // everything else is plain text
          ],
        },
      });
      
      // Configure language configuration (brackets, auto-indent, etc.)
      w.monaco.languages.setLanguageConfiguration('yoizenclaw-prompt', {
        brackets: [
          ['{', '}'],
          ['[', ']'],
          ['(', ')'],
        ],
        autoClosingPairs: [
          { open: '{', close: '}' },
          { open: '[', close: ']' },
          { open: '(', close: ')' },
          { open: '"', close: '"' },
          { open: "'", close: "'" },
        ],
      });
      
      // Extend vs-dark theme with custom token colors
      w.monaco.editor.defineTheme('vs-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: 'skill-mention', foreground: '00BCD4', fontStyle: 'bold' }, // Cyan
        ],
        colors: {},
      });
      
      // Extend vs theme (light) with custom token colors
      w.monaco.editor.defineTheme('vs', {
        base: 'vs',
        inherit: true,
        rules: [
          { token: 'skill-mention', foreground: '00838F', fontStyle: 'bold' }, // Dark Cyan
        ],
        colors: {},
      });
      
    } else {
      // Retry in 100ms if Monaco not loaded yet
      setTimeout(tryConfigure, 100);
    }
  };
  
  // Start configuration immediately
  tryConfigure();
}

// Configure Monaco before bootstrapping Angular
configureMonacoGlobal();

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
