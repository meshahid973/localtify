import { createContext, useContext, type ComponentProps, type ReactNode } from "react";
import { controlOptics, useAppearance, type GlassKit } from "../../../shared/appearance/appearance";

const TransportItem = createContext<GlassKit["GlassButtonGroupItem"] | null>(null);

export function TransportGroup({ className, active = true, children }: {
  className: string;
  active?: boolean;
  children: ReactNode;
}) {
  const { kit } = useAppearance();
  if (!active || !kit) return <div className={className}>{children}</div>;
  return (
    <kit.GlassButtonGroup aria-label="Playback controls" size="md" material="clear" tint={.46}
      backdrop=".playerBar, .immersivePlayer, .phonePlayerSheet" optics={controlOptics} className={`${className} ltOpticalTransport`}>
      <TransportItem.Provider value={kit.GlassButtonGroupItem}>{children}</TransportItem.Provider>
    </kit.GlassButtonGroup>
  );
}

export function TransportButton(props: ComponentProps<"button">) {
  const Item = useContext(TransportItem) ?? "button";
  return <Item {...props} />;
}
