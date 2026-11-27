import { PageHeader } from "../../shared/ui/PageHeader";
import "./settings.css";
import "./settings-premium.css";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import SettingsRail from "./SettingsRail";
import type { SettingsRailProps } from "./SettingsRail";
import type { SettingsCategory } from "./settings.types";
import { settingsCategoryTabs } from "./settings.constants";
import { isAndroidApp } from "../../app/platform";

export type SettingsViewProps = {
  renderSettingsCategoryContent: () => ReactNode;
  settingsRail: SettingsRailProps;
  settingsCategory: SettingsCategory;
  reveal: { category: SettingsCategory; id: string } | null;
  onRevealed: () => void;
  settingsSaveError?: boolean;
  retrySettingsSave?: () => Promise<boolean>;
};

export default function SettingsView({
  renderSettingsCategoryContent, settingsRail, settingsCategory, reveal, onRevealed, settingsSaveError, retrySettingsSave
}: SettingsViewProps) {
  const selectedTab = settingsRail.tabs.find(tab => tab.id === settingsCategory) ?? settingsCategoryTabs.find(tab => tab.id === settingsCategory);
  const pageRef = useRef<HTMLElement>(null);
  const lastCategory = useRef(settingsCategory);

  useLayoutEffect(() => {
    if (lastCategory.current === settingsCategory) return;
    lastCategory.current = settingsCategory;
    pageRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [settingsCategory]);

  useLayoutEffect(() => {
    const page = pageRef.current;
    if (!page || !reveal || reveal.category !== settingsCategory) return;
    const id = reveal.id;
    let timeout: number | undefined;
    let observer: MutationObserver | undefined;
    function revealControl() {
      const target = document.getElementById(id);
      if (!target || !page?.contains(target)) return false;
      observer?.disconnect();
      window.clearTimeout(timeout);
      const disclosure = target instanceof HTMLDetailsElement ? target
        : target.firstElementChild instanceof HTMLDetailsElement ? target.firstElementChild : null;
      if (disclosure) disclosure.open = true;
      for (let parent = target.closest("details"); parent; parent = parent.parentElement?.closest("details") ?? null) {
        parent.open = true;
      }
      const scrollArea = isAndroidApp() ? page.closest(".content") : null;
      if (scrollArea) {
        scrollArea.scrollTo({ top: target.getBoundingClientRect().top - scrollArea.getBoundingClientRect().top + scrollArea.scrollTop - 12, behavior: "instant" });
      } else {
        target.scrollIntoView({ block: "start", behavior: "instant" });
      }
      const focus = disclosure?.querySelector<HTMLElement>("summary")
        ?? (target.hasAttribute("tabindex") ? target : target.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), summary"))
        ?? target;
      if (focus === target) focus.tabIndex = -1;
      focus.focus({ preventScroll: true });
      onRevealed();
      return true;
    }
    const frame = requestAnimationFrame(() => {
      if (revealControl()) return;
      observer = new MutationObserver(revealControl);
      observer.observe(page, { childList: true, subtree: true });
      timeout = window.setTimeout(() => { observer?.disconnect(); onRevealed(); }, 4000);
    });
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); window.clearTimeout(timeout); };
  }, [reveal, settingsCategory, onRevealed]);

  return (
    <section ref={pageRef} data-page-section="settings" className="settingsPage settingsPageV027">
      <PageHeader title="Settings" />
      {settingsSaveError ? <div role="alert" className="settingsActionRow"><span>Settings could not be saved.</span><button type="button" className="settingsActionButton" onClick={() => void retrySettingsSave?.()}>Retry</button></div> : null}
      <div className="settingsLayout settingsPageLayoutV027">
        <SettingsRail {...settingsRail} />
        <div className="settingsCategoryContent settingsCategoryContentV027" role="region" aria-label={`${selectedTab?.label || "Application"} settings`}>
          <div key={settingsCategory} className={`settingsCategoryMotion settingsCategoryMotion-${settingsCategory}`}
            data-settings-category={settingsCategory}>
            {renderSettingsCategoryContent()}
          </div>
        </div>
      </div>
    </section>
  );
}
