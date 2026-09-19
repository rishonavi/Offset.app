import { HardHat } from 'lucide-react'
import { EmptyState } from '../ui'

// Sites are created and edited on the Projects tab. Two forms writing the same
// store is how the two quietly stop agreeing about what a site is, so this one
// points there rather than offering a second way in.
export default function EmptyStateSites({ canWrite }) {
  return (
    <EmptyState
      icon={HardHat}
      title="No sites yet"
      subtitle={
        canWrite
          ? 'Add one under Projects and material can be issued against it. Until then everything issued shows as booked to no site.'
          : 'Nothing has been issued against a site yet.'
      }
    />
  )
}
