import type { ReactNode } from "react";

export default function Link({
  href,
  children,
}: {
  readonly href: string;
  readonly children?: ReactNode;
}) {
  return <a href={href}>{children}</a>;
}
