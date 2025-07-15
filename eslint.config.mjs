import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Production-friendly linting rules
      "@typescript-eslint/no-unused-vars": [
        "warn", // Change from error to warn
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // Allow any types for blockchain/web3 integration
      "@typescript-eslint/no-explicit-any": "warn", // Change from error to warn

      // Relax React rules for production
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/rules-of-hooks": "error", // Keep this as error
      "react/no-unescaped-entities": "warn",
      "@next/next/no-img-element": "warn",

      // Allow unused eslint-disable directives
      "unused-imports/no-unused-imports": "off",

      // Allow prefer-const warnings
      "prefer-const": "warn",
    },
  },
  {
    files: [
      "src/lib/wallet.ts",
      "src/lib/tokenService.ts",
      "src/lib/contractDeployment.ts",
      "src/lib/eventDatabase.ts",
      "src/lib/blockchainEventQuerier.ts",
      "src/services/eventListener.ts",
      "src/hooks/**/*.tsx",
      "src/components/**/*.tsx",
      "src/app/api/**/*.ts",
    ],
    rules: {
      // Allow any types in blockchain integration files
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/exhaustive-deps": "off",
    },
  },
];

export default eslintConfig;
