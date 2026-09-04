"use strict";

// statusman's coding convention, as far as a linter can hold it. The rest —
// what the comments are for, when a component may bow out — lives in
// CONTRIBUTING.md.
module.exports = [
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: {
        module: "writable", require: "readonly", process: "readonly", console: "readonly", __dirname: "readonly",
        // Node 18's own globals, which refresh.js is the only user of.
        fetch: "readonly", AbortSignal: "readonly",
      },
    },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      // Correctness: the statusline runs on every render and must never throw.
      "no-undef": "error",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-implicit-globals": "error",
      "no-shadow": "error",
      "no-return-assign": "error",
      "no-param-reassign": "error",
      "require-atomic-updates": "error",
      "no-await-in-loop": "error",
      "no-console": "off",

      // Style: what the existing code already does, so the diff of adopting
      // the linter is empty and a violation is a real change of habit.
      strict: ["error", "global"],
      "prefer-const": "error",
      "no-var": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      curly: ["error", "multi-line"],
      quotes: ["error", "double", { avoidEscape: true }],
      semi: ["error", "always"],
      indent: ["error", 2, { SwitchCase: 1 }],
      "comma-dangle": ["error", "always-multiline"],
      "max-len": ["error", { code: 128, ignoreUrls: true, ignoreRegExpLiterals: true }],
      "object-shorthand": ["error", "always"],
      "arrow-body-style": ["error", "as-needed"],
      "no-multiple-empty-lines": ["error", { max: 1, maxBOF: 0, maxEOF: 1 }],
      "eol-last": ["error", "always"],
      "no-trailing-spaces": "error",
    },
  },
  {
    // Tests may reach for the runner's globals and lean on long fixtures.
    files: ["test/**/*.js"],
    languageOptions: { globals: { module: "writable", require: "readonly", process: "readonly", __dirname: "readonly" } },
    rules: { "max-len": ["error", { code: 140 }] },
  },
  { ignores: ["node_modules/"] },
];
