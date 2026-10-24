/** @type {import('next').NextConfig} */
export default { transpilePackages: ["three"], outputFileTracingIncludes: { "/office": ["../fixtures/replays/*.jsonl"], "/audit": ["../fixtures/replays/*.jsonl"] } };
