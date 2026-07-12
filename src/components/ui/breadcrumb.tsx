'use client';

import Link from 'next/link';
import { ChevronRight, Home } from 'lucide-react';

interface BreadcrumbItem {
  label: string;
  href?: string;
}

export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-muted-foreground mb-6 flex-wrap">
      {items.map((item, index) => (
        <span key={index} className="flex items-center gap-1 min-w-0">
          {index > 0 && <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 opacity-50" />}
          {item.href ? (
            <Link
              href={item.href}
              className="hover:text-foreground transition-colors hover:underline underline-offset-2"
            >
              {index === 0 ? (
                <span className="flex items-center gap-1">
                  <Home className="w-3.5 h-3.5" />
                  {item.label}
                </span>
              ) : item.label}
            </Link>
          ) : (
            <span className="text-foreground font-medium truncate max-w-[240px]" aria-current="page">
              {item.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
