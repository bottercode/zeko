import { Suspense } from 'react'
import { CliApproval } from '@/components/CliApproval'
import { workspaceId } from '@/lib/auth-access'

export default function Page({ searchParams }: { searchParams: Promise<{ code?: string | string[] }> }) {
  return <Suspense fallback={null}>{searchParams.then(({ code }) => <CliApproval code={workspaceId(code) ? code : undefined} />)}</Suspense>
}
