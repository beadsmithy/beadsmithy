import { openUrl } from "@tauri-apps/plugin-opener";

export type ExternalLinkOpener = (url: string) => void;

export const openExternalLink: ExternalLinkOpener = (url) => {
  void openUrl(url);
};
