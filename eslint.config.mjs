import unjs from "eslint-config-unjs";
import stylistic from "@stylistic/eslint-plugin";
export default unjs(
  {
    ignores: [
      // ignore paths
      "**/dist",
    ],
    rules: {
      // rule overrides
      "unicorn/no-null": "off",
      "unicorn/filename-case": "off",
      "@stylistic/no-tabs": ["error", { allowIndentationTabs: true }],
      "no-fallthrough": ["error", { allowEmptyCase: true }],
    },
    markdown: {
      rules: {
        // markdown rule overrides
      },
    },
  },
  stylistic.configs.customize({
    indent: 2,
    quotes: "double",
    semi: true,
    arrowParens: true,
    braceStyle: "1tbs",
    commaDangle: "always-multiline",
  }),
);
