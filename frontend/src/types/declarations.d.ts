declare module 'lucide-react' {
  import type { ComponentType, SVGProps } from 'react'
  const content: Record<string, ComponentType<SVGProps<SVGSVGElement>>>
  export = content
}

declare module 'react-toggle-dark-mode' {
  import type { ComponentType } from 'react'
  export const DarkModeSwitch: ComponentType<any>
}
