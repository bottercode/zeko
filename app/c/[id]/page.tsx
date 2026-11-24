import { Suspense } from 'react'
import { Studio } from '@/components/Studio'

export default function Page({ params }: PageProps<'/c/[id]'>) {
  return <Suspense fallback={null}>{params.then(({ id }) => <Studio boardId={id} />)}</Suspense>
}
