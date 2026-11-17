import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import svelte from "eslint-plugin-svelte";
import svelteParser from "svelte-eslint-parser";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/*.config.{js,ts}",
      "**/.svelte-kit/**",
      "packages/core/prisma/migrations/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    // Repo scripts (e.g. scripts/size.mjs) run on Node.
    files: ["scripts/**/*.{js,mjs}"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // React port (issue #64): the Rules of Hooks for the React app only. The
    // Svelte setup above stays until cutover.
    files: ["apps/web-react/**/*.{ts,tsx}"],
    ...reactHooks.configs.flat.recommended,
  },
  {
    // Svelte components + rune modules (*.svelte.ts/.js): parse with the Svelte
    // parser, delegating <script lang="ts"> / TS modules to the TS parser.
    files: ["**/*.svelte", "**/*.svelte.ts", "**/*.svelte.js"],
    languageOptions: {
      parser: svelteParser,
      parserOptions: { parser: tseslint.parser },
      globals: { ...globals.browser },
    },
  },
  {
    rules: {
      // Empty interfaces are idiomatic for shadcn component prop types.
      "@typescript-eslint/no-empty-object-type": "off",
      // Surface unused code as warnings, not hard CI failures.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
