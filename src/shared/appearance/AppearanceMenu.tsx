import { Fragment } from "react";
import { DropdownMenu as ArcMenu, type DropdownMenuProps } from "../../vendor/arc/dropdown-menu/dropdown-menu";
import { useAppearance } from "./appearance";

export function AppearanceMenu({ structured = false, ...props }: DropdownMenuProps & { structured?: boolean }) {
  const { kit } = useAppearance();
  if (!kit) return <ArcMenu {...props} />;
  const Root = structured ? kit.GlassMenu : kit.GlassDropdownMenu;
  const Trigger = structured ? kit.GlassMenuTrigger : kit.GlassDropdownMenuTrigger;
  const Content = structured ? kit.GlassMenuContent : kit.GlassDropdownMenuContent;
  const Item = structured ? kit.GlassMenuItem : kit.GlassDropdownMenuItem;
  const Separator = structured ? kit.GlassMenuSeparator : kit.GlassDropdownMenuSeparator;
  return <Root>
    <Trigger aria-label={props.label} className="ltOpticalAction">
      {props.icon}{props.iconOnly ? null : props.label}
    </Trigger>
    <Content align="end" className="ltOpticalMenu">
      {props.items.map(item => <Fragment key={item.label}>
        {item.separatorBefore && <Separator />}
        <Item disabled={item.disabled} destructive={item.destructive} onSelect={item.onSelect}>{item.icon}{item.label}</Item>
      </Fragment>)}
    </Content>
  </Root>;
}
