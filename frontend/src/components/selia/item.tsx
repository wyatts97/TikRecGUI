'use client';

import * as React from 'react';
import { cn } from 'lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';

// ─── Item Root ───────────────────────────────────────────────────────────────

const itemVariants = cva(
  'flex items-start gap-3 rounded-xl p-3',
  {
    variants: {
      variant: {
        default: '',
        outline: 'border border-border',
        danger: 'bg-danger/10',
        'danger-outline': 'border border-danger/30',
        'success-outline': 'border border-success/30',
      },
      size: {
        sm: 'p-2 gap-2',
        md: 'p-3 gap-3',
        lg: 'p-4 gap-4',
      },
      direction: {
        row: 'flex-row',
        column: 'flex-col',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
      direction: 'row',
    },
  },
);

export { itemVariants };

export function Item({
  variant,
  size,
  direction,
  className,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof itemVariants>) {
  return (
    <div
      data-slot="item"
      className={cn(itemVariants({ variant, size, direction, className }))}
      {...props}
    />
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

export function ItemContent({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="item-content"
      className={cn('flex flex-col gap-0.5 min-w-0 flex-1', className)}
      {...props}
    />
  );
}

export function ItemTitle({
  className,
  ...props
}: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="item-title"
      className={cn('font-semibold text-foreground leading-tight', className)}
      {...props}
    />
  );
}

export function ItemDescription({
  className,
  ...props
}: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="item-description"
      className={cn('text-sm text-muted-foreground leading-snug', className)}
      {...props}
    />
  );
}

export function ItemMeta({
  className,
  ...props
}: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="item-meta"
      className={cn('text-xs text-muted-foreground', className)}
      {...props}
    />
  );
}

export function ItemMedia({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="item-media"
      className={cn('shrink-0', className)}
      {...props}
    />
  );
}

export function ItemAction({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="item-action"
      className={cn('flex items-center gap-1 shrink-0 self-center', className)}
      {...props}
    />
  );
}
