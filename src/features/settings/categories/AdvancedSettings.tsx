import { OpticalButton } from "../../../shared/appearance/OpticalButton";
import { useAppearance } from "../../../shared/appearance/appearance";
import { useState } from "react";
import { readRecoveryArchives } from "../../../shared/storage/recoveryJournal";
import type { Settings } from "../settings.types";
import type { DiagnosticsInfo, PlatformInfoLike, UpdateSetting } from "../settings.shared";
import { ToggleRow } from "../settings.shared";
const DANGER_MASCOT_SRC = new URL("../../../assets/danger-state.png", import.meta.url).href;

export type AdvancedSettingsProps = {
  settings: Settings; updateSetting: UpdateSetting; diagnosticsInfo: DiagnosticsInfo; diagnosticsCopied: boolean; copyDiagnosticsInfo: () => void;
  platformInfo: Required<PlatformInfoLike>; resetDiscordSettings: () => void; resetAppearanceSettings: () => void; resetPlayerLayoutSettings: () => void; resetLibraryLayoutSettings: () => void; resetAllSettingsSafely: () => void;
};
export default function AdvancedSettings(p: AdvancedSettingsProps) {
  const { kit } = useAppearance();
  const [recoveryStatus, setRecoveryStatus] = useState("");
  async function copyRecovery() {
    try {
      const entries = readRecoveryArchives(window.localStorage);
      if (!Object.keys(entries).length) { setRecoveryStatus("No recovery copies found."); return; }
      await navigator.clipboard.writeText(JSON.stringify(entries, null, 2));
      setRecoveryStatus("Recovery data copied. Store it somewhere safe.");
    } catch { setRecoveryStatus("Could not access or copy recovery data."); }
  }
  return <section className="settingsCategoryPage settingsDeclutterPageV491 settingsAdvancedBoringV491" aria-label="Advanced settings"><div className="settingsCategoryHeader settingsCategoryHeaderCleanV491"><div><h4>Advanced</h4></div></div>
    <div id="settings-advanced-diagnostics" className="settingsPanelCard settingsBoringPanelV491 settingsDiagnosticsPanelV491"><div className="settingsPanelHeader settingsDiagnosticsHeader"><div><strong>Diagnostics</strong></div><OpticalButton className="settingsActionButton settingsCopyInfoButton" type="button" onClick={p.copyDiagnosticsInfo}>{p.diagnosticsCopied ? "copied" : "copy app info"}</OpticalButton></div><div className="settingsDiagnosticsGrid settingsDiagnosticsGridV440">{p.diagnosticsInfo.items.map((item) => <div className="settingsDiagnosticCard" key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>)}</div></div>

    <div className="settingsPanelCard"><div className="settingsPanelHeader"><div><strong>Recovery data</strong><span>Copy preserved playlist and listening recovery records without modifying them.</span></div>{kit ? <kit.GlassActionButton size="sm" className="ltOpticalAction" onAction={copyRecovery} pendingLabel="Copying recovery data">Copy recovery data</kit.GlassActionButton> : <button className="settingsActionButton" type="button" onClick={() => void copyRecovery()}>Copy recovery data</button>}</div>{recoveryStatus && <p role="status">{recoveryStatus}</p>}</div>
    <div className="settingsPanelCard settingsBoringPanelV491 settingsFullWidthPanel"><div className="settingsPanelHeader"><div><strong>{p.platformInfo.desktopControlsLabel}</strong></div></div><div className="settingsMiniGrid"><ToggleRow label="Keep localtify in tray when closed" help="The X button hides the app instead of quitting. Use Quit from the tray to close it fully." checked={p.settings.minimizeToTray} onChange={(value) => void p.updateSetting("minimizeToTray", value)} />{p.platformInfo.startupSettingSupported ? <ToggleRow label={p.platformInfo.startupSettingLabel} help={p.platformInfo.startupSettingHelp} checked={p.settings.startWithWindows} onChange={(value) => void p.updateSetting("startWithWindows", value)} /> : null}</div></div>
    <div id="settings-advanced-reset" className="settingsPanelCard settingsBoringPanelV491 settingsFullWidthPanel settingsResetPanel settingsDangerPanelV491 settingsDangerMascotPanelV501"><div className="settingsPanelHeader settingsDangerMascotHeaderV501"><img className="settingsDangerMascotV501" src={DANGER_MASCOT_SRC} alt="" draggable={false} aria-hidden="true" /><div><strong>Reset settings</strong><span>Reset only the selected app settings. Your songs stay in the library.</span></div></div><div className="settingsResetGrid"><OpticalButton className="settingsResetButton" type="button" onClick={p.resetDiscordSettings}><strong>Reset Discord settings</strong><span>Restores privacy mode, status text, buttons, artwork, and cleanup.</span></OpticalButton><OpticalButton className="settingsResetButton" type="button" onClick={p.resetAppearanceSettings}><strong>Reset appearance</strong><span>Restores theme, colors, motion, corners, and ambience settings.</span></OpticalButton><OpticalButton className="settingsResetButton" type="button" onClick={p.resetPlayerLayoutSettings}><strong>Reset player layout</strong><span>Restores player size, volume, and speed.</span></OpticalButton><OpticalButton className="settingsResetButton" type="button" onClick={p.resetLibraryLayoutSettings}><strong>Reset library layout</strong><span>Restores sidebar width, compact library, and hero options.</span></OpticalButton><OpticalButton primary className="settingsResetButton danger" type="button" onClick={p.resetAllSettingsSafely}><strong>Reset all settings</strong><span>Asks first, then restores every app setting to default.</span></OpticalButton></div></div>
  </section>;
}
