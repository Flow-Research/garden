import { useState } from 'react'
import { Option } from 'effect'
import { Plug } from 'lucide-react'

export function ProviderIcon({
  icon,
  className,
}: {
  icon: Option.Option<string>
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  if (Option.isNone(icon) || failed) {
    return <Plug className={className} aria-hidden="true" />
  }
  return (
    <img
      src={icon.value}
      alt=""
      loading="lazy"
      className={className}
      onError={() => setFailed(true)}
    />
  )
}
