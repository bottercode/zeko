import { Suspense } from 'react'
import Image from 'next/image'
import { redirect } from 'next/navigation'
import { Mark } from '@/components/TopBar'
import { Button } from '@/components/ui/button'
import { canvasReturnPath, googleAuthConfigured } from '@/lib/auth-access'
import { startGoogleSignIn } from './actions'

export const metadata = { title: 'Sign in to Zeko' }

async function SignInForm({ searchParams }: Pick<PageProps<'/login'>, 'searchParams'>) {
  const params = await searchParams
  if (!googleAuthConfigured()) redirect('/')
  const next = canvasReturnPath(params.next ?? params.callbackUrl)
  const error = params.error === 'AccessDenied'
    ? 'Use a verified Google account to sign in.'
    : params.error ? 'Sign-in failed. Try again with your Google account.' : undefined

  return (
    <form action={startGoogleSignIn} className="flex w-full max-w-64 flex-col items-center gap-4">
      <input type="hidden" name="next" value={next} />
      {error && <p role="alert" className="text-pretty text-sm text-destructive">{error}</p>}
      <Button type="submit" variant="ghost" className="h-auto p-0">
        <Image src="/auth/google-sign-in.png" alt="Sign in with Google" width={180} height={40} unoptimized />
      </Button>
    </form>
  )
}

export default function Login({ searchParams }: PageProps<'/login'>) {
  return (
    <main className="grid min-h-dvh place-items-center overflow-auto px-6 py-10">
      <section className="panel flex w-full max-w-sm flex-col items-center gap-6 px-8 py-10 text-center">
        <div className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Mark size={23} />
          zeko
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in to Zeko</h1>
          <p className="text-sm text-muted-foreground">Use your Google account to open your private workspace.</p>
        </div>
        <Suspense fallback={null}>
          <SignInForm searchParams={searchParams} />
        </Suspense>
      </section>
    </main>
  )
}
