// SPDX-License-Identifier: MIT
// Copyright (C) 2026 erdlabs
import { useEffect } from "react";
import type { JSX } from "react";

import { APP_LICENSE, APP_VERSION_LABEL } from "../shared/app-meta.js";
import { IconClose } from "./icons.js";
import { useI18n } from "./i18n/index.js";

export function AboutPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const { t } = useI18n();
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  return (
    <div className="account-manager-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="account-manager about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-title">
        <div className="account-manager-header">
          <div><h2 id="about-title">{t("about.title")}</h2></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label={t("about.close")} autoFocus><IconClose size={18} /></button>
        </div>
        <p><strong>{t("about.version", { version: APP_VERSION_LABEL })}</strong></p>
        <p>{t("about.licence", { license: APP_LICENSE })}</p>
        <p>{t("about.label")}</p>
      </section>
    </div>
  );
}
