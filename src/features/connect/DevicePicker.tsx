import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Laptop, MonitorSmartphone, Smartphone } from "lucide-react";
import { computerName } from "../../app/platform";
import type { ConnectControls } from "./usePlaybackConnect";
import "./connect.css";

function connectionText(status: ConnectControls["status"]) {
  if (status === "connecting") return `Connecting to your ${computerName()}…`;
  if (status === "offline") return `Your ${computerName()} isn't reachable. Check that both are on the same Wi-Fi and localtify is open there`;
  if (status === "unsupported") return `Update localtify on your ${computerName()} to control playback from here`;
  return "";
}

export function DevicePicker({ controls, variant }: { controls: ConnectControls; variant: "bar" | "chip" }) {
  const playingOn = controls.active || controls.self;
  const status = connectionText(controls.status);
  const title = controls.remoteName ? `playing on ${controls.remoteName}` : status || "choose where to play";

  return (
    <div className={`connectPicker connectPicker-${variant}`}>
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger
          type="button"
          className={`${variant === "bar" ? "playerQueueButton" : "phoneChip"} connectButton ${controls.remoteName ? "active isRemote" : ""} ${status ? "isOffline" : ""}`}
          onClick={(event) => event.stopPropagation()}
          aria-label={title}
          title={title}
        >
          <MonitorSmartphone className="playerControlIcon" size={17} strokeWidth={2.2} aria-hidden="true" />
          {variant === "chip" ? <span>{controls.remoteName ? `on ${controls.remoteName}` : "devices"}</span> : null}
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal container={typeof document === "undefined" ? undefined : document.querySelector(".app")}>
          <DropdownMenu.Content className={`connectMenu connectMenu-${variant}`} aria-label="play on"
            side="top" align={variant === "bar" ? "end" : "center"} sideOffset={10} collisionPadding={12} loop>
            <DropdownMenu.Label className="connectMenuTitle">play on</DropdownMenu.Label>
            <DropdownMenu.RadioGroup value={playingOn}>
              {controls.peers.map((peer) => {
                const Icon = peer.kind === "computer" ? Laptop : Smartphone;
                const current = peer.id === playingOn;
                return (
                  <DropdownMenu.RadioItem key={peer.id} value={peer.id} className={`connectMenuItem ${current ? "isCurrent" : ""}`}
                    onSelect={() => controls.transfer(peer.id)}>
                    <Icon size={18} strokeWidth={2.2} aria-hidden="true" />
                    <span>
                      <strong>{controls.label(peer)}</strong>
                      {current && controls.active ? <small>now playing</small> : null}
                    </span>
                  </DropdownMenu.RadioItem>
                );
              })}
            </DropdownMenu.RadioGroup>
            {status ? <p className="connectMenuStatus">{status}</p> : null}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
