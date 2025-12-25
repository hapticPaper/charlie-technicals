import process from "node:process";

/** @type {import('next').NextConfig} */
const rawBasePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").trim();
const normalizedBasePath = rawBasePath.replace(/^\/+|\/+$/g, "");
const basePath = normalizedBasePath === "" ? "" : `/${normalizedBasePath}`;

const nextConfig = {
  reactStrictMode: true,
  output: "export",
  trailingSlash: true,
  basePath,
  assetPrefix: basePath,
  images: { unoptimized: true },
  staticPageGenerationTimeout: 180
};

export default nextConfig;
