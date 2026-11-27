import type { SVGProps } from 'react'

export function HarnessyIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 18 24"
      width="18"
      height="24"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <path
        d="M5.784 12.639 11.57 18.316 5.784 23.995 0 18.316l5.784-5.677Zm6.43-6.314L18 12.004l-5.786 5.678-5.785-5.68 5.785-5.677ZM5.784 0l5.786 5.68-5.786 5.678L0 5.678 5.784 0Z"
        fill="#772CE8"
      />
    </svg>
  )
}
