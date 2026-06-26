// lib/cloudinary.ts
//
// Server-only Cloudinary client. Credentials come from .env.local
// (CLOUDINARY_CLOUD_NAME / _API_KEY / _API_SECRET) — never import this from a
// client component, or the API secret would be bundled into the browser.

import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

export default cloudinary;
