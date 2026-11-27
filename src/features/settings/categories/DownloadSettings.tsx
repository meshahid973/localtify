import type { Settings } from "../settings.types";
import type { UpdateSetting } from "../settings.shared";
import { SettingsSelectRow, SettingSection, ToggleRow } from "../settings.shared";
import Button from "../../../shared/ui/Button";

export default function DownloadSettings({ settings, updateSetting, downloadFolderLabel, chooseDownloadFolder }: {
  settings: Settings;
  updateSetting: UpdateSetting;
  downloadFolderLabel: string;
  chooseDownloadFolder: () => void | Promise<void>;
}) {
  return <section className="settingsCategoryPage settingsDeclutterPageV491 settingsDownloadsCleanV491" aria-label="Download settings">
    <div className="settingsCategoryHeader"><h4>Downloads</h4></div>
    <SettingSection id="settings-downloads-quality" title="Audio output" className="settingsFocusPanelV491">
        <ToggleRow label="Keep original audio" help="Save the source file without converting."
          checked={settings.downloadKeepOriginal} onChange={value => void updateSetting("downloadKeepOriginal", value)} />
        <SettingsSelectRow<Settings["downloadQuality"]> label="Audio quality" value={settings.downloadQuality}
          disabled={settings.downloadKeepOriginal}
          items={[
            { value: "best", label: "Best available" },
            { value: "320", label: "320 kbps" },
            { value: "256", label: "256 kbps" },
            { value: "192", label: "192 kbps" }
          ]}
          onChange={value => void updateSetting("downloadQuality", value)} />
        <SettingsSelectRow<Settings["downloadFormat"]> label="Download format" value={settings.downloadFormat}
          disabled={settings.downloadKeepOriginal}
          items={[
            { value: "mp3", label: "MP3" },
            { value: "flac", label: "FLAC" },
            { value: "wav", label: "WAV" }
          ]}
          onChange={value => void updateSetting("downloadFormat", value)} />
    </SettingSection>
    <SettingSection id="settings-downloads-import" title="After downloading"
      className="downloadToggleStackV031 settingsFocusPanelV491">
      <ToggleRow label="Automatically add to library" help="Import completed audio into your local music library."
        checked={settings.downloadAutoAdd} onChange={value => void updateSetting("downloadAutoAdd", value)} />
      <ToggleRow label="Clean downloaded titles" help="Remove common source labels and unnecessary filename clutter."
        checked={settings.downloadCleanTitle} onChange={value => void updateSetting("downloadCleanTitle", value)} />
    </SettingSection>
    <SettingSection id="settings-downloads-folder" title="Download location" description="Where downloaded files are saved."
      className="downloadFolderGroupV031 settingsFocusPanelV491">
      <div className="folderPickerRow">
        <code title={settings.downloadFolder || downloadFolderLabel || "Default downloads folder"}>
          {settings.downloadFolder || downloadFolderLabel || "Default downloads folder"}
        </code>
        <Button variant="secondary" size="sm" onClick={() => void chooseDownloadFolder()}>Choose folder</Button>
        {settings.downloadFolder ? <Button variant="ghost" size="sm"
          onClick={() => void updateSetting("downloadFolder", "")}>Use default</Button> : null}
      </div>
    </SettingSection>
  </section>;
}
