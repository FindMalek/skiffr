import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@skiffr/ui/components/breadcrumb"
import type { Route } from "next"
import Link from "next/link"
import { Fragment } from "react"

export type Crumb = { label: string; href?: Route }

/**
 * The one place a page title is rendered. The shell bar above holds the trigger, search and user menu, so the title
 * appears once, as the `h1` (focusable: the route-change focus lands here). `breadcrumb` is only for nested pages and
 * ends with the current page.
 */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
  breadcrumb?: Crumb[]
}) {
  return (
    <header className="flex flex-col gap-4 border-b px-4 pt-6 pb-6 md:px-6">
      {breadcrumb && breadcrumb.length > 1 && (
        <Breadcrumb>
          <BreadcrumbList>
            {breadcrumb.map((crumb, index) => (
              <Fragment key={crumb.label}>
                {index > 0 && <BreadcrumbSeparator />}
                <BreadcrumbItem>
                  {crumb.href && index < breadcrumb.length - 1 ? (
                    <BreadcrumbLink render={<Link href={crumb.href} />}>{crumb.label}</BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
              </Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
      )}
      <div className="flex flex-col gap-4 md:flex-row md:flex-wrap md:items-end md:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 tabIndex={-1} className="font-heading font-semibold text-2xl tracking-tight">
            {title}
          </h1>
          {description && <p className="max-w-prose text-muted-foreground text-sm">{description}</p>}
        </div>
        {actions && <div className="flex min-w-0 max-w-full flex-wrap gap-2 max-sm:*:flex-1">{actions}</div>}
      </div>
    </header>
  )
}
