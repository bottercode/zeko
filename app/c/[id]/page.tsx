import { Suspense } from 'react'
import { Studio } from '@/components/Studio'

export default function Page({ params, searchParams }: PageProps<'/c/[id]'>) {
  return <Suspense fallback={null}>
    {Promise.all([params, searchParams]).then(([{ id }, { welcome }]) => <Studio boardId={id} sampleGuide={welcome === 'sample'} />)}
  </Suspense>
}
