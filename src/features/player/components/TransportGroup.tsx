import { type ComponentProps, type ReactNode } from "react";
import { GlassButtonGroup, GlassButtonGroupItem } from "../../../vendor/liquid-glass/glass-button-group";
import { controlOptics, useAppearance } from "../../../shared/appearance/appearance";

const transportOptics = {
  ...controlOptics, backdropTint: true,
  rim: .08, reflection: .08, inner: .18, dark: { tint: .55 }
};

export function TransportGroup({ className, active = true, children }: {
  className: string;
  active?: boolean;
  children: ReactNode;
}) {
  const { kit } = useAppearance();
  const optical = !!kit && active;
  return (
    <GlassButtonGroup optical={optical} aria-label="Playback controls" size="md" material="clear" tint={.55}
      backdrop=".playerBar, .immersivePlayer, .phonePlayerSheet" optics={transportOptics} className={optical ? `${className} ltOpticalTransport` : className}>
      {children}
    </GlassButtonGroup>
  );
}

export function TransportButton(props: ComponentProps<"button">) {
  return <GlassButtonGroupItem {...props} />;
}
