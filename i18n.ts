/**
 * The plugin's words in the editor's language. `t("English", params)` translates through
 * the catalogue registered at activation (`ko.ts`); `msg("English")` marks a string kept in
 * a table or handed to the editor in English (menu labels, command titles), which
 * `translate` — or the editor — turns into the reader's language where it is shown.
 * Both take a literal: `tests/ko.test.ts` reads them from the source.
 */
import type { PluginApi } from "@scm-js/plugin-api";

export type Params = Record<string, string | number>;

let i18n: PluginApi["i18n"] | null = null;

/** Called first thing at activation, before anything is labelled. */
export function bindLanguage(api: PluginApi): void {
  i18n = api.i18n;
}

export const t = (text: string, params?: Params): string => (i18n ? i18n.t(text, params) : text);
/** A `msg()`'d value, shown in the reader's language. */
export const translate = (text: string, params?: Params): string => (i18n ? i18n.t(text, params) : text);
export const msg = (text: string): string => text;
