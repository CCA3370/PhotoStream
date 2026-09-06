import type { ReactNode } from "react";

export function AlbumWorkspaceHeader({
  actions,
  description,
  headingId,
  section,
  title,
}: Readonly<{
  actions?: ReactNode;
  description?: string;
  headingId: string;
  section: string;
  title: string;
}>) {
  return (
    <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{section}</p>
        <h2 className="mt-0.5 truncate text-xl font-semibold tracking-tight" id={headingId}>
          {title}
        </h2>
        {description ? (
          <p className="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
