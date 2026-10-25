/** @type {import('next').NextConfig} */
export default { serverExternalPackages: ["@hyzyla/pdfium", "@coinbase/cdp-sdk"], transpilePackages: ["three"], outputFileTracingIncludes: { "/api/inbox": ["../orchestrator/node_modules/@hyzyla/pdfium/**/*"], "/office": ["../fixtures/replays/*.jsonl"], "/audit": ["../fixtures/replays/*.jsonl"] } };
