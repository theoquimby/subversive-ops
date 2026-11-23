import type { ReactNode } from "react";
import { ChannelVars } from "./channel";

/** Every Online page: the channel colours, shared with the Website pages. Each page still checks who may see it. */
export default function OnlineLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ChannelVars />
      {children}
    </>
  );
}
