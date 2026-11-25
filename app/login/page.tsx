import { Suspense } from 'react'
import Image from 'next/image'
import { redirect } from 'next/navigation'
import { Mark } from '@/components/TopBar'
import { SampleCanvasPreview } from '@/components/CanvasPreview'
import { Button } from '@/components/ui/button'
import { canvasReturnPath, googleAuthConfigured } from '@/lib/auth-access'
import { startGoogleSignIn } from './actions'

export const metadata = { title: 'Zeko | Design with your coding agent' }

async function SignInForm({ searchParams }: Pick<PageProps<'/login'>, 'searchParams'>) {
  const params = await searchParams
  if (!googleAuthConfigured()) redirect('/')
  const next = canvasReturnPath(params.next ?? params.callbackUrl)
  const error = params.error === 'AccessDenied'
    ? 'Use a verified Google account to sign in.'
    : params.error ? 'Sign-in failed. Try again with your Google account.' : undefined

  return (
    <form action={startGoogleSignIn} className="flex flex-col items-start gap-3">
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
    <main className="h-dvh overflow-auto px-6 sm:px-10">
      <div className="mx-auto grid min-h-full max-w-[1140px] items-center gap-10 py-12 lg:grid-cols-[0.83fr_1.17fr] lg:gap-18">
        <section className="flex max-w-lg flex-col items-start gap-5">
          <div className="flex items-center gap-2 text-lg font-semibold tracking-tight"><Mark size={26} /> zeko</div>
          <h1 className="text-balance text-4xl leading-[1.06] font-medium tracking-[-0.045em] sm:text-5xl">Design with your coding agent</h1>
          <p className="max-w-sm text-pretty text-base leading-relaxed text-muted-foreground">Sketch screens, compare variations, and try a flow in one canvas.</p>
          <Suspense fallback={null}>
            <SignInForm searchParams={searchParams} />
          </Suspense>
          <a className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground" href="https://github.com/bottercode/zeko">View source on GitHub</a>
        </section>
        <div aria-hidden><SampleCanvasPreview /></div>
      </div>
    </main>
  )
}
