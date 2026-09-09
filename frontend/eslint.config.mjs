import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/api/client.ts", "**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-globals": ["error", { name: "fetch", message: "Use a domain API from @/lib/api/." }, { name: "XMLHttpRequest", message: "Use a domain API from @/lib/api/." }],
      "no-restricted-syntax": ["error",
        { selector: "CallExpression[callee.name='fetch']", message: "Use a domain API from @/lib/api/." },
        { selector: "CallExpression[callee.type='MemberExpression'][callee.property.name='fetch']", message: "Use a domain API from @/lib/api/." },
        { selector: "NewExpression[callee.name='XMLHttpRequest']", message: "Use a domain API from @/lib/api/." },
      ],
      "no-restricted-imports": ["error", { paths: ["axios", "node-fetch", "undici"] }],
    },
  },
  {
    files: ["src/components/**/*.{ts,tsx}", "src/features/**/*.{ts,tsx}", "src/hooks/**/*.{ts,tsx}", "src/app/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: ["axios", "node-fetch", "undici", {
          name: "@/lib/api/browser", importNames: ["apiClient"], message: "Use a typed domain API instead of the transport.",
        }],
        patterns: [
          { group: ["@/lib/api/client", "@/lib/api/server", "**/api/client", "**/api/server"], message: "Use a typed domain API instead of the transport." },
          { group: ["**/api/browser"], importNames: ["apiClient"], message: "Use a typed domain API instead of the transport." },
        ],
      }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
