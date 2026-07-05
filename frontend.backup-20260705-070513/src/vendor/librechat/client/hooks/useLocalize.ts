import { useCallback } from 'react';
import appPhrases from '~/locales/en/translation.json';
import clientPhrases from '../locales/en/translation.json';

export type TranslationKeys = string;
export type LocalizeOptions = Record<string, string | number | undefined>;

const phrases: Record<string, string> = { ...clientPhrases, ...appPhrases };

/**
 * Counselle vendor patch (see UPSTREAM.md): flat English lookup over the vendored
 * en translation JSONs instead of i18next/react-i18next. Keys and strings stay
 * byte-identical with upstream's en locale; `{{var}}` interpolation is supported.
 */
export default function useLocalize(): (
  phraseKey: TranslationKeys,
  options?: LocalizeOptions,
) => string {
  return useCallback((phraseKey: TranslationKeys, options?: LocalizeOptions) => {
    let phrase = phrases[phraseKey];
    if (phrase === undefined) {
      if (import.meta.env.DEV) {
        console.warn(`useLocalize: missing translation key "${phraseKey}"`);
      }
      return phraseKey;
    }
    if (options) {
      for (const [key, value] of Object.entries(options)) {
        phrase = phrase.replaceAll(`{{${key}}}`, String(value ?? ''));
      }
    }
    return phrase;
  }, []);
}
