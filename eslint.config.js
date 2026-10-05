import globals from "globals";
import pluginJs from "@eslint/js";

export default [
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        // Substituída em build pelo Vite (vite.config.js `define`), a partir de package.json
        // (Gate 1-F4.C4, Decisão 7: versão do app enviada em requisições instrumentadas).
        __APP_VERSION__: "readonly",
      },
    },
  },
  pluginJs.configs.recommended,
  {
    rules: {
      "no-unused-vars": "warn",
      "no-console": "off",
      "prefer-const": "error",
      "no-var": "error",
      "eqeqeq": ["error", "always"],
      "curly": ["error", "all"],
      "brace-style": ["error", "1tbs"],
      "indent": ["warn", 2, { "SwitchCase": 1 }],
      "quotes": ["warn", "single", { "avoidEscape": true }],
      "semi": ["error", "always"],
      "comma-dangle": ["warn", "never"],
      "arrow-parens": ["warn", "always"],
      "no-trailing-spaces": "warn",
      "eol-last": ["warn", "always"],
    },
  },
  {
    ignores: ["dist/**", "node_modules/**"],
  },
];
