'use client';

import * as React from 'react';
import { Progress as BaseProgress } from '@base-ui/react/progress';
import { cn } from 'lib/utils';

export function Progress({
  className,
  value,
  max = 100,
  label,
  count,
  variant = 'warning',
  ...props
}: React.ComponentProps<typeof BaseProgress.Root> & {
  label?: string;
  count?: string;
  variant?: 'warning' | 'success' | 'danger';
}) {
  return (
    <BaseProgress.Root
      value={value}
      max={max}
      className={cn('flex flex-col gap-1 w-full', className)}
      {...props}
    >
      <div className="flex items-center justify-between text-xs">
        {label && (
          <BaseProgress.Label className="text-muted-foreground">
            {label}
          </BaseProgress.Label>
        )}
        {count && (
          <span className="font-medium tabular-nums text-foreground">
            {count}
          </span>
        )}
      </div>
      <BaseProgress.Track
        className={cn(
          'h-1.5 w-full overflow-hidden rounded-full',
          'bg-muted',
        )}
      >
        <BaseProgress.Indicator
          className={cn(
            'h-full rounded-full transition-all duration-500',
            variant === 'warning' && 'bg-warning',
            variant === 'success' && 'bg-success',
            variant === 'danger' && 'bg-danger',
          )}
        />
      </BaseProgress.Track>
    </BaseProgress.Root>
  );
}
