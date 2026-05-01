import type {
  AssetCategory,
  DownloadedAsset,
  DownloadedAssetsSummary,
} from "@/lib/reportTypes";

export const CATEGORY_ORDER: AssetCategory[] = [
  "build",
  "script",
  "stylesheet",
  "document",
  "json",
  "image",
  "font",
  "other",
];

export const ASSET_LABELS: Record<AssetCategory, string> = {
  build: "Main document",
  script: "Scripts",
  stylesheet: "Stylesheets",
  document: "Other documents",
  json: "API / fetch calls",
  image: "Images",
  font: "Fonts",
  other: "Other",
};

export function getDisplayName(url: string) {
  try {
    const parsed = new URL(url);
    const lastPart = parsed.pathname.split("/").filter(Boolean).pop();
    if (lastPart) return lastPart;
    return parsed.hostname || parsed.pathname || url;
  } catch {
    const lastPart = url.split("/").filter(Boolean).pop();
    return lastPart || url;
  }
}

export function getHostName(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "Unknown host";
  }
}

export type FileRow = DownloadedAsset & { category: AssetCategory };

export function flattenAllFiles(
  byCategory: DownloadedAssetsSummary["byCategory"],
): FileRow[] {
  const out: FileRow[] = [];
  for (const cat of CATEGORY_ORDER) {
    const bucket = byCategory[cat];
    if (!bucket?.files?.length) continue;
    for (const f of bucket.files) out.push({ ...f, category: cat });
  }
  return out;
}
