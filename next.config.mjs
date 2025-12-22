import process from "node:process";

/** @type {import('next').NextConfig} */
const rawBasePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").trim();
const withoutTrailingSlashes = rawBasePath.replace(/\/+$/, "");
const basePath =
  withoutTrailingSlashes === "" || withoutTrailingSlashes === "/"
    ? ""
    : `/${withoutTrailingSlashes.replace(/^\/+/, "")}`;

const nextConfig = {
  reactStrictMode: true,
  output: "export",
  trailingSlash: true,
  basePath,
  assetPrefix: basePath,
  images: { unoptimized: true }
};

export default nextConfig;
